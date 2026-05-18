import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMetrics } from "../src/metrics/registry.js";
import { SequenceCollector, type ScrapeLogger } from "../src/scrape/collector.js";
import type { SequenceClient } from "../src/sequence/client.js";
import type { Account, AccountSummary, PaginatedData, Transfer } from "../src/sequence/types.js";

function silentLogger(): ScrapeLogger {
  const noop = () => {};
  return { info: noop, warn: noop, error: noop };
}

function makeSummary(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: "acc-1",
    name: "Test Account",
    type: "POD",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
    institutionName: "Test Bank",
    ...overrides,
  };
}

function paginated<T>(items: T[]): PaginatedData<T> {
  return { items, pagination: { page: 1, pageSize: 50 } };
}

describe("SequenceCollector", () => {
  let metrics: ReturnType<typeof createMetrics>;
  let client: {
    listAllAccounts: ReturnType<typeof vi.fn>;
    getAccount: ReturnType<typeof vi.fn>;
    listAccountTransfers: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    metrics = createMetrics();
    client = {
      listAllAccounts: vi.fn(),
      getAccount: vi.fn(),
      listAccountTransfers: vi.fn(),
    };
  });

  function makeCollector(overrides: Partial<{ transfersMaxPages: number }> = {}) {
    return new SequenceCollector({
      client: client as unknown as SequenceClient,
      metrics,
      logger: silentLogger(),
      intervalMs: 60_000,
      transfersPageSize: 50,
      ...overrides,
    });
  }

  async function runScrape(collector = makeCollector()) {
    await collector.runOnce();
    return collector;
  }

  it("computes net worth, assets, and liabilities from positive and negative balances", async () => {
    client.listAllAccounts.mockResolvedValue([
      makeSummary({ id: "checking", type: "EXTERNAL_ACCOUNT" }),
      makeSummary({ id: "credit", type: "EXTERNAL_ACCOUNT" }),
    ]);
    client.getAccount.mockImplementation(async (id: string): Promise<Account> => {
      const balance = id === "checking" ? { balanceInCents: 100_000 } : { balanceInCents: -25_000 };
      return { ...makeSummary({ id }), balance };
    });
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));

    await runScrape();

    const netWorth = await metrics.registry.getSingleMetricAsString("sequence_net_worth_cents");
    const assets = await metrics.registry.getSingleMetricAsString("sequence_total_assets_cents");
    const liabilities = await metrics.registry.getSingleMetricAsString(
      "sequence_total_liabilities_cents",
    );
    expect(netWorth).toContain("75000");
    expect(assets).toContain("100000");
    expect(liabilities).toContain("25000");
  });

  it("skips accounts with null balance without throwing", async () => {
    client.listAllAccounts.mockResolvedValue([makeSummary({ id: "broken" })]);
    client.getAccount.mockResolvedValue({ ...makeSummary({ id: "broken" }), balance: null });
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));

    await runScrape();

    const errors = await metrics.registry.getSingleMetricAsString("sequence_scrape_errors_total");
    expect(errors).toContain('phase="balance_missing"');
  });

  it("skips accounts where balanceInCents is null", async () => {
    client.listAllAccounts.mockResolvedValue([makeSummary({ id: "partial" })]);
    client.getAccount.mockResolvedValue({
      ...makeSummary({ id: "partial" }),
      balance: { balanceInCents: null, error: "ITEM_LOGIN_REQUIRED" },
    });
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));

    await runScrape();

    const errors = await metrics.registry.getSingleMetricAsString("sequence_scrape_errors_total");
    expect(errors).toContain('phase="balance_error"');
    const balance = await metrics.registry.getSingleMetricAsString(
      "sequence_account_balance_cents",
    );
    expect(balance).not.toContain('account_id="partial"');
  });

  it("counts transfers above the watermark and skips already-seen ones", async () => {
    client.listAllAccounts.mockResolvedValue([makeSummary({ id: "acc" })]);
    client.getAccount.mockResolvedValue({
      ...makeSummary({ id: "acc" }),
      balance: { balanceInCents: 5000 },
    });
    const transfers: Transfer[] = [
      {
        id: "t1",
        amountInCents: 1000,
        direction: "MONEY_OUT",
        origin: "RULE",
        status: "COMPLETE",
        source: { id: "acc", name: "x", type: "POD", isDeleted: false },
        destination: { id: "acc2", name: "y", type: "POD", isDeleted: false },
        createdAt: "2024-01-01T00:00:00Z",
      },
      {
        id: "t2",
        amountInCents: 2000,
        direction: "MONEY_OUT",
        origin: "RULE",
        status: "COMPLETE",
        source: { id: "acc", name: "x", type: "POD", isDeleted: false },
        destination: { id: "acc2", name: "y", type: "POD", isDeleted: false },
        createdAt: "2024-02-01T00:00:00Z",
      },
    ];
    client.listAccountTransfers.mockResolvedValue(paginated(transfers));

    const collector = await runScrape();
    const seen = await metrics.registry.getSingleMetricAsString("sequence_transfers_seen_total");
    expect(seen).toMatch(/sequence_transfers_seen_total\{[^}]*account_id="acc"[^}]*\} 2/);

    // run again with same data on the same collector - watermark should suppress duplicates
    await runScrape(collector);
    const seenAgain = await metrics.registry.getSingleMetricAsString(
      "sequence_transfers_seen_total",
    );
    expect(seenAgain).toMatch(/sequence_transfers_seen_total\{[^}]*account_id="acc"[^}]*\} 2/);
  });

  it("records every optional balance gauge and parses balanceLastUpdatedAt to epoch seconds", async () => {
    client.listAllAccounts.mockResolvedValue([makeSummary({ id: "rich" })]);
    client.getAccount.mockResolvedValue({
      ...makeSummary({ id: "rich" }),
      balance: {
        balanceInCents: 12345,
        availableBalanceInCents: 11111,
        lastStatementBalanceInCents: 9999,
        nextPaymentMinimumInCents: 250,
        balanceLastUpdatedAt: "2024-06-01T00:00:00Z",
      },
    });
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));

    await runScrape();

    const available = await metrics.registry.getSingleMetricAsString(
      "sequence_account_available_balance_cents",
    );
    expect(available).toMatch(/account_id="rich"[^\n]*\} 11111/);
    const statement = await metrics.registry.getSingleMetricAsString(
      "sequence_account_statement_balance_cents",
    );
    expect(statement).toMatch(/account_id="rich"[^\n]*\} 9999/);
    const minPay = await metrics.registry.getSingleMetricAsString(
      "sequence_account_next_payment_minimum_cents",
    );
    expect(minPay).toMatch(/account_id="rich"[^\n]*\} 250/);
    const lastUpdated = await metrics.registry.getSingleMetricAsString(
      "sequence_account_balance_last_updated_seconds",
    );
    expect(lastUpdated).toMatch(/account_id="rich"[^\n]*\} 1717200000/);
  });

  it("does not emit balance_last_updated when balanceLastUpdatedAt is unparseable", async () => {
    client.listAllAccounts.mockResolvedValue([makeSummary({ id: "bad-ts" })]);
    client.getAccount.mockResolvedValue({
      ...makeSummary({ id: "bad-ts" }),
      balance: { balanceInCents: 500, balanceLastUpdatedAt: "not-a-date" },
    });
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));

    await runScrape();

    const lastUpdated = await metrics.registry.getSingleMetricAsString(
      "sequence_account_balance_last_updated_seconds",
    );
    expect(lastUpdated).not.toContain('account_id="bad-ts"');
  });

  it("skips accounts marked deletedAt without calling getAccount", async () => {
    client.listAllAccounts.mockResolvedValue([
      makeSummary({ id: "live" }),
      makeSummary({ id: "gone", deletedAt: "2024-01-01T00:00:00Z" }),
    ]);
    client.getAccount.mockResolvedValue({
      ...makeSummary({ id: "live" }),
      balance: { balanceInCents: 1000 },
    });
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));

    await runScrape();

    expect(client.getAccount).toHaveBeenCalledTimes(1);
    expect(client.getAccount).toHaveBeenCalledWith("live");
  });

  it("increments scrapeErrorsTotal{phase=account_detail} and continues on getAccount failure", async () => {
    client.listAllAccounts.mockResolvedValue([
      makeSummary({ id: "a1", name: "First" }),
      makeSummary({ id: "a2", name: "Second" }),
    ]);
    client.getAccount.mockImplementation(async (id: string): Promise<Account> => {
      if (id === "a1") throw new Error("boom");
      return { ...makeSummary({ id: "a2", name: "Second" }), balance: { balanceInCents: 1500 } };
    });
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));

    await runScrape();

    const errors = await metrics.registry.getSingleMetricAsString("sequence_scrape_errors_total");
    expect(errors).toMatch(/phase="account_detail"[^\n]*\} 1/);
    const balance = await metrics.registry.getSingleMetricAsString(
      "sequence_account_balance_cents",
    );
    expect(balance).toContain('account_id="a2"');
    expect(balance).not.toContain('account_id="a1"');
  });

  it("increments scrapeErrorsTotal{phase=transfers} when listAccountTransfers fails", async () => {
    client.listAllAccounts.mockResolvedValue([makeSummary({ id: "acc" })]);
    client.getAccount.mockResolvedValue({
      ...makeSummary({ id: "acc" }),
      balance: { balanceInCents: 500 },
    });
    client.listAccountTransfers.mockRejectedValueOnce(new Error("transfers boom"));

    await runScrape();

    const errors = await metrics.registry.getSingleMetricAsString("sequence_scrape_errors_total");
    expect(errors).toMatch(/phase="transfers"[^\n]*\} 1/);
  });

  it("increments scrapeErrorsTotal{phase=scrape} when listAllAccounts fails and still records duration", async () => {
    client.listAllAccounts.mockRejectedValueOnce(new Error("accounts boom"));

    await runScrape();

    const errors = await metrics.registry.getSingleMetricAsString("sequence_scrape_errors_total");
    expect(errors).toMatch(/phase="scrape"[^\n]*\} 1/);
    const duration = await metrics.registry.getSingleMetricAsString(
      "sequence_scrape_duration_seconds",
    );
    expect(duration).toContain("sequence_scrape_duration_seconds");
  });

  it("paginates transfers until a short page (multi-page transfer fetch)", async () => {
    const pageSize = 50;
    const firstPage: Transfer[] = Array.from({ length: pageSize }, (_, i) => ({
      id: `t${i}`,
      amountInCents: 1000,
      direction: "MONEY_OUT",
      origin: "RULE",
      status: "COMPLETE",
      source: { id: "acc", name: "x", type: "POD", isDeleted: false },
      destination: { id: "acc2", name: "y", type: "POD", isDeleted: false },
      createdAt: new Date(2024, 0, i + 1).toISOString(),
    }));
    const secondPage: Transfer[] = [
      {
        id: "t50",
        amountInCents: 1000,
        direction: "MONEY_OUT",
        origin: "RULE",
        status: "COMPLETE",
        source: { id: "acc", name: "x", type: "POD", isDeleted: false },
        destination: { id: "acc2", name: "y", type: "POD", isDeleted: false },
        createdAt: new Date(2024, 1, 20).toISOString(),
      },
    ];
    client.listAllAccounts.mockResolvedValue([makeSummary({ id: "acc" })]);
    client.getAccount.mockResolvedValue({
      ...makeSummary({ id: "acc" }),
      balance: { balanceInCents: 5000 },
    });
    client.listAccountTransfers
      .mockResolvedValueOnce(paginated(firstPage))
      .mockResolvedValueOnce(paginated(secondPage));

    await runScrape();

    expect(client.listAccountTransfers).toHaveBeenCalledTimes(2);
    expect(client.listAccountTransfers).toHaveBeenNthCalledWith(1, "acc", {
      page: 1,
      pageSize: 50,
    });
    expect(client.listAccountTransfers).toHaveBeenNthCalledWith(2, "acc", {
      page: 2,
      pageSize: 50,
    });
    const seen = await metrics.registry.getSingleMetricAsString("sequence_transfers_seen_total");
    expect(seen).toMatch(/sequence_transfers_seen_total\{[^}]*account_id="acc"[^}]*\} 51/);
  });

  it("breaks transfer pagination at transfersMaxPages and increments scrapeErrorsTotal{phase=transfers}", async () => {
    client.listAllAccounts.mockResolvedValue([makeSummary({ id: "acc" })]);
    client.getAccount.mockResolvedValue({
      ...makeSummary({ id: "acc" }),
      balance: { balanceInCents: 100 },
    });
    const onePageOfOne = (createdAt: string): Transfer[] => [
      {
        id: `t-${createdAt}`,
        amountInCents: 1,
        direction: "MONEY_OUT",
        origin: "RULE",
        status: "COMPLETE",
        source: { id: "acc", name: "x", type: "POD", isDeleted: false },
        destination: { id: "acc2", name: "y", type: "POD", isDeleted: false },
        createdAt,
      },
    ];
    client.listAccountTransfers.mockImplementation(
      async (_id: string, params: { page?: number; pageSize?: number }) => {
        const page = params.page ?? 1;
        return paginated(onePageOfOne(`2024-0${page}-01T00:00:00Z`));
      },
    );

    const collector = new SequenceCollector({
      client: client as unknown as SequenceClient,
      metrics,
      logger: silentLogger(),
      intervalMs: 60_000,
      transfersPageSize: 1,
      transfersMaxPages: 3,
    });
    await collector.runOnce();

    expect(client.listAccountTransfers).toHaveBeenCalledTimes(3);
    const errors = await metrics.registry.getSingleMetricAsString("sequence_scrape_errors_total");
    expect(errors).toMatch(/phase="transfers"[^\n]*\} 1/);
  });

  it("schedule() is idempotent: calling twice does not register two intervals", async () => {
    client.listAllAccounts.mockResolvedValue([]);
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const collector = makeCollector();
    try {
      collector.schedule();
      collector.schedule();
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    } finally {
      await collector.stop();
      setIntervalSpy.mockRestore();
    }
  });

  it("runOnce returns the same in-flight promise when called concurrently", async () => {
    let resolveList: ((value: AccountSummary[]) => void) | undefined;
    client.listAllAccounts.mockImplementation(
      () =>
        new Promise<AccountSummary[]>((resolve) => {
          resolveList = resolve;
        }),
    );
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));
    const collector = makeCollector();
    const first = collector.runOnce();
    const second = collector.runOnce();
    expect(client.listAllAccounts).toHaveBeenCalledTimes(1);
    resolveList?.([]);
    await Promise.all([first, second]);
    expect(client.listAllAccounts).toHaveBeenCalledTimes(1);
  });

  it("stop() awaits the in-flight scrape before resolving", async () => {
    let resolveList: ((value: AccountSummary[]) => void) | undefined;
    let scrapeDone = false;
    client.listAllAccounts.mockImplementation(
      () =>
        new Promise<AccountSummary[]>((resolve) => {
          resolveList = (value) => {
            scrapeDone = true;
            resolve(value);
          };
        }),
    );
    client.listAccountTransfers.mockResolvedValue(paginated<Transfer>([]));
    const collector = makeCollector();
    const runOncePromise = collector.runOnce();
    const stopPromise = collector.stop();
    let stopResolved = false;
    void stopPromise.then(() => {
      stopResolved = true;
    });
    await new Promise((r) => setImmediate(r));
    expect(stopResolved).toBe(false);
    expect(scrapeDone).toBe(false);
    resolveList?.([]);
    await stopPromise;
    await runOncePromise;
    expect(stopResolved).toBe(true);
    expect(scrapeDone).toBe(true);
  });
});

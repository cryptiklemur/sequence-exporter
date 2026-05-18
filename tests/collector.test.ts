import type { FastifyBaseLogger } from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SequenceCollector } from "../src/metrics/collector.js";
import { createMetrics } from "../src/metrics/registry.js";
import type { SequenceClient } from "../src/sequence/client.js";
import type { Account, AccountSummary, PaginatedData, Transfer } from "../src/sequence/types.js";

function silentLogger(): FastifyBaseLogger {
  const noop = () => {};
  const logger = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
    fatal: noop,
    trace: noop,
    silent: noop,
    child: () => logger,
    level: "silent",
  } as unknown as FastifyBaseLogger;
  return logger;
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
  let client: { listAllAccounts: ReturnType<typeof vi.fn>; getAccount: ReturnType<typeof vi.fn>; listAccountTransfers: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    metrics = createMetrics();
    client = {
      listAllAccounts: vi.fn(),
      getAccount: vi.fn(),
      listAccountTransfers: vi.fn(),
    };
  });

  function makeCollector() {
    return new SequenceCollector({
      client: client as unknown as SequenceClient,
      metrics,
      logger: silentLogger(),
      intervalMs: 60_000,
      transfersPageSize: 50,
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
    const balance = await metrics.registry.getSingleMetricAsString("sequence_account_balance_cents");
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
    const seenAgain = await metrics.registry.getSingleMetricAsString("sequence_transfers_seen_total");
    expect(seenAgain).toMatch(/sequence_transfers_seen_total\{[^}]*account_id="acc"[^}]*\} 2/);
  });
});

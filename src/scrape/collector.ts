import type {
  AccountLabels,
  MetricsBundle,
  TransferAccountLabels,
  TransferLabels,
} from "../metrics/registry.js";
import type { SequenceClient } from "../sequence/client.js";
import { SequenceApiError } from "../sequence/client.js";
import type { Account, AccountSummary, Transfer } from "../sequence/types.js";

type LogFn = (payload: Record<string, unknown>, msg?: string) => void;
export interface ScrapeLogger {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

export type ScrapePhase =
  | "scrape"
  | "account_detail"
  | "balance_missing"
  | "balance_error"
  | "transfers";

export type ScrapeEndpoint = "/accounts" | "/accounts/{id}" | "/accounts/{id}/transfers";

export interface CollectorOptions {
  client: SequenceClient;
  metrics: MetricsBundle;
  logger: ScrapeLogger;
  intervalMs: number;
  transfersPageSize: number;
  transfersMaxPages?: number;
}

const DEFAULT_MAX_TRANSFER_PAGES = 100;

interface NetWorthTotals {
  netWorth: number;
  totalAssets: number;
  totalLiabilities: number;
}

interface TransferPagingState {
  newest: number;
  newestTransfer: Transfer | undefined;
}

export class SequenceCollector {
  private readonly opts: CollectorOptions;
  private timer: NodeJS.Timeout | undefined;
  private inflight: Promise<void> | undefined;
  private stopped = false;
  private lastTransferTs = new Map<string, number>();

  constructor(opts: CollectorOptions) {
    this.opts = opts;
  }

  schedule(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.opts.intervalMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (this.inflight) await this.inflight;
  }

  /**
   * Runs a single scrape cycle. If a scrape is already in flight, returns that
   * scrape's promise instead of starting a new one (single-run-at-a-time semantics).
   *
   * Scrape failures are reported via `scrapeErrorsTotal{phase="scrape"}` and the
   * logger; the returned promise resolves regardless so the scheduled tick can keep
   * running. Callers should treat resolution as "scrape attempted", not "scrape succeeded".
   */
  async runOnce(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.inflight = this.scrapeWithMetrics();
    try {
      await this.inflight;
    } finally {
      this.inflight = undefined;
    }
  }

  private async scrapeWithMetrics(): Promise<void> {
    const { logger, metrics } = this.opts;
    const startedAt = performance.now();
    try {
      await this.scrape();
      metrics.lastSuccessfulScrapeTimestampSeconds.set(Date.now() / 1000);
    } catch (err) {
      this.incPhase("scrape");
      logger.error({ err }, "Sequence scrape failed");
    } finally {
      metrics.scrapeDurationSeconds.set((performance.now() - startedAt) / 1000);
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    await this.runOnce();
  }

  private async scrape(): Promise<void> {
    const { client, metrics, logger } = this.opts;

    const summaries = await this.timed("/accounts", () => client.listAllAccounts());
    this.aggregateAccountCounts(summaries);
    this.resetBalanceGauges();

    const totals: NetWorthTotals = { netWorth: 0, totalAssets: 0, totalLiabilities: 0 };

    for (const summary of summaries) {
      if (summary.deletedAt) continue;
      let account: Account;
      try {
        account = await this.timed("/accounts/{id}", () => client.getAccount(summary.id));
      } catch (err) {
        this.incPhase("account_detail");
        logger.warn({ err, accountId: summary.id }, "Failed to fetch account detail");
        continue;
      }

      const labels = this.accountLabels(account);
      this.recordBalanceMetrics(account, summary.id, labels);
      this.accumulateAccountTotals(account, totals);

      await this.scrapeTransfersForAccount(summary);
    }

    metrics.netWorthCents.set(totals.netWorth);
    metrics.totalAssetsCents.set(totals.totalAssets);
    metrics.totalLiabilitiesCents.set(totals.totalLiabilities);
  }

  private resetBalanceGauges(): void {
    const { metrics } = this.opts;
    metrics.accountBalanceCents.reset();
    metrics.accountAvailableBalanceCents.reset();
    metrics.accountStatementBalanceCents.reset();
    metrics.accountNextPaymentMinimumCents.reset();
  }

  private accumulateAccountTotals(account: Account, totals: NetWorthTotals): void {
    const balanceCents = account.balance?.balanceInCents ?? null;
    if (balanceCents == null) return;
    totals.netWorth += balanceCents;
    if (balanceCents >= 0) totals.totalAssets += balanceCents;
    else totals.totalLiabilities += Math.abs(balanceCents);
  }

  private aggregateAccountCounts(summaries: AccountSummary[]): void {
    const { metrics } = this.opts;
    const countsByType = new Map<string, number>();
    for (const summary of summaries) {
      countsByType.set(summary.type, (countsByType.get(summary.type) ?? 0) + 1);
    }
    metrics.accountCount.reset();
    for (const [type, count] of countsByType) {
      metrics.accountCount.set({ type }, count);
    }
  }

  private recordBalanceMetrics(account: Account, accountId: string, labels: AccountLabels): void {
    const { metrics, logger } = this.opts;
    const balance = account.balance;

    if (!balance) {
      this.incPhase("balance_missing");
      logger.warn({ accountId }, "Sequence returned no balance for account");
      return;
    }

    if (balance.error) {
      this.incPhase("balance_error");
      logger.warn(
        { accountId, balanceError: balance.error },
        "Sequence reported balance error for account",
      );
    }

    if (balance.balanceInCents != null) {
      metrics.accountBalanceCents.set(labels, balance.balanceInCents);
    }
    if (balance.availableBalanceInCents != null) {
      metrics.accountAvailableBalanceCents.set(labels, balance.availableBalanceInCents);
    }
    if (balance.lastStatementBalanceInCents != null) {
      metrics.accountStatementBalanceCents.set(labels, balance.lastStatementBalanceInCents);
    }
    if (balance.nextPaymentMinimumInCents != null) {
      metrics.accountNextPaymentMinimumCents.set(labels, balance.nextPaymentMinimumInCents);
    }
    if (balance.balanceLastUpdatedAt) {
      const ts = Date.parse(balance.balanceLastUpdatedAt);
      if (!Number.isNaN(ts)) {
        metrics.accountBalanceLastUpdatedSeconds.set(labels, ts / 1000);
      }
    }
  }

  private async scrapeTransfersForAccount(summary: AccountSummary): Promise<void> {
    const { client, logger, transfersPageSize } = this.opts;
    const maxPages = this.opts.transfersMaxPages ?? DEFAULT_MAX_TRANSFER_PAGES;
    // First scrape for an account has no stored watermark; 0 means every paginated
    // transfer (up to maxPages * transfersPageSize) is counted as the initial baseline.
    const watermark = this.lastTransferTs.get(summary.id) ?? 0;
    const state: TransferPagingState = { newest: watermark, newestTransfer: undefined };
    let lastPageWasFull = false;

    for (let page = 1; page <= maxPages; page++) {
      let transfers: Transfer[];
      try {
        const result = await this.timed("/accounts/{id}/transfers", () =>
          client.listAccountTransfers(summary.id, { page, pageSize: transfersPageSize }),
        );
        transfers = result.items;
      } catch (err) {
        this.incPhase("transfers");
        logger.warn({ err, accountId: summary.id, page }, "Failed to fetch transfers");
        return;
      }

      this.processTransferPage(summary, transfers, watermark, state);

      lastPageWasFull = transfers.length >= transfersPageSize;
      if (!lastPageWasFull) break;
    }

    if (lastPageWasFull) {
      // Loop exited because the bounded page cap was reached, not because we ran out
      // of transfers. Transfers are append-only and the watermark resumes from the
      // newest seen timestamp next scrape, so we tag the phase and continue rather
      // than abort the run.
      this.incPhase("transfers");
      logger.warn(
        { accountId: summary.id, maxPages },
        "Transfer pagination cap reached; some transfers may be unaccounted for this scrape",
      );
    }

    this.commitNewestTransfer(summary, state);
  }

  private processTransferPage(
    summary: AccountSummary,
    transfers: Transfer[],
    watermark: number,
    state: TransferPagingState,
  ): void {
    const { metrics } = this.opts;
    for (const transfer of transfers) {
      const ts = Date.parse(transfer.createdAt);
      if (Number.isNaN(ts)) continue;
      if (ts > watermark) {
        const labels = this.transferLabels(summary, transfer);
        metrics.transfersSeenTotal.inc(labels, 1);
        metrics.transferAmountCentsTotal.inc(labels, transfer.amountInCents);
      }
      if (ts > state.newest) {
        state.newest = ts;
        state.newestTransfer = transfer;
      }
    }
  }

  private commitNewestTransfer(summary: AccountSummary, state: TransferPagingState): void {
    if (!state.newestTransfer) return;
    const { metrics } = this.opts;
    this.lastTransferTs.set(summary.id, state.newest);
    metrics.transferLastTimestampSeconds.set(
      this.transferAccountLabels(summary),
      state.newest / 1000,
    );
    metrics.transferLastAmountCents.set(
      this.transferLabels(summary, state.newestTransfer),
      state.newestTransfer.amountInCents,
    );
  }

  private async timed<T>(endpoint: ScrapeEndpoint, fn: () => Promise<T>): Promise<T> {
    const end = this.opts.metrics.apiRequestDurationSeconds.startTimer({ endpoint });
    try {
      const result = await fn();
      end({ status: "ok" });
      return result;
    } catch (err) {
      const status =
        err instanceof SequenceApiError
          ? err.status > 0
            ? String(err.status)
            : err.kind
          : "error";
      end({ status });
      throw err;
    }
  }

  private incPhase(phase: ScrapePhase): void {
    this.opts.metrics.scrapeErrorsTotal.inc({ phase });
  }

  private accountLabels(account: AccountSummary): AccountLabels {
    return {
      account_id: account.id,
      account_name: account.name,
      type: account.type,
      institution: account.institutionName ?? "",
    };
  }

  private transferLabels(summary: AccountSummary, transfer: Transfer): TransferLabels {
    return {
      account_id: summary.id,
      account_name: summary.name,
      status: transfer.status,
      direction: transfer.direction,
    };
  }

  private transferAccountLabels(summary: AccountSummary): TransferAccountLabels {
    return {
      account_id: summary.id,
      account_name: summary.name,
    };
  }
}

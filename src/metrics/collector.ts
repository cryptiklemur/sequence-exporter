import type { FastifyBaseLogger } from "fastify";
import type { SequenceClient } from "../sequence/client.js";
import { SequenceApiError } from "../sequence/client.js";
import type { Account, AccountSummary, Transfer } from "../sequence/types.js";
import type { MetricsBundle } from "./registry.js";

export interface CollectorOptions {
  client: SequenceClient;
  metrics: MetricsBundle;
  logger: FastifyBaseLogger;
  intervalMs: number;
  transfersPageSize: number;
}

export class SequenceCollector {
  private readonly opts: CollectorOptions;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private stopped = false;
  private lastTransferTs = new Map<string, number>();

  constructor(opts: CollectorOptions) {
    this.opts = opts;
  }

  start(): void {
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
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const { logger, metrics } = this.opts;
    const startedAt = performance.now();
    try {
      await this.scrape();
      metrics.lastSuccessfulScrapeTimestampSeconds.set(Date.now() / 1000);
    } catch (err) {
      metrics.scrapeErrorsTotal.inc({ phase: "scrape" });
      logger.error({ err }, "Sequence scrape failed");
    } finally {
      metrics.scrapeDurationSeconds.set((performance.now() - startedAt) / 1000);
      this.running = false;
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped) return;
    await this.runOnce();
  }

  private async scrape(): Promise<void> {
    const { client, metrics, logger } = this.opts;

    const summaries = await this.timedListAccounts(client);
    const countsByType = new Map<string, number>();
    for (const summary of summaries) {
      countsByType.set(summary.type, (countsByType.get(summary.type) ?? 0) + 1);
    }
    metrics.accountCount.reset();
    for (const [type, count] of countsByType) {
      metrics.accountCount.set({ type }, count);
    }

    let netWorth = 0;
    let totalAssets = 0;
    let totalLiabilities = 0;

    metrics.accountBalanceCents.reset();
    metrics.accountAvailableBalanceCents.reset();
    metrics.accountStatementBalanceCents.reset();
    metrics.accountNextPaymentMinimumCents.reset();

    for (const summary of summaries) {
      if (summary.deletedAt) continue;
      let account: Account;
      try {
        account = await this.timedGetAccount(client, summary.id);
      } catch (err) {
        metrics.scrapeErrorsTotal.inc({ phase: "account_detail" });
        logger.warn({ err, accountId: summary.id }, "Failed to fetch account detail");
        continue;
      }

      const labels = accountLabels(account);
      const balance = account.balance;

      if (!balance) {
        metrics.scrapeErrorsTotal.inc({ phase: "balance_missing" });
        logger.warn({ accountId: summary.id }, "Sequence returned no balance for account");
        await this.scrapeTransfersForAccount(summary);
        continue;
      }

      if (balance.error) {
        metrics.scrapeErrorsTotal.inc({ phase: "balance_error" });
        logger.warn(
          { accountId: summary.id, balanceError: balance.error },
          "Sequence reported balance error for account",
        );
      }

      const balanceCents = balance.balanceInCents;
      if (balanceCents != null) {
        metrics.accountBalanceCents.set(labels, balanceCents);
        netWorth += balanceCents;
        if (balanceCents >= 0) totalAssets += balanceCents;
        else totalLiabilities += Math.abs(balanceCents);
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

      await this.scrapeTransfersForAccount(summary);
    }

    metrics.netWorthCents.set(netWorth);
    metrics.totalAssetsCents.set(totalAssets);
    metrics.totalLiabilitiesCents.set(totalLiabilities);
  }

  private async scrapeTransfersForAccount(summary: AccountSummary): Promise<void> {
    const { client, metrics, logger, transfersPageSize } = this.opts;
    let transfers: Transfer[];
    try {
      const page = await this.timedListTransfers(client, summary.id, transfersPageSize);
      transfers = page.items;
    } catch (err) {
      metrics.scrapeErrorsTotal.inc({ phase: "transfers" });
      logger.warn({ err, accountId: summary.id }, "Failed to fetch transfers");
      return;
    }
    if (transfers.length === 0) return;

    const watermark = this.lastTransferTs.get(summary.id) ?? 0;
    let newest = watermark;
    let newestTransfer: Transfer | undefined;

    for (const transfer of transfers) {
      const ts = Date.parse(transfer.createdAt);
      if (Number.isNaN(ts)) continue;
      if (ts > watermark) {
        const labels = {
          account_id: summary.id,
          account_name: summary.name,
          status: transfer.status,
          direction: transfer.direction,
        };
        metrics.transfersSeenTotal.inc(labels, 1);
        metrics.transferAmountCentsTotal.inc(labels, transfer.amountInCents);
      }
      if (ts > newest) {
        newest = ts;
        newestTransfer = transfer;
      }
    }

    if (newestTransfer) {
      this.lastTransferTs.set(summary.id, newest);
      metrics.transferLastTimestampSeconds.set(
        { account_id: summary.id, account_name: summary.name },
        newest / 1000,
      );
      metrics.transferLastAmountCents.set(
        {
          account_id: summary.id,
          account_name: summary.name,
          status: newestTransfer.status,
          direction: newestTransfer.direction,
        },
        newestTransfer.amountInCents,
      );
    }
  }

  private async timedListAccounts(client: SequenceClient): Promise<AccountSummary[]> {
    return this.timed("/accounts", () => client.listAllAccounts());
  }

  private async timedGetAccount(client: SequenceClient, id: string): Promise<Account> {
    return this.timed("/accounts/{id}", () => client.getAccount(id));
  }

  private async timedListTransfers(client: SequenceClient, accountId: string, pageSize: number) {
    return this.timed("/accounts/{id}/transfers", () =>
      client.listAccountTransfers(accountId, { page: 1, pageSize }),
    );
  }

  private async timed<T>(endpoint: string, fn: () => Promise<T>): Promise<T> {
    const end = this.opts.metrics.apiRequestDurationSeconds.startTimer({ endpoint });
    try {
      const result = await fn();
      end({ status: "ok" });
      return result;
    } catch (err) {
      const status = err instanceof SequenceApiError ? String(err.status || "error") : "error";
      end({ status });
      throw err;
    }
  }
}

function accountLabels(account: AccountSummary) {
  return {
    account_id: account.id,
    account_name: account.name,
    type: account.type,
    institution: account.institutionName ?? "",
  };
}

import { Counter, Gauge, Histogram, Registry } from "prom-client";

export interface MetricsBundle {
  registry: Registry;
  accountBalanceCents: Gauge<"account_id" | "account_name" | "type" | "institution">;
  accountAvailableBalanceCents: Gauge<"account_id" | "account_name" | "type" | "institution">;
  accountStatementBalanceCents: Gauge<"account_id" | "account_name" | "type" | "institution">;
  accountNextPaymentMinimumCents: Gauge<"account_id" | "account_name" | "type" | "institution">;
  accountBalanceLastUpdatedSeconds: Gauge<"account_id" | "account_name" | "type" | "institution">;
  netWorthCents: Gauge<string>;
  totalAssetsCents: Gauge<string>;
  totalLiabilitiesCents: Gauge<string>;
  accountCount: Gauge<"type">;
  transfersSeenTotal: Counter<"account_id" | "account_name" | "status" | "direction">;
  transferAmountCentsTotal: Counter<"account_id" | "account_name" | "status" | "direction">;
  transferLastTimestampSeconds: Gauge<"account_id" | "account_name">;
  transferLastAmountCents: Gauge<"account_id" | "account_name" | "status" | "direction">;
  scrapeDurationSeconds: Gauge<string>;
  scrapeErrorsTotal: Counter<"phase">;
  lastSuccessfulScrapeTimestampSeconds: Gauge<string>;
  apiRequestDurationSeconds: Histogram<"endpoint" | "status">;
}

export function createMetrics(): MetricsBundle {
  const registry = new Registry();
  registry.setDefaultLabels({ exporter: "sequence" });

  const accountLabels = ["account_id", "account_name", "type", "institution"] as const;

  const accountBalanceCents = new Gauge({
    name: "sequence_account_balance_cents",
    help: "Current balance in cents for a Sequence account",
    labelNames: accountLabels,
    registers: [registry],
  });

  const accountAvailableBalanceCents = new Gauge({
    name: "sequence_account_available_balance_cents",
    help: "Available balance in cents for a Sequence account",
    labelNames: accountLabels,
    registers: [registry],
  });

  const accountStatementBalanceCents = new Gauge({
    name: "sequence_account_statement_balance_cents",
    help: "Last statement balance in cents for a Sequence account",
    labelNames: accountLabels,
    registers: [registry],
  });

  const accountNextPaymentMinimumCents = new Gauge({
    name: "sequence_account_next_payment_minimum_cents",
    help: "Next payment minimum due in cents for a Sequence account",
    labelNames: accountLabels,
    registers: [registry],
  });

  const accountBalanceLastUpdatedSeconds = new Gauge({
    name: "sequence_account_balance_last_updated_seconds",
    help: "Unix timestamp of the last balance refresh reported by Sequence",
    labelNames: accountLabels,
    registers: [registry],
  });

  const netWorthCents = new Gauge({
    name: "sequence_net_worth_cents",
    help: "Sum of all account balances in cents",
    registers: [registry],
  });

  const totalAssetsCents = new Gauge({
    name: "sequence_total_assets_cents",
    help: "Sum of positive account balances in cents",
    registers: [registry],
  });

  const totalLiabilitiesCents = new Gauge({
    name: "sequence_total_liabilities_cents",
    help: "Absolute sum of negative account balances in cents",
    registers: [registry],
  });

  const accountCount = new Gauge({
    name: "sequence_account_count",
    help: "Number of Sequence accounts by type",
    labelNames: ["type"] as const,
    registers: [registry],
  });

  const transferLabels = ["account_id", "account_name", "status", "direction"] as const;

  const transfersSeenTotal = new Counter({
    name: "sequence_transfers_seen_total",
    help: "Total Sequence transfers observed since exporter start",
    labelNames: transferLabels,
    registers: [registry],
  });

  const transferAmountCentsTotal = new Counter({
    name: "sequence_transfer_amount_cents_total",
    help: "Sum of transfer amounts in cents observed since exporter start",
    labelNames: transferLabels,
    registers: [registry],
  });

  const transferLastTimestampSeconds = new Gauge({
    name: "sequence_transfer_last_timestamp_seconds",
    help: "Unix timestamp of the most recent transfer seen for an account",
    labelNames: ["account_id", "account_name"] as const,
    registers: [registry],
  });

  const transferLastAmountCents = new Gauge({
    name: "sequence_transfer_last_amount_cents",
    help: "Amount in cents of the most recent transfer seen for an account",
    labelNames: transferLabels,
    registers: [registry],
  });

  const scrapeDurationSeconds = new Gauge({
    name: "sequence_scrape_duration_seconds",
    help: "Duration of the most recent Sequence scrape in seconds",
    registers: [registry],
  });

  const scrapeErrorsTotal = new Counter({
    name: "sequence_scrape_errors_total",
    help: "Errors encountered while scraping Sequence, labeled by phase",
    labelNames: ["phase"] as const,
    registers: [registry],
  });

  const lastSuccessfulScrapeTimestampSeconds = new Gauge({
    name: "sequence_last_successful_scrape_timestamp_seconds",
    help: "Unix timestamp of the last fully successful scrape",
    registers: [registry],
  });

  const apiRequestDurationSeconds = new Histogram({
    name: "sequence_api_request_duration_seconds",
    help: "Duration of Sequence API requests in seconds",
    labelNames: ["endpoint", "status"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [registry],
  });

  return {
    registry,
    accountBalanceCents,
    accountAvailableBalanceCents,
    accountStatementBalanceCents,
    accountNextPaymentMinimumCents,
    accountBalanceLastUpdatedSeconds,
    netWorthCents,
    totalAssetsCents,
    totalLiabilitiesCents,
    accountCount,
    transfersSeenTotal,
    transferAmountCentsTotal,
    transferLastTimestampSeconds,
    transferLastAmountCents,
    scrapeDurationSeconds,
    scrapeErrorsTotal,
    lastSuccessfulScrapeTimestampSeconds,
    apiRequestDurationSeconds,
  };
}

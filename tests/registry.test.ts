import { describe, expect, it } from "vitest";
import { createMetrics } from "../src/metrics/registry.js";

describe("createMetrics", () => {
  it("returns a registry tagged with exporter=sequence", async () => {
    const metrics = createMetrics();
    const text = await metrics.registry.metrics();
    expect(text).toMatch(/exporter="sequence"/);
  });

  it("registers every expected metric on the registry", async () => {
    const metrics = createMetrics();
    const text = await metrics.registry.metrics();
    const expected = [
      "sequence_account_balance_cents",
      "sequence_account_available_balance_cents",
      "sequence_account_statement_balance_cents",
      "sequence_account_next_payment_minimum_cents",
      "sequence_account_balance_last_updated_seconds",
      "sequence_net_worth_cents",
      "sequence_total_assets_cents",
      "sequence_total_liabilities_cents",
      "sequence_account_count",
      "sequence_transfers_seen_total",
      "sequence_transfer_amount_cents_total",
      "sequence_transfer_last_timestamp_seconds",
      "sequence_transfer_last_amount_cents",
      "sequence_scrape_duration_seconds",
      "sequence_scrape_errors_total",
      "sequence_last_successful_scrape_timestamp_seconds",
      "sequence_api_request_duration_seconds",
    ];
    for (const name of expected) {
      expect(text).toContain(`# HELP ${name}`);
    }
  });

  it("uses prom-client's openmetrics content type", () => {
    const metrics = createMetrics();
    expect(metrics.registry.contentType).toMatch(/text\/plain/);
  });

  it("account-balance gauges accept the AccountLabels shape", async () => {
    const metrics = createMetrics();
    metrics.accountBalanceCents.set(
      { account_id: "a1", account_name: "Checking", type: "BANK", institution: "Bank" },
      12345,
    );
    const text = await metrics.registry.metrics();
    expect(text).toMatch(
      /sequence_account_balance_cents\{[^}]*account_id="a1"[^}]*type="BANK"[^}]*\} 12345/,
    );
  });

  it("transfer counters accept the TransferLabels shape", async () => {
    const metrics = createMetrics();
    metrics.transfersSeenTotal.inc(
      { account_id: "a1", account_name: "Checking", status: "COMPLETE", direction: "MONEY_OUT" },
      3,
    );
    const text = await metrics.registry.metrics();
    expect(text).toMatch(
      /sequence_transfers_seen_total\{[^}]*account_id="a1"[^}]*direction="MONEY_OUT"[^}]*\} 3/,
    );
  });

  it("api request histogram declares the configured buckets", async () => {
    const metrics = createMetrics();
    const end = metrics.apiRequestDurationSeconds.startTimer({ endpoint: "/accounts" });
    end({ status: "ok" });
    const text = await metrics.registry.metrics();
    for (const le of ["0.05", "0.1", "0.25", "0.5", "1", "2.5", "5", "10", "30"]) {
      expect(text).toContain(`le="${le}"`);
    }
  });
});

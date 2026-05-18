# sequence-exporter

Prometheus exporter for [Sequence](https://getsequence.io) accounts and transfers.

## What it scrapes

On each scrape interval the exporter walks every Sequence account, fetches balance detail, and pulls the recent transfer history for each account. It publishes the following metric families:

| Metric | Type | Labels |
| --- | --- | --- |
| `sequence_account_balance_cents` | gauge | `account_id`, `account_name`, `type`, `institution` |
| `sequence_account_available_balance_cents` | gauge | `account_id`, `account_name`, `type`, `institution` |
| `sequence_account_statement_balance_cents` | gauge | `account_id`, `account_name`, `type`, `institution` |
| `sequence_account_next_payment_minimum_cents` | gauge | `account_id`, `account_name`, `type`, `institution` |
| `sequence_account_balance_last_updated_seconds` | gauge | `account_id`, `account_name`, `type`, `institution` |
| `sequence_net_worth_cents` | gauge | - |
| `sequence_total_assets_cents` | gauge | - |
| `sequence_total_liabilities_cents` | gauge | - |
| `sequence_account_count` | gauge | `type` |
| `sequence_transfers_seen_total` | counter | `account_id`, `account_name`, `status`, `direction` |
| `sequence_transfer_amount_cents_total` | counter | `account_id`, `account_name`, `status`, `direction` |
| `sequence_transfer_last_timestamp_seconds` | gauge | `account_id`, `account_name` |
| `sequence_transfer_last_amount_cents` | gauge | `account_id`, `account_name`, `status`, `direction` |
| `sequence_scrape_duration_seconds` | gauge | - |
| `sequence_scrape_errors_total` | counter | `phase` |
| `sequence_last_successful_scrape_timestamp_seconds` | gauge | - |
| `sequence_api_request_duration_seconds` | histogram | `endpoint`, `status` |

All metrics carry a default label `exporter="sequence"`.

## Endpoints

| Path | Purpose |
| --- | --- |
| `/metrics` | Prometheus exposition format |
| `/healthz` | Liveness probe, returns `{ "status": "ok" }` |
| `/` | HTML landing page linking the other endpoints |

## Configuration

All configuration is via environment variables.

| Variable | Default | Description |
| --- | --- | --- |
| `SEQUENCE_API_TOKEN` | required | Bearer token for the Sequence platform API |
| `SEQUENCE_API_BASE_URL` | `https://api.getsequence.io/platform/v1` | API base URL |
| `HOST` | `0.0.0.0` | Listen address |
| `PORT` | `9464` | Listen port |
| `SCRAPE_INTERVAL_SECONDS` | `60` | Seconds between scrapes (min 5) |
| `SCRAPE_TIMEOUT_SECONDS` | `30` | Per-request timeout (min 1) |
| `TRANSFERS_PAGE_SIZE` | `50` | Page size for the `/accounts/{id}/transfers` calls |
| `LOG_LEVEL` | `info` | Fastify/pino log level |

## Module layout

```
src/
  config.ts          env parsing and validation
  index.ts           entry point: composes config + client + collector + server
  server.ts          Fastify routes (/metrics, /healthz, /)
  metrics/
    registry.ts      prom-client Registry + all Gauge/Counter/Histogram construction
  scrape/
    collector.ts     polling scheduler + scrape orchestration (accounts -> balances -> transfers)
  sequence/
    client.ts        SequenceClient (fetch + SequenceApiError + pagination)
    types.ts         API response shapes and literal-union enums
```

Dependency direction is one-way: `index -> server, scrape, metrics, sequence`. Nothing imports from `scrape/` except `index.ts`; `metrics/` is import-only and holds no runtime logic beyond registry construction.

## Running

```bash
pnpm install
SEQUENCE_API_TOKEN=... pnpm start
```

Or via Docker:

```bash
docker run -p 9464:9464 -e SEQUENCE_API_TOKEN=... ghcr.io/cryptiklemur/sequence-exporter:latest
```

## Development

```bash
pnpm run lint       # biome
pnpm run typecheck  # tsc --noEmit
pnpm run test       # vitest
pnpm run build      # tsc -> dist/
```

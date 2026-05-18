import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { type AppConfig, loadConfig } from "./config.js";
import { createMetrics } from "./metrics/registry.js";
import { SequenceCollector } from "./scrape/collector.js";
import { SequenceClient } from "./sequence/client.js";
import { createServer } from "./server.js";
import { createShutdown } from "./shutdown.js";

export interface BootstrapDeps {
  loadConfig?: () => AppConfig;
  onSignal?: (signal: NodeJS.Signals, listener: () => void) => void;
}

export interface BootstrapHandle {
  app: FastifyInstance;
  collector: SequenceCollector;
  shutdown: (signal: string) => Promise<void>;
}

export async function bootstrap(deps: BootstrapDeps = {}): Promise<BootstrapHandle> {
  const loadCfg = deps.loadConfig ?? loadConfig;
  const onSignal =
    deps.onSignal ??
    ((signal: NodeJS.Signals, listener: () => void) => {
      process.on(signal, listener);
    });

  const config = loadCfg();
  const metrics = createMetrics();
  const app = createServer({ registry: metrics.registry, logLevel: config.logLevel });

  const client = new SequenceClient({
    baseUrl: config.apiBaseUrl,
    token: config.apiToken,
    timeoutMs: config.scrapeTimeoutMs,
    userAgent: "sequence-exporter/1",
  });

  const collector = new SequenceCollector({
    client,
    metrics,
    logger: app.log,
    intervalMs: config.scrapeIntervalMs,
    transfersPageSize: config.transfersPageSize,
  });

  collector.schedule();
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { host: config.host, port: config.port, intervalMs: config.scrapeIntervalMs },
    "sequence-exporter listening",
  );

  const shutdown = createShutdown({ app, collector });
  onSignal("SIGINT", () => void shutdown("SIGINT"));
  onSignal("SIGTERM", () => void shutdown("SIGTERM"));

  return { app, collector, shutdown };
}

async function main(): Promise<void> {
  await bootstrap();
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}

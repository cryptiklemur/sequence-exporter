import { loadConfig } from "./config.js";
import { SequenceCollector } from "./metrics/collector.js";
import { createMetrics } from "./metrics/registry.js";
import { SequenceClient } from "./sequence/client.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const metrics = createMetrics();
  const app = createServer({ metrics, logLevel: config.logLevel });

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

  collector.start();
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { host: config.host, port: config.port, intervalMs: config.scrapeIntervalMs },
    "sequence-exporter listening",
  );

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, "shutting down");
    try {
      await collector.stop();
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown failed");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

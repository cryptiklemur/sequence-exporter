import Fastify, { type FastifyInstance } from "fastify";
import type { MetricsBundle } from "./metrics/registry.js";

export interface ServerOptions {
  metrics: MetricsBundle;
  logLevel: string;
}

export function createServer(opts: ServerOptions): FastifyInstance {
  const app = Fastify({
    logger: { level: opts.logLevel },
    disableRequestLogging: true,
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/metrics", async (_req, reply) => {
    const body = await opts.metrics.registry.metrics();
    reply.header("Content-Type", opts.metrics.registry.contentType);
    return body;
  });

  app.get("/", async (_req, reply) => {
    reply.header("Content-Type", "text/html; charset=utf-8");
    return `<!doctype html>
<html><head><title>Sequence Exporter</title></head>
<body><h1>Sequence Exporter</h1>
<ul>
<li><a href="/metrics">/metrics</a></li>
<li><a href="/healthz">/healthz</a></li>
</ul>
</body></html>`;
  });

  return app;
}

import { describe, expect, it } from "vitest";
import { createMetrics } from "../src/metrics/registry.js";
import { createServer } from "../src/server.js";

function buildApp() {
  const metrics = createMetrics();
  const app = createServer({ registry: metrics.registry, logLevel: "silent" });
  return { app, metrics };
}

describe("server routes", () => {
  it("GET /healthz returns 200 and { status: ok }", async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/healthz" });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ok" });
    } finally {
      await app.close();
    }
  });

  it("GET /metrics returns 200 with the registry content-type and a sequence_ metric prefix", async () => {
    const { app, metrics } = buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/metrics" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe(metrics.registry.contentType);
      expect(res.body).toContain("sequence_");
    } finally {
      await app.close();
    }
  });

  it("GET / returns 200 with HTML linking to /metrics and /healthz", async () => {
    const { app } = buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/html/);
      expect(res.body).toContain('href="/metrics"');
      expect(res.body).toContain('href="/healthz"');
    } finally {
      await app.close();
    }
  });
});

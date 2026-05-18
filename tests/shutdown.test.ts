import { describe, expect, it, vi } from "vitest";
import { createShutdown } from "../src/shutdown.js";

function makeApp() {
  return {
    close: vi.fn().mockResolvedValue(undefined),
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function makeCollector() {
  return { stop: vi.fn().mockResolvedValue(undefined) };
}

describe("createShutdown", () => {
  it("stops collector, closes app, exits 0 on success", async () => {
    const app = makeApp();
    const collector = makeCollector();
    const exit = vi.fn();
    const shutdown = createShutdown({
      app: app as unknown as Parameters<typeof createShutdown>[0]["app"],
      collector: collector as unknown as Parameters<typeof createShutdown>[0]["collector"],
      exit,
    });
    await shutdown("SIGINT");
    expect(app.log.info).toHaveBeenCalledWith({ signal: "SIGINT" }, "shutting down");
    expect(collector.stop).toHaveBeenCalledTimes(1);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
    expect(app.log.error).not.toHaveBeenCalled();
  });

  it("logs and exits 1 when collector.stop rejects", async () => {
    const app = makeApp();
    const collector = makeCollector();
    const stopErr = new Error("stop failed");
    collector.stop.mockRejectedValueOnce(stopErr);
    const exit = vi.fn();
    const shutdown = createShutdown({
      app: app as unknown as Parameters<typeof createShutdown>[0]["app"],
      collector: collector as unknown as Parameters<typeof createShutdown>[0]["collector"],
      exit,
    });
    await shutdown("SIGTERM");
    expect(collector.stop).toHaveBeenCalledTimes(1);
    expect(app.close).not.toHaveBeenCalled();
    expect(app.log.error).toHaveBeenCalledWith({ err: stopErr }, "shutdown failed");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("logs and exits 1 when app.close rejects", async () => {
    const app = makeApp();
    const collector = makeCollector();
    const closeErr = new Error("close failed");
    app.close.mockRejectedValueOnce(closeErr);
    const exit = vi.fn();
    const shutdown = createShutdown({
      app: app as unknown as Parameters<typeof createShutdown>[0]["app"],
      collector: collector as unknown as Parameters<typeof createShutdown>[0]["collector"],
      exit,
    });
    await shutdown("SIGTERM");
    expect(collector.stop).toHaveBeenCalledTimes(1);
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(app.log.error).toHaveBeenCalledWith({ err: closeErr }, "shutdown failed");
    expect(exit).toHaveBeenCalledWith(1);
  });
});

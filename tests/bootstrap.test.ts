import { afterEach, describe, expect, it, vi } from "vitest";
import { bootstrap, type BootstrapHandle } from "../src/index.js";

const baseConfig = {
  apiToken: "test-token",
  apiBaseUrl: "https://api.example.com/platform/v1",
  host: "127.0.0.1",
  port: 0,
  scrapeIntervalMs: 60_000,
  scrapeTimeoutMs: 30_000,
  transfersPageSize: 50,
  logLevel: "silent" as const,
};

describe("bootstrap", () => {
  let handle: BootstrapHandle | undefined;

  afterEach(async () => {
    if (handle) {
      await handle.collector.stop();
      await handle.app.close();
      handle = undefined;
    }
  });

  it("wires SIGINT and SIGTERM to the shutdown helper", async () => {
    const onSignal = vi.fn();
    handle = await bootstrap({
      loadConfig: () => baseConfig,
      onSignal,
    });

    expect(handle.app).toBeDefined();
    expect(handle.collector).toBeDefined();
    expect(handle.shutdown).toBeInstanceOf(Function);

    const signals = onSignal.mock.calls.map((c) => c[0]);
    expect(signals).toEqual(["SIGINT", "SIGTERM"]);

    const sigintListener = onSignal.mock.calls[0]?.[1];
    expect(sigintListener).toBeInstanceOf(Function);
  });

  it("invoking the registered SIGINT listener triggers shutdown", async () => {
    const onSignal = vi.fn();
    handle = await bootstrap({
      loadConfig: () => baseConfig,
      onSignal,
    });

    const collectorStop = vi.spyOn(handle.collector, "stop").mockResolvedValue();
    const appClose = vi.spyOn(handle.app, "close").mockResolvedValue();
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((_code?: number) => {
      return undefined as never;
    }) as (code?: number) => never);

    try {
      const sigintListener = onSignal.mock.calls[0]?.[1] as () => void;
      sigintListener();
      await new Promise((resolve) => setImmediate(resolve));

      expect(collectorStop).toHaveBeenCalledTimes(1);
      expect(appClose).toHaveBeenCalledTimes(1);
    } finally {
      exitSpy.mockRestore();
    }
  });
});

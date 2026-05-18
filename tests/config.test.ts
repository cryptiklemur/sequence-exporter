import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("requires SEQUENCE_API_TOKEN", () => {
    expect(() => loadConfig({})).toThrow(/SEQUENCE_API_TOKEN/);
  });

  it("returns defaults when only token is set", () => {
    const config = loadConfig({ SEQUENCE_API_TOKEN: "abc" });
    expect(config.apiToken).toBe("abc");
    expect(config.apiBaseUrl).toBe("https://api.getsequence.io/platform/v1");
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9464);
    expect(config.scrapeIntervalMs).toBe(60_000);
    expect(config.scrapeTimeoutMs).toBe(30_000);
    expect(config.transfersPageSize).toBe(50);
    expect(config.logLevel).toBe("info");
  });

  it("respects overrides", () => {
    const config = loadConfig({
      SEQUENCE_API_TOKEN: "abc",
      SEQUENCE_API_BASE_URL: "https://api.example.com/v1",
      HOST: "127.0.0.1",
      PORT: "8080",
      SCRAPE_INTERVAL_SECONDS: "30",
      SCRAPE_TIMEOUT_SECONDS: "10",
      TRANSFERS_PAGE_SIZE: "25",
      LOG_LEVEL: "debug",
    });
    expect(config.apiBaseUrl).toBe("https://api.example.com/v1");
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(8080);
    expect(config.scrapeIntervalMs).toBe(30_000);
    expect(config.scrapeTimeoutMs).toBe(10_000);
    expect(config.transfersPageSize).toBe(25);
    expect(config.logLevel).toBe("debug");
  });

  it("rejects non-integer numeric env vars", () => {
    expect(() => loadConfig({ SEQUENCE_API_TOKEN: "abc", PORT: "not-a-number" })).toThrow(
      /PORT must be an integer/,
    );
  });

  it("rejects too-small scrape interval", () => {
    expect(() => loadConfig({ SEQUENCE_API_TOKEN: "abc", SCRAPE_INTERVAL_SECONDS: "1" })).toThrow(
      /SCRAPE_INTERVAL_SECONDS/,
    );
  });

  it("rejects too-small scrape timeout", () => {
    expect(() => loadConfig({ SEQUENCE_API_TOKEN: "abc", SCRAPE_TIMEOUT_SECONDS: "0" })).toThrow(
      /SCRAPE_TIMEOUT_SECONDS/,
    );
  });
});

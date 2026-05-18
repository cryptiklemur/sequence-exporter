export interface AppConfig {
  apiToken: string;
  apiBaseUrl: string;
  host: string;
  port: number;
  scrapeIntervalMs: number;
  scrapeTimeoutMs: number;
  transfersPageSize: number;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const apiToken = required(env, "SEQUENCE_API_TOKEN");
  const apiBaseUrl = env.SEQUENCE_API_BASE_URL ?? "https://api.getsequence.io/platform/v1";
  const host = env.HOST ?? "0.0.0.0";
  const port = parseIntEnv(env, "PORT", 9464);
  const scrapeIntervalSeconds = parseIntEnv(env, "SCRAPE_INTERVAL_SECONDS", 60);
  const scrapeTimeoutSeconds = parseIntEnv(env, "SCRAPE_TIMEOUT_SECONDS", 30);
  const transfersPageSize = parseIntEnv(env, "TRANSFERS_PAGE_SIZE", 50);
  const logLevel = env.LOG_LEVEL ?? "info";

  if (scrapeIntervalSeconds < 5) {
    throw new Error("SCRAPE_INTERVAL_SECONDS must be >= 5");
  }
  if (scrapeTimeoutSeconds < 1) {
    throw new Error("SCRAPE_TIMEOUT_SECONDS must be >= 1");
  }

  return {
    apiToken,
    apiBaseUrl,
    host,
    port,
    scrapeIntervalMs: scrapeIntervalSeconds * 1000,
    scrapeTimeoutMs: scrapeTimeoutSeconds * 1000,
    transfersPageSize,
    logLevel,
  };
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function parseIntEnv(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${key} must be an integer, got: ${raw}`);
  }
  return parsed;
}

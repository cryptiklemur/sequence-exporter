import type {
  Account,
  AccountSummary,
  AccountType,
  ApiEnvelope,
  PaginatedData,
  Transfer,
} from "./types.js";

export interface SequenceClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  userAgent?: string;
  accountsPageSize?: number;
  accountsMaxPages?: number;
}

export type SequenceApiErrorKind = "http" | "timeout" | "network" | "pagination_cap";

export class SequenceApiError extends Error {
  readonly requestId: string | undefined;
  readonly endpoint: string;
  readonly kind: SequenceApiErrorKind;
  constructor(
    message: string,
    readonly status: number,
    opts: {
      endpoint: string;
      requestId?: string;
      kind?: SequenceApiErrorKind;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "SequenceApiError";
    this.endpoint = opts.endpoint;
    this.requestId = opts.requestId;
    this.kind = opts.kind ?? "http";
  }
}

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

const DEFAULT_ACCOUNTS_PAGE_SIZE = 50;
const DEFAULT_MAX_ACCOUNT_PAGES = 100;

export class SequenceClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly accountsPageSize: number;
  private readonly accountsMaxPages: number;

  constructor(opts: SequenceClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs;
    this.userAgent = opts.userAgent ?? "sequence-exporter";
    this.accountsPageSize = opts.accountsPageSize ?? DEFAULT_ACCOUNTS_PAGE_SIZE;
    this.accountsMaxPages = opts.accountsMaxPages ?? DEFAULT_MAX_ACCOUNT_PAGES;
  }

  /**
   * Lists a single page of accounts.
   * @throws {SequenceApiError} on non-2xx responses, timeout, or network failure
   */
  async listAccounts(params?: {
    page?: number;
    pageSize?: number;
    type?: AccountType;
  }): Promise<PaginatedData<AccountSummary>> {
    return this.get<PaginatedData<AccountSummary>>(`/accounts${buildQuery(params ?? {})}`);
  }

  /**
   * Fetches full detail for a single account, including balance.
   * @throws {SequenceApiError} on non-2xx responses, timeout, or network failure
   */
  async getAccount(id: string): Promise<Account> {
    return this.get<Account>(`/accounts/${encodeURIComponent(id)}`);
  }

  /**
   * Lists a single page of transfers for one account.
   * @throws {SequenceApiError} on non-2xx responses, timeout, or network failure
   */
  async listAccountTransfers(
    accountId: string,
    params?: { page?: number; pageSize?: number },
  ): Promise<PaginatedData<Transfer>> {
    return this.get<PaginatedData<Transfer>>(
      `/accounts/${encodeURIComponent(accountId)}/transfers${buildQuery(params ?? {})}`,
    );
  }

  /**
   * Walks all account pages and returns the flattened list.
   * Throws SequenceApiError(kind="pagination_cap") when more than `maxPages` pages
   * would be needed (truncating would silently zero net-worth math, so we fail loud).
   * @throws {SequenceApiError} kind="http" | "timeout" | "network" | "pagination_cap"
   */
  async listAllAccounts(
    params: { pageSize?: number; maxPages?: number } = {},
  ): Promise<AccountSummary[]> {
    const pageSize = params.pageSize ?? this.accountsPageSize;
    const maxPages = params.maxPages ?? this.accountsMaxPages;
    const out: AccountSummary[] = [];
    let page = 1;
    while (true) {
      const result = await this.listAccounts({ page, pageSize });
      out.push(...result.items);
      if (result.items.length < pageSize) return out;
      if (page >= maxPages) {
        // Accounts are the seed of every scrape; partial truncation would silently
        // drop balances and zero out net-worth math, so we throw and fail the scrape.
        throw new SequenceApiError(
          `Sequence accounts pagination cap reached after ${maxPages} pages (pageSize=${pageSize}); raise maxPages if this is expected`,
          0,
          { endpoint: "/accounts", kind: "pagination_cap" },
        );
      }
      page += 1;
    }
  }

  private async get<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
          "User-Agent": this.userAgent,
          "x-called-reason": "Prometheus exporter scraping balances and transfers for monitoring",
        },
        signal: controller.signal,
      });

      const requestId = response.headers.get("x-request-id") ?? undefined;

      if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new SequenceApiError(
          `Sequence API ${response.status} for ${path}: ${bodyText.slice(0, 200)}`,
          response.status,
          { endpoint: path, requestId },
        );
      }

      const envelope = (await response.json()) as ApiEnvelope<T>;
      return envelope.data;
    } catch (err) {
      if (err instanceof SequenceApiError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new SequenceApiError(
          `Sequence API request to ${path} timed out after ${this.timeoutMs}ms`,
          0,
          { endpoint: path, kind: "timeout", cause: err },
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new SequenceApiError(
        `Sequence API request to ${path} failed: ${message}`,
        0,
        { endpoint: path, kind: "network", cause: err },
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

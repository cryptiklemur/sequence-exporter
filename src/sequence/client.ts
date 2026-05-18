import type { Account, AccountSummary, ApiEnvelope, PaginatedData, Transfer } from "./types.js";

export interface SequenceClientOptions {
  baseUrl: string;
  token: string;
  timeoutMs: number;
  userAgent?: string;
}

export class SequenceApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly requestId: string | undefined,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = "SequenceApiError";
  }
}

export class SequenceClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(opts: SequenceClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs;
    this.userAgent = opts.userAgent ?? "sequence-exporter";
  }

  async listAccounts(params?: {
    page?: number;
    pageSize?: number;
    type?: string;
  }): Promise<PaginatedData<AccountSummary>> {
    const search = new URLSearchParams();
    if (params?.page !== undefined) search.set("page", String(params.page));
    if (params?.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    if (params?.type !== undefined) search.set("type", params.type);
    const qs = search.toString();
    return this.get<PaginatedData<AccountSummary>>(`/accounts${qs ? `?${qs}` : ""}`);
  }

  async getAccount(id: string): Promise<Account> {
    return this.get<Account>(`/accounts/${encodeURIComponent(id)}`);
  }

  async listAccountTransfers(
    accountId: string,
    params?: { page?: number; pageSize?: number },
  ): Promise<PaginatedData<Transfer>> {
    const search = new URLSearchParams();
    if (params?.page !== undefined) search.set("page", String(params.page));
    if (params?.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
    const qs = search.toString();
    return this.get<PaginatedData<Transfer>>(
      `/accounts/${encodeURIComponent(accountId)}/transfers${qs ? `?${qs}` : ""}`,
    );
  }

  async listAllAccounts(pageSize = 50): Promise<AccountSummary[]> {
    const out: AccountSummary[] = [];
    let page = 1;
    while (true) {
      const result = await this.listAccounts({ page, pageSize });
      out.push(...result.items);
      if (result.items.length < pageSize) break;
      page += 1;
      if (page > 100) break;
    }
    return out;
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
          requestId,
          path,
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
          undefined,
          path,
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new SequenceApiError(
        `Sequence API request to ${path} failed: ${message}`,
        0,
        undefined,
        path,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

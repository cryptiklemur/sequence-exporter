import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SequenceApiError, SequenceClient } from "../src/sequence/client.js";

describe("SequenceClient", () => {
  const baseUrl = "https://api.example.com/platform/v1";
  let client: SequenceClient;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    client = new SequenceClient({ baseUrl, token: "test-token", timeoutMs: 5000 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function okResponse<T>(data: T) {
    return new Response(JSON.stringify({ data, requestId: "req-1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("sends Authorization: Bearer header", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ items: [], pagination: { page: 1, pageSize: 50 } }),
    );
    await client.listAccounts();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("sends x-called-reason header", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ items: [], pagination: { page: 1, pageSize: 50 } }),
    );
    await client.listAccounts();
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-called-reason"]).toMatch(/Prometheus/);
  });

  it("constructs paginated account URL with query params", async () => {
    fetchMock.mockResolvedValueOnce(
      okResponse({ items: [], pagination: { page: 2, pageSize: 25 } }),
    );
    await client.listAccounts({ page: 2, pageSize: 25, type: "POD" });
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain(`${baseUrl}/accounts?`);
    expect(url).toContain("page=2");
    expect(url).toContain("pageSize=25");
    expect(url).toContain("type=POD");
  });

  it("unwraps the data envelope", async () => {
    fetchMock.mockResolvedValueOnce(okResponse({ id: "acc-1", name: "Test" }));
    const account = await client.getAccount("acc-1");
    expect(account).toMatchObject({ id: "acc-1", name: "Test" });
  });

  it("throws SequenceApiError on non-2xx", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED" } }), { status: 401 }),
    );
    const err = await client.getAccount("acc-1").catch((e) => e);
    expect(err).toBeInstanceOf(SequenceApiError);
    expect(err.status).toBe(401);
  });

  it("paginates listAllAccounts until short page", async () => {
    fetchMock
      .mockResolvedValueOnce(
        okResponse({
          items: Array.from({ length: 50 }, (_, i) => ({ id: `a${i}` })),
          pagination: { page: 1, pageSize: 50 },
        }),
      )
      .mockResolvedValueOnce(
        okResponse({
          items: [{ id: "a50" }, { id: "a51" }],
          pagination: { page: 2, pageSize: 50 },
        }),
      );

    const all = await client.listAllAccounts(50);
    expect(all).toHaveLength(52);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

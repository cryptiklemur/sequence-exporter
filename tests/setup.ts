import { beforeEach } from "vitest";

const POISON_MESSAGE =
  "fetch was called from a test without being mocked. Use vi.stubGlobal('fetch', mockFn) in beforeEach to set up a mock, or pass a mocked client to SequenceCollector. Tests must never hit the real Sequence API.";

function poisonFetch(): never {
  throw new Error(POISON_MESSAGE);
}

beforeEach(() => {
  globalThis.fetch = poisonFetch as unknown as typeof fetch;
});

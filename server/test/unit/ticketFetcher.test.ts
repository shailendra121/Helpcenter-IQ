import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/zendesk/getValidAccessToken.js", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("fake-access-token"),
}));

const { fetchTicketPage } = await import("../../src/zendesk/ticketFetcher.js");

describe("fetchTicketPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed tickets on a successful response", async () => {
    const mockResponse = {
      tickets: [{ id: 1, subject: "Test ticket", status: "open", tags: [], created_at: "2026-01-01T00:00:00Z", generated_timestamp: 1 }],
      end_of_stream: true,
      after_cursor: "cursor-abc",
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    }) as unknown as typeof fetch;

    const result = await fetchTicketPage("d3v-astonous", 1700000000);

    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0].subject).toBe("Test ticket");
    expect(result.end_of_stream).toBe(true);
  });

  it("retries on 429 and eventually succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: false,
          status: 429,
          headers: new Headers({ "Retry-After": "0" }),
          json: async () => ({}),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ tickets: [], end_of_stream: true, after_cursor: "cursor-x" }),
      };
    }) as unknown as typeof fetch;

    const result = await fetchTicketPage("d3v-astonous", 1700000000);

    expect(callCount).toBe(2);
    expect(result.end_of_stream).toBe(true);
  });

  it("throws after exhausting retries on repeated 429s", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "0" }),
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(fetchTicketPage("d3v-astonous", 1700000000)).rejects.toThrow(
      "Rate limited by Zendesk"
    );
  }, 10000);

  it("throws on a non-429 error response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers(),
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(fetchTicketPage("d3v-astonous", 1700000000)).rejects.toThrow(
      "Zendesk incremental export failed"
    );
  });
});
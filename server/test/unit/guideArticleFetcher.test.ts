import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/zendesk/getValidAccessToken.js", () => ({
  getValidAccessToken: vi.fn().mockResolvedValue("fake-access-token"),
}));

const { fetchArticlePage, cleanArticleBody } = await import(
  "../../src/zendesk/guideArticleFetcher.js"
);

describe("fetchArticlePage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed articles on a successful response", async () => {
    const mockResponse = {
      articles: [{ id: 1, title: "Test Article", body: "<p>Hello</p>", locale: "en-us", draft: false, section_id: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
      next_page: null,
      end_time: 1700000000,
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockResponse,
    }) as unknown as typeof fetch;

    const result = await fetchArticlePage("d3v-astonous", 1700000000);

    expect(result.articles).toHaveLength(1);
    expect(result.next_page).toBeNull();
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
        json: async () => ({ articles: [], next_page: null, end_time: 1700000000 }),
      };
    }) as unknown as typeof fetch;

    const result = await fetchArticlePage("d3v-astonous", 1700000000);

    expect(callCount).toBe(2);
    expect(result.next_page).toBeNull();
  });

  it("throws after exhausting retries on repeated 429s", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "0" }),
      json: async () => ({}),
    }) as unknown as typeof fetch;

    await expect(fetchArticlePage("d3v-astonous", 1700000000)).rejects.toThrow(
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

    await expect(fetchArticlePage("d3v-astonous", 1700000000)).rejects.toThrow(
      "Zendesk incremental articles export failed"
    );
  });
});

describe("cleanArticleBody", () => {
  it("strips HTML tags and returns plain text", () => {
    const result = cleanArticleBody("<p>Hello <b>world</b></p>");
    expect(result).toBe("Hello world");
  });

  it("returns empty string for null input", () => {
    expect(cleanArticleBody(null)).toBe("");
  });
});
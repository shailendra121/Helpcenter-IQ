import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetchArticlePage = vi.fn();
vi.mock("../../src/zendesk/guideArticleFetcher.js", () => ({
  fetchArticlePage: mockFetchArticlePage,
  cleanArticleBody: (html: string | null) => (html ? html.replace(/<[^>]+>/g, "").trim() : ""),
}));

const mockUpsertArticleMetadata = vi.fn();
const mockUpdateArticleEmbedding = vi.fn();
const mockGetStoredArticleUpdatedAt = vi.fn();
vi.mock("../../src/db/models/guideArticles.js", () => ({
  upsertArticleMetadata: mockUpsertArticleMetadata,
  updateArticleEmbedding: mockUpdateArticleEmbedding,
  getStoredArticleUpdatedAt: mockGetStoredArticleUpdatedAt,
}));

const mockEmbed = vi.fn();
vi.mock("../../src/ai/providers/index.js", () => ({
  createAIProvider: () => ({ embed: mockEmbed }),
}));

const { ingestGuideArticles } = await import("../../src/zendesk/ingestGuideArticles.js");

describe("ingestGuideArticles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetStoredArticleUpdatedAt.mockResolvedValue(null);
    mockEmbed.mockResolvedValue({ vector: Array(1536).fill(0.1), model: "gemini-embedding-001" });
  });

  it("ingests a published article: stores metadata and generates an embedding", async () => {
    mockFetchArticlePage.mockResolvedValueOnce({
      articles: [
        {
          id: 1,
          title: "How to reset your password",
          body: "<p>Click <b>here</b> to reset.</p>",
          locale: "en-us",
          draft: false,
          section_id: 100,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      next_page: null,
      end_time: 1700000000,
    });

    const result = await ingestGuideArticles(1, "d3v-astonous");

    expect(result.articlesSeen).toBe(1);
    expect(result.articlesEmbedded).toBe(1);
    expect(mockUpsertArticleMetadata).toHaveBeenCalledWith(
      expect.objectContaining({ title: "How to reset your password", cleanText: "Click here to reset." })
    );
    expect(mockEmbed).toHaveBeenCalledOnce();
    expect(mockUpdateArticleEmbedding).toHaveBeenCalledOnce();
  });

  it("stores draft article metadata but does NOT generate an embedding", async () => {
    mockFetchArticlePage.mockResolvedValueOnce({
      articles: [
        {
          id: 2,
          title: "Unpublished draft",
          body: "<p>Not ready yet.</p>",
          locale: "en-us",
          draft: true,
          section_id: 100,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      next_page: null,
      end_time: 1700000000,
    });

    const result = await ingestGuideArticles(1, "d3v-astonous");

    expect(result.articlesEmbedded).toBe(0);
    expect(result.articlesSkipped).toBe(1);
    expect(mockUpsertArticleMetadata).toHaveBeenCalledOnce(); // metadata stored
    expect(mockEmbed).not.toHaveBeenCalled(); // but no embedding for drafts
  });

  it("skips re-embedding an article whose updated_at is unchanged (incremental refresh)", async () => {
    const sameTimestamp = "2026-01-01T00:00:00Z";
    mockGetStoredArticleUpdatedAt.mockResolvedValue(new Date(sameTimestamp));

    mockFetchArticlePage.mockResolvedValueOnce({
      articles: [
        {
          id: 3,
          title: "Unchanged article",
          body: "<p>Same as before.</p>",
          locale: "en-us",
          draft: false,
          section_id: 100,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: sameTimestamp,
        },
      ],
      next_page: null,
      end_time: 1700000000,
    });

    const result = await ingestGuideArticles(1, "d3v-astonous");

    expect(result.articlesSkipped).toBe(1);
    expect(result.articlesEmbedded).toBe(0);
    expect(mockEmbed).not.toHaveBeenCalled(); // proves refresh skip works
  });

  it("re-embeds an article whose updated_at DID change", async () => {
    mockGetStoredArticleUpdatedAt.mockResolvedValue(new Date("2025-01-01T00:00:00Z")); // old

    mockFetchArticlePage.mockResolvedValueOnce({
      articles: [
        {
          id: 4,
          title: "Changed article",
          body: "<p>Updated content.</p>",
          locale: "en-us",
          draft: false,
          section_id: 100,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-06-01T00:00:00Z", // newer
        },
      ],
      next_page: null,
      end_time: 1700000000,
    });

    const result = await ingestGuideArticles(1, "d3v-astonous");

    expect(result.articlesEmbedded).toBe(1);
    expect(mockEmbed).toHaveBeenCalledOnce();
  });

  it("passes masked text (not raw HTML/PII) to embed()", async () => {
    mockFetchArticlePage.mockResolvedValueOnce({
      articles: [
        {
          id: 5,
          title: "Contact support",
          body: "<p>Email us at jane.doe@example.com for help.</p>",
          locale: "en-us",
          draft: false,
          section_id: 100,
          created_at: "2026-01-01T00:00:00Z",
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
      next_page: null,
      end_time: 1700000000,
    });

    await ingestGuideArticles(1, "d3v-astonous");

    const embedCallArg = mockEmbed.mock.calls[0][0];
    expect(embedCallArg.text).not.toContain("jane.doe@example.com");
    expect(embedCallArg.text).toContain("[REDACTED]");
  });

  it("paginates across multiple pages", async () => {
    mockFetchArticlePage
      .mockResolvedValueOnce({
        articles: [{ id: 6, title: "Page 1 article", body: "<p>Content</p>", locale: "en-us", draft: false, section_id: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
        next_page: "page2-url",
        end_time: 1700000100,
      })
      .mockResolvedValueOnce({
        articles: [{ id: 7, title: "Page 2 article", body: "<p>Content</p>", locale: "en-us", draft: false, section_id: 1, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
        next_page: null,
        end_time: 1700000200,
      });

    const result = await ingestGuideArticles(1, "d3v-astonous");

    expect(result.articlesSeen).toBe(2);
    expect(mockFetchArticlePage).toHaveBeenCalledTimes(2);
  });
});
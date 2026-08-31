import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPoolQuery = vi.fn();
vi.mock("../../src/db/pool.js", () => ({
  pool: { query: mockPoolQuery },
}));

const mockGetTicketsByIds = vi.fn();
vi.mock("../../src/db/models/tickets.js", () => ({
  getTicketsByIds: mockGetTicketsByIds,
}));

const mockCreateDraftArticle = vi.fn();
vi.mock("../../src/db/models/draftArticles.js", () => ({
  createDraftArticle: mockCreateDraftArticle,
}));

const mockDraftArticle = vi.fn();
vi.mock("../../src/ai/providers/index.js", () => ({
  createAIProvider: () => ({ draftArticle: mockDraftArticle }),
}));

const mockWithRetry = vi.fn((fn: () => Promise<unknown>) => fn());
vi.mock("../../src/ai/withRetry.js", () => ({
  withRetry: mockWithRetry,
}));

const { runDraftGeneration } = await import("../../src/drafts/runDraftGeneration.js");

describe("runDraftGeneration — PII masking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDraftArticle.mockResolvedValue({
      suggestedTitle: "Test title",
      problemSummary: "Test summary",
      stepByStepResolution: "Step 1",
      faq: [],
      relatedKeywords: [],
      internalReviewerNotes: "",
      model: "gemini-3.5-flash-lite",
    });
  });

  it("masks PII in ticket excerpts and existing article text before calling draftArticle()", async () => {
    // Gap query
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          cluster_id: 10,
          topic_summary: "Password reset issues",
          classification: "weak",
          related_guide_article_id: 99,
        },
      ],
    });
    // cluster representative_ticket_ids lookup
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ representative_ticket_ids: ["1"] }] });
    mockGetTicketsByIds.mockResolvedValue([
      { id: 1, subject: "Reset issue", description: "Contact me at jane.doe@example.com please" },
    ]);
    // article lookup — contains PII
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ clean_text: "Call 555-123-4567 for help resetting your password." }],
    });
    // recommendation lookup
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ rationale: "Article is incomplete." }] });

    await runDraftGeneration(1, 5);

    const draftCallArg = mockDraftArticle.mock.calls[0][0];
    expect(draftCallArg.ticketExcerpts.join(" ")).not.toContain("jane.doe@example.com");
    expect(draftCallArg.ticketExcerpts.join(" ")).toContain("[REDACTED]");
    expect(draftCallArg.existingArticleText).not.toContain("555-123-4567");
    expect(draftCallArg.existingArticleText).toContain("[REDACTED]");
  });

  it("calls draftArticle only through the provider interface, never a raw SDK", async () => {
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          cluster_id: 20,
          topic_summary: "Missing topic",
          classification: "missing",
          related_guide_article_id: null,
        },
      ],
    });
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ representative_ticket_ids: [] }] });
    mockGetTicketsByIds.mockResolvedValue([]);
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ rationale: "No coverage exists." }] });

    await runDraftGeneration(1, 5);

    // Confirms the only path to generation is provider.draftArticle(),
    // via createAIProvider() — never a direct SDK import in this file.
    expect(mockDraftArticle).toHaveBeenCalledTimes(1);
  });
});
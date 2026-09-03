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

const mockGenerateText = vi.fn();

vi.mock("../../src/ai/providers/index.js", () => ({
  createAIProvider: () => ({
    generateText: mockGenerateText,
  }),
}));

const mockWithRetry = vi.fn((fn: () => Promise<unknown>) => fn());

vi.mock("../../src/ai/withRetry.js", () => ({
  withRetry: mockWithRetry,
}));

const { runDraftGeneration } = await import(
  "../../src/drafts/runDraftGeneration.js"
);

describe("runDraftGeneration — PII masking", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        suggestedTitle: "Test title",
        problemSummary: "Test summary",
        stepByStepResolution: "Step 1",
        faq: [],
        relatedKeywords: [],
        internalReviewerNotes: "",
      }),
      model: "gemini-3.5-flash-lite",
    });

    mockCreateDraftArticle.mockResolvedValue(123);
  });

  it("masks PII in ticket excerpts and existing article text before sending them to the AI provider", async () => {
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

    // Cluster representative ticket IDs
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ representative_ticket_ids: ["1"] }],
    });

    mockGetTicketsByIds.mockResolvedValue([
      {
        id: 1,
        subject: "Reset issue",
        description:
          "Contact me at jane.doe@example.com please",
      },
    ]);

    // Existing article containing PII
    mockPoolQuery.mockResolvedValueOnce({
      rows: [
        {
          clean_text:
            "Call 555-123-4567 for help resetting your password.",
        },
      ],
    });

    // Recommendation rationale
    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ rationale: "Article is incomplete." }],
    });

    await runDraftGeneration(1, 5);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);

    const generateTextArg = mockGenerateText.mock.calls[0][0];

    expect(generateTextArg.prompt).not.toContain(
      "jane.doe@example.com"
    );
    expect(generateTextArg.prompt).not.toContain(
      "555-123-4567"
    );

    expect(generateTextArg.prompt).toContain("[REDACTED]");
  });

  it("calls AI generation only through the provider interface", async () => {
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

    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ representative_ticket_ids: [] }],
    });

    mockGetTicketsByIds.mockResolvedValue([]);

    mockPoolQuery.mockResolvedValueOnce({
      rows: [{ rationale: "No coverage exists." }],
    });

    await runDraftGeneration(1, 5);

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });
});


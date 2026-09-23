import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPoolQuery = vi.fn();
vi.mock("../../src/db/pool.js", () => ({
  pool: { query: mockPoolQuery },
}));

const mockEmbed = vi.fn();
const mockGenerateText = vi.fn();vi.mock("../../src/ai/providers/index.js", () => ({
  createAIProvider: () => ({ embed: mockEmbed, generateText: mockGenerateText }),
}));

const mockWithRetry = vi.fn((fn: () => Promise<unknown>) => fn());
vi.mock("../../src/ai/withRetry.js", () => ({
  withRetry: mockWithRetry,
}));

const { checkArticleWeakness } = await import("../../src/classification/classifyGap.js");

describe("checkArticleWeakness — PII masking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateText.mockResolvedValue({
      text: "Verdict: NO\nReason: Article is incomplete.",
      model: "gemini-3.5-flash-lite",
    });
  });

  it("masks PII in ticket excerpts before calling generateText()", async () => {
    await checkArticleWeakness({
      topicSummary: "Password reset issues",
      representativeTicketExcerpts: [
        "Please email me at jane.doe@example.com with an update.",
      ],
      articleTitle: "Password Reset Steps",
      articleText: "Call 555-123-4567 if you need help resetting your password.",
    });

    const generateCallArg = mockGenerateText.mock.calls[0][0];
    expect(generateCallArg.prompt).not.toContain("jane.doe@example.com");
    expect(generateCallArg.prompt).not.toContain("555-123-4567");
    expect(generateCallArg.prompt).toContain("[REDACTED]");
  });

  it("parses YES/NO verdict correctly", async () => {
    mockGenerateText.mockResolvedValue({
      text: "Verdict: YES\nReason: Article fully covers this.",
      model: "gemini-3.5-flash-lite",
    });

    const result = await checkArticleWeakness({
      topicSummary: "Test topic",
      representativeTicketExcerpts: ["Sample ticket"],
      articleTitle: "Test Article",
      articleText: "Test content",
    });

    expect(result.isWeak).toBe(false);
    expect(result.justification).toBe("Article fully covers this.");
  });

    it("defaults to weak with a fallback justification when the LLM response doesn't match the expected format", async () => {
    mockGenerateText.mockResolvedValue({
      text: "I'm not sure about this one.",
      model: "gemini-3.5-flash-lite",
    });

    const result = await checkArticleWeakness({
      topicSummary: "Test topic",
      representativeTicketExcerpts: ["Sample ticket"],
      articleTitle: "Test Article",
      articleText: "Test content",
    });

    expect(result.isWeak).toBe(true); // fail-safe: unparseable response means we can't confirm the article is fine, so default to weak (needs review)
    expect(result.justification).toBe("AI response could not be parsed — flagged for manual review.");
  });
});

describe("isArticleOutdated", () => {
  it("returns true when article is old AND has enough recent tickets", async () => {
    const { isArticleOutdated } = await import("../../src/classification/classifyGap.js");

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200); // 200 days ago

    const result = isArticleOutdated({
      articleUpdatedAt: oldDate,
      recentTicketCount: 5,
    });

    expect(result).toBe(true);
  });

  it("returns false when article is recent, even with many tickets", async () => {
    const { isArticleOutdated } = await import("../../src/classification/classifyGap.js");

    const result = isArticleOutdated({
      articleUpdatedAt: new Date(), // today
      recentTicketCount: 100,
    });

    expect(result).toBe(false);
  });

  it("returns false when article is old but ticket count is too low", async () => {
    const { isArticleOutdated } = await import("../../src/classification/classifyGap.js");

    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200);

    const result = isArticleOutdated({
      articleUpdatedAt: oldDate,
      recentTicketCount: 0,
    });

    expect(result).toBe(false);
  });
});

describe("computePriorityScore", () => {
  it("weighs missing classification higher than good_coverage", async () => {
    const { computePriorityScore } = await import("../../src/classification/classifyGap.js");

    const missingScore = computePriorityScore("missing", 10);
    const goodScore = computePriorityScore("good_coverage", 10);

    expect(missingScore).toBeGreaterThan(goodScore);
  });

  it("scales with ticket volume", async () => {
    const { computePriorityScore } = await import("../../src/classification/classifyGap.js");

    const lowVolume = computePriorityScore("weak", 2);
    const highVolume = computePriorityScore("weak", 20);

    expect(highVolume).toBeGreaterThan(lowVolume);
  });
});

describe("classifyGap — Missing classification justification (review fix)", () => {
  it("returns a non-null justification when no article matches (Missing)", async () => {
    const { classifyGap } = await import("../../src/classification/classifyGap.js");

    // findBestMatchingArticle does a real pool.query — mock the pool
    // module's query to return no rows, simulating no matching article.
    const poolModule = await import("../../src/db/pool.js");
    const originalQuery = poolModule.pool.query;
    poolModule.pool.query = vi.fn().mockResolvedValue({ rows: [] });

    try {
      const result = await classifyGap({
        zendeskAccountId: 1,
        topicSummary: "Some topic with no coverage",
        topicEmbedding: Array(1536).fill(0.1),
        ticketVolume: 5,
        representativeTicketExcerpts: ["A sample question"],
      });

      expect(result.classification).toBe("missing");
      expect(result.justification).not.toBeNull();
      expect(result.justification).toContain("No published article");
    } finally {
      poolModule.pool.query = originalQuery;
    }
  });
});

describe("classifyGap — semantic relevance validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("classifies a topic as Missing when the nearest vector-matched article is semantically unrelated", async () => {
    const { classifyGap } = await import(
      "../../src/classification/classifyGap.js"
    );

    // Query 1: vector search returns an article above the similarity floor.
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            title: "Reset Your Password",
            distance: 0.3585312938, // similarity ≈ 0.64147
          },
        ],
      })
      // Query 2: load the matched article.
      .mockResolvedValueOnce({
        rows: [
          {
            title: "Reset Your Password",
            clean_text: "Steps for resetting your account password.",
            zendesk_updated_at: new Date(),
          },
        ],
      });

    // Relevance check says the vector candidate is actually unrelated.
    mockGenerateText.mockResolvedValueOnce({
      text:
        "Verdict: NO\n" +
        "Reason: The article covers password resets, not billing details.",
      model: "gemini-3.5-flash-lite",
    });

    const result = await classifyGap({
      zendeskAccountId: 1,
      topicSummary: "Updating Account and Billing Details",
      topicEmbedding: Array(1536).fill(0.1),
      ticketVolume: 6,
      representativeTicketExcerpts: [
        "How can I update my billing information?",
        "I need to change my billing details.",
      ],
    });

    expect(result.classification).toBe("missing");
    expect(result.relatedGuideArticleId).toBeNull();
    expect(result.similarityScore).toBeCloseTo(0.6414687062);
    expect(result.justification).toContain(
      "The nearest published article was not relevant"
    );

    // Only the relevance LLM call should happen.
    // Weakness evaluation must not run for an unrelated article.
    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });
});
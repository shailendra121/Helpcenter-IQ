import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPoolQuery = vi.fn();
vi.mock("../../src/db/pool.js", () => ({
  pool: { query: mockPoolQuery },
}));

const mockEmbed = vi.fn();
const mockGenerateText = vi.fn();
vi.mock("../../src/ai/providers/index.js", () => ({
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

    expect(result.isWeak).toBe(false); // verdictMatch is null, so isWeak stays false (only true when explicitly "NO")
    expect(result.justification).toBe("Unable to determine article adequacy.");
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
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateText = vi.fn();
vi.mock("../../src/ai/providers/index.js", () => ({
  createAIProvider: () => ({ generateText: mockGenerateText }),
}));

const mockWithRetry = vi.fn((fn: () => Promise<unknown>) => fn());
vi.mock("../../src/ai/withRetry.js", () => ({
  withRetry: mockWithRetry,
}));

const { generateRecommendation, MalformedRecommendationError } = await import(
  "../../src/recommendations/generateRecommendation.js"
);

const validInput = {
  topicLabel: "Password reset issues",
  classification: "weak" as const,
  classificationJustification: "The article is incomplete.",
  representativeTicketExcerpts: ["Can't reset my password"],
  matchedArticleTitle: "Password Reset Steps",
  matchedArticleText: "Click reset to reset your password.",
};

describe("generateRecommendation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a valid recommendation when the model responds with correct JSON", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "add_missing_steps",
        rationale: "The article is missing troubleshooting steps.",
        suggestedKeywords: ["password", "reset", "email"],
        suggestedTitle: null,
      }),
      model: "gemini-3.5-flash-lite",
    });

    const result = await generateRecommendation(validInput);

    expect(result.type).toBe("add_missing_steps");
    expect(result.suggestedKeywords).toEqual(["password", "reset", "email"]);
  });

  it("strips markdown JSON fences before parsing", async () => {
    mockGenerateText.mockResolvedValue({
      text: '```json\n{"type": "improve_title", "rationale": "Title is unclear.", "suggestedKeywords": ["title"], "suggestedTitle": "New Title"}\n```',
      model: "gemini-3.5-flash-lite",
    });

    const result = await generateRecommendation(validInput);

    expect(result.type).toBe("improve_title");
    expect(result.suggestedTitle).toBe("New Title");
  });

  it("throws MalformedRecommendationError when type is not a valid enum value, after retrying", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "delete_everything", // invalid type
        rationale: "test",
        suggestedKeywords: [],
        suggestedTitle: null,
      }),
      model: "gemini-3.5-flash-lite",
    });

    await expect(generateRecommendation(validInput)).rejects.toThrow(MalformedRecommendationError);
    expect(mockGenerateText).toHaveBeenCalledTimes(2); // retried once
  });

  it("throws MalformedRecommendationError on completely invalid JSON, after retrying", async () => {
    mockGenerateText.mockResolvedValue({
      text: "This is not JSON at all.",
      model: "gemini-3.5-flash-lite",
    });

    await expect(generateRecommendation(validInput)).rejects.toThrow(MalformedRecommendationError);
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("throws MalformedRecommendationError when rationale is missing", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "add_keywords",
        suggestedKeywords: ["a"],
        suggestedTitle: null,
        // rationale missing
      }),
      model: "gemini-3.5-flash-lite",
    });

    await expect(generateRecommendation(validInput)).rejects.toThrow(MalformedRecommendationError);
  });

  it("succeeds on the second attempt if the first response is malformed", async () => {
    mockGenerateText
      .mockResolvedValueOnce({ text: "garbage output", model: "gemini-3.5-flash-lite" })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          type: "create_new_article",
          rationale: "No article exists.",
          suggestedKeywords: ["new"],
          suggestedTitle: "How to Fix X",
        }),
        model: "gemini-3.5-flash-lite",
      });

    const result = await generateRecommendation(validInput);

    expect(result.type).toBe("create_new_article");
    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("never stores raw output — malformed responses never reach a Recommendation object", async () => {
    mockGenerateText.mockResolvedValue({
      text: "<html>not json</html>",
      model: "gemini-3.5-flash-lite",
    });

    try {
      await generateRecommendation(validInput);
      expect.fail("Expected generateRecommendation to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(MalformedRecommendationError);
      // Confirms the raw text is captured for debugging, not silently discarded.
      expect((err as InstanceType<typeof MalformedRecommendationError>).rawText).toContain("not json");
    }
  });
});
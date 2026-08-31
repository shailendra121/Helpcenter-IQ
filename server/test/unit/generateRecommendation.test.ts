import { describe, it, expect, vi, beforeEach } from "vitest";

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

const {
  generateRecommendation,
  MalformedRecommendationError,
} = await import("../../src/recommendations/generateRecommendation.js");

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
    expect(result.rationale).toBe(
      "The article is missing troubleshooting steps."
    );
    expect(result.suggestedKeywords).toEqual([
      "password",
      "reset",
      "email",
    ]);
    expect(result.suggestedTitle).toBeNull();
  });

  it("strips markdown JSON fences before parsing", async () => {
    mockGenerateText.mockResolvedValue({
      text: '```json\n{"type": "add_missing_steps", "rationale": "Article is missing important steps.", "suggestedKeywords": ["steps"], "suggestedTitle": null}\n```',
      model: "gemini-3.5-flash-lite",
    });

    const result = await generateRecommendation(validInput);

    expect(result.type).toBe("add_missing_steps");
    expect(result.suggestedTitle).toBeNull();
  });

  it("throws MalformedRecommendationError when type is not a valid enum value, after retrying", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "delete_everything",
        rationale: "test",
        suggestedKeywords: ["password"],
        suggestedTitle: null,
      }),
      model: "gemini-3.5-flash-lite",
    });

    await expect(
      generateRecommendation(validInput)
    ).rejects.toThrow(MalformedRecommendationError);

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("throws MalformedRecommendationError when type does not match the classification", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "create_new_article",
        rationale: "Create a new article.",
        suggestedKeywords: ["password"],
        suggestedTitle: "Password Reset Guide",
      }),
      model: "gemini-3.5-flash-lite",
    });

    await expect(
      generateRecommendation(validInput)
    ).rejects.toThrow(MalformedRecommendationError);

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("throws MalformedRecommendationError on completely invalid JSON, after retrying", async () => {
    mockGenerateText.mockResolvedValue({
      text: "This is not JSON at all.",
      model: "gemini-3.5-flash-lite",
    });

    await expect(
      generateRecommendation(validInput)
    ).rejects.toThrow(MalformedRecommendationError);

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("throws MalformedRecommendationError when rationale is missing", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "add_missing_steps",
        suggestedKeywords: ["a"],
        suggestedTitle: null,
        // rationale intentionally missing
      }),
      model: "gemini-3.5-flash-lite",
    });

    await expect(
      generateRecommendation(validInput)
    ).rejects.toThrow(MalformedRecommendationError);

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("throws MalformedRecommendationError when suggestedKeywords is empty", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "add_missing_steps",
        rationale: "The article is missing important steps.",
        suggestedKeywords: [],
        suggestedTitle: null,
      }),
      model: "gemini-3.5-flash-lite",
    });

    await expect(
      generateRecommendation(validInput)
    ).rejects.toThrow(MalformedRecommendationError);

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("throws MalformedRecommendationError when suggestedKeywords is not a string array", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "add_missing_steps",
        rationale: "The article is missing important steps.",
        suggestedKeywords: ["password", 123],
        suggestedTitle: null,
      }),
      model: "gemini-3.5-flash-lite",
    });

    await expect(
      generateRecommendation(validInput)
    ).rejects.toThrow(MalformedRecommendationError);

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("succeeds on the second attempt if the first response is malformed", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: "garbage output",
        model: "gemini-3.5-flash-lite",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          type: "add_missing_steps",
          rationale: "The article is missing important steps.",
          suggestedKeywords: ["steps", "password"],
          suggestedTitle: null,
        }),
        model: "gemini-3.5-flash-lite",
      });

    const result = await generateRecommendation(validInput);

    expect(result.type).toBe("add_missing_steps");
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

      expect(
        (err as InstanceType<typeof MalformedRecommendationError>).rawText
      ).toContain("not json");
    }
  });

  it("masks PII in ticket excerpts and article text before calling generateText()", async () => {
    mockGenerateText.mockResolvedValue({
      text: JSON.stringify({
        type: "add_missing_steps",
        rationale: "The article needs more steps.",
        suggestedKeywords: ["password"],
        suggestedTitle: null,
      }),
      model: "gemini-3.5-flash-lite",
    });

    await generateRecommendation({
      ...validInput,
      representativeTicketExcerpts: [
        "Please email me at jane.doe@example.com about my password.",
        "Call 555-123-4567 for help.",
      ],
      matchedArticleText:
        "Contact jane.doe@example.com or call 555-123-4567.",
    });

    const generateCallArg = mockGenerateText.mock.calls[0][0];

    expect(generateCallArg.prompt).not.toContain(
      "jane.doe@example.com"
    );
    expect(generateCallArg.prompt).not.toContain("555-123-4567");

    expect(generateCallArg.prompt).toContain("[REDACTED]");
  });

  describe("recommendation type matches classification", () => {
    it("allows create_new_article for missing classification", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          type: "create_new_article",
          rationale: "No article exists for this topic.",
          suggestedKeywords: ["password", "reset"],
          suggestedTitle: "How to Reset Your Password",
        }),
        model: "gemini-3.5-flash-lite",
      });

      const result = await generateRecommendation({
        ...validInput,
        classification: "missing",
      });

      expect(result.type).toBe("create_new_article");
    });

    it("allows add_missing_steps for weak classification", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          type: "add_missing_steps",
          rationale: "The article is missing troubleshooting steps.",
          suggestedKeywords: ["password", "reset"],
          suggestedTitle: null,
        }),
        model: "gemini-3.5-flash-lite",
      });

      const result = await generateRecommendation({
        ...validInput,
        classification: "weak",
      });

      expect(result.type).toBe("add_missing_steps");
    });

    it("allows update_existing_article for weak classification", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          type: "update_existing_article",
          rationale: "The existing article needs additional guidance.",
          suggestedKeywords: ["password", "reset"],
          suggestedTitle: null,
        }),
        model: "gemini-3.5-flash-lite",
      });

      const result = await generateRecommendation({
        ...validInput,
        classification: "weak",
      });

      expect(result.type).toBe("update_existing_article");
    });

    it("allows update_existing_article for outdated classification", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          type: "update_existing_article",
          rationale: "The article contains outdated instructions.",
          suggestedKeywords: ["password", "reset"],
          suggestedTitle: null,
        }),
        model: "gemini-3.5-flash-lite",
      });

      const result = await generateRecommendation({
        ...validInput,
        classification: "outdated",
      });

      expect(result.type).toBe("update_existing_article");
    });

    it("rejects create_new_article for weak classification", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          type: "create_new_article",
          rationale: "Create a new article.",
          suggestedKeywords: ["password"],
          suggestedTitle: "Password Reset Guide",
        }),
        model: "gemini-3.5-flash-lite",
      });

      await expect(
        generateRecommendation({
          ...validInput,
          classification: "weak",
        })
      ).rejects.toThrow(MalformedRecommendationError);

      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });

    it("rejects create_new_article for outdated classification", async () => {
      mockGenerateText.mockResolvedValue({
        text: JSON.stringify({
          type: "create_new_article",
          rationale: "Create a new article.",
          suggestedKeywords: ["password"],
          suggestedTitle: "Password Reset Guide",
        }),
        model: "gemini-3.5-flash-lite",
      });

      await expect(
        generateRecommendation({
          ...validInput,
          classification: "outdated",
        })
      ).rejects.toThrow(MalformedRecommendationError);

      expect(mockGenerateText).toHaveBeenCalledTimes(2);
    });
  });
});
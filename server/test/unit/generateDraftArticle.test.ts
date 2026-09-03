import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGenerateText = vi.fn();

vi.mock("../../src/ai/providers/index.js", () => ({
  createAIProvider: () => ({
    name: "mock-provider",
    generateText: mockGenerateText,
  }),
}));

const mockWithRetry = vi.fn((fn: () => Promise<unknown>) => fn());

vi.mock("../../src/ai/withRetry.js", () => ({
  withRetry: mockWithRetry,
}));

const {
  generateDraftArticle,
  MalformedDraftArticleError,
} = await import("../../src/drafts/generateDraftArticle.js");

const baseInput = {
  topicLabel: "Password reset",
  gapType: "missing" as const,
  representativeTicketExcerpts: [
    "Customer cannot reset their password.",
  ],
  hasExistingArticle: false,
  recommendationRationale: "No existing article covers this issue.",
};

const validDraft = {
  suggestedTitle: "How to Reset Your Password",
  problemSummary:
    "Customers may have trouble resetting their password.",
  stepByStepResolution:
    "1. Open the login page.\n2. Select Forgot Password.\n3. Follow the reset instructions.",
  faq: [
    {
      question: "What if I do not receive the reset email?",
      answer: "Check your spam folder and try again.",
    },
    {
      question: "Can I reset my password from the app?",
      answer:
        "Follow the password reset option available in the app.",
    },
  ],
  relatedKeywords: [
    "password reset",
    "forgot password",
    "login",
  ],
  internalReviewerNotes:
    "Confirm the final reset flow before approval.",
};

describe("generateDraftArticle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a valid JSON response into a DraftArticle", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: JSON.stringify(validDraft),
      model: "test-model",
    });

    const result = await generateDraftArticle(baseInput);

    expect(result).toEqual({
      ...validDraft,
      model: "test-model",
    });

    expect(mockGenerateText).toHaveBeenCalledTimes(1);
  });

  it("accepts JSON wrapped in markdown fences", async () => {
    mockGenerateText.mockResolvedValueOnce({
      text: `\`\`\`json
${JSON.stringify(validDraft)}
\`\`\``,
      model: "test-model",
    });

    const result = await generateDraftArticle(baseInput);

    expect(result.suggestedTitle).toBe(
      "How to Reset Your Password"
    );
    expect(result.faq).toHaveLength(2);
  });

  it("retries once when the first response contains malformed JSON", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: "{invalid json",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(validDraft),
        model: "test-model",
      });

    const result = await generateDraftArticle(baseInput);

    expect(result.suggestedTitle).toBe(
      "How to Reset Your Password"
    );

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("throws MalformedDraftArticleError after both attempts fail", async () => {
    mockGenerateText
      .mockResolvedValueOnce({
        text: "{invalid json",
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: "still not json",
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);

    expect(mockGenerateText).toHaveBeenCalledTimes(2);
  });

  it("preserves the raw AI response when both attempts fail", async () => {
  const firstResponse = "{invalid json";
  const secondResponse = "still not json";

  mockGenerateText
    .mockResolvedValueOnce({
      text: firstResponse,
      model: "test-model",
    })
    .mockResolvedValueOnce({
      text: secondResponse,
      model: "test-model",
    });

  try {
    await generateDraftArticle(baseInput);
    throw new Error(
      "Expected generateDraftArticle to throw"
    );
  } catch (error) {
    expect(error).toBeInstanceOf(
      MalformedDraftArticleError
    );

    expect(
      (error as InstanceType<typeof MalformedDraftArticleError>)
        .rawText
    ).toBe(secondResponse);
  }
});
  it("rejects a response missing suggestedTitle", async () => {
    const invalidDraft = {
      ...validDraft,
      suggestedTitle: "",
    };

    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);
  });

  it("rejects a non-string problemSummary", async () => {
    const invalidDraft = {
      ...validDraft,
      problemSummary: 123,
    };

    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);
  });

  it("rejects a non-string stepByStepResolution", async () => {
    const invalidDraft = {
      ...validDraft,
      stepByStepResolution: 123,
    };

    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);
  });

  it("rejects an invalid FAQ entry", async () => {
    const invalidDraft = {
      ...validDraft,
      faq: [{ question: "Missing answer" }],
    };

    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);
  });

  it("rejects a non-array FAQ value", async () => {
    const invalidDraft = {
      ...validDraft,
      faq: "not-an-array",
    };

    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);
  });

  it("rejects a relatedKeywords array containing a non-string", async () => {
    const invalidDraft = {
      ...validDraft,
      relatedKeywords: ["password reset", 123],
    };

    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);
  });

  it("rejects a missing relatedKeywords array", async () => {
    const invalidDraft = {
      ...validDraft,
      relatedKeywords: undefined,
    };

    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);
  });

  it("rejects missing internalReviewerNotes", async () => {
    const invalidDraft = {
      ...validDraft,
      internalReviewerNotes: undefined,
    };

    mockGenerateText
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      })
      .mockResolvedValueOnce({
        text: JSON.stringify(invalidDraft),
        model: "test-model",
      });

    await expect(
      generateDraftArticle(baseInput)
    ).rejects.toBeInstanceOf(MalformedDraftArticleError);
  });
});
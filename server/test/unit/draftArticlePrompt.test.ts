import { describe, expect, it } from "vitest";
import { buildDraftArticlePrompt } from "../../src/ai/prompts/draftArticlePrompt.js";

const baseInput = {
  topicLabel: "Password reset",
  representativeTicketExcerpts: [
    "Customer cannot reset their password.",
  ],
  recommendationRationale:
    "Customers need clearer guidance for resetting their password.",
};

describe("buildDraftArticlePrompt", () => {
  it("creates a brand-new article prompt for a missing gap", () => {
    const prompt = buildDraftArticlePrompt({
      ...baseInput,
      gapType: "missing",
      existingArticleText: undefined,
      hasExistingArticle: false,
    });

    expect(prompt).toContain(
      "This topic currently has no knowledge base article"
    );
    expect(prompt).toContain(
      "write a brand-new draft from scratch"
    );
  });

  it("creates a revision prompt when an existing article has content", () => {
    const prompt = buildDraftArticlePrompt({
      ...baseInput,
      gapType: "weak",
      existingArticleText:
        "Existing password reset instructions.",
      hasExistingArticle: true,
    });

    expect(prompt).toContain(
      "This is a REVISION of an existing article, not a new one."
    );
    expect(prompt).toContain(
      "Existing password reset instructions."
    );
    expect(prompt).toContain(
      "build on and improve this existing article"
    );
  });

  it("preserves existing-article context when the article body is empty", () => {
    const prompt = buildDraftArticlePrompt({
      ...baseInput,
      gapType: "weak",
      existingArticleText: "",
      hasExistingArticle: true,
    });

    expect(prompt).toContain(
      "A matching knowledge base article EXISTS for this topic"
    );
    expect(prompt).toContain(
      "article body is empty or unavailable"
    );
    expect(prompt).toContain(
      "Do NOT describe this as a topic with no existing article"
    );
    expect(prompt).toContain(
      "flag the missing article content in internalReviewerNotes"
    );

    expect(prompt).not.toContain(
      "This topic currently has no knowledge base article"
    );
  });
});
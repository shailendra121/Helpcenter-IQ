import { createAIProvider } from "../ai/providers/index.js";
import { withRetry } from "../ai/withRetry.js";
import { maskPII } from "../pii/maskPII.js";
import { buildDraftArticlePrompt } from "../ai/prompts/draftArticlePrompt.js";
import type { DraftArticlePromptInput } from "../ai/prompts/draftArticlePrompt.js";

export interface DraftArticle {
  suggestedTitle: string;
  problemSummary: string;
  stepByStepResolution: string;
  faq: { question: string; answer: string }[];
  relatedKeywords: string[];
  internalReviewerNotes: string;
  model: string;
}

export class MalformedDraftArticleError extends Error {
  constructor(
    public readonly rawText: string,
    reason: string
  ) {
    super(`Malformed draft article output: ${reason}`);
    this.name = "MalformedDraftArticleError";
  }
}

const MAX_GENERATION_ATTEMPTS = 2;

/**
 * Validates the structured draft article returned by the AI provider.
 *
 * This logic is intentionally provider-agnostic. The provider only
 * generates text; this module owns draft-specific parsing and validation.
 */
function validateDraftArticle(
  parsed: unknown,
  rawText: string,
  model: string
): DraftArticle {
  if (typeof parsed !== "object" || parsed === null) {
    throw new MalformedDraftArticleError(
      rawText,
      "response is not a JSON object"
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (
    typeof obj.suggestedTitle !== "string" ||
    obj.suggestedTitle.trim().length === 0
  ) {
    throw new MalformedDraftArticleError(
      rawText,
      '"suggestedTitle" is missing or empty'
    );
  }

  if (typeof obj.problemSummary !== "string") {
    throw new MalformedDraftArticleError(
      rawText,
      '"problemSummary" is missing or not a string'
    );
  }

  if (typeof obj.stepByStepResolution !== "string") {
    throw new MalformedDraftArticleError(
      rawText,
      '"stepByStepResolution" is missing or not a string'
    );
  }

  if (!Array.isArray(obj.faq)) {
    throw new MalformedDraftArticleError(
      rawText,
      '"faq" is missing or not an array'
    );
  }

  for (const item of obj.faq) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).question !== "string" ||
      typeof (item as Record<string, unknown>).answer !== "string"
    ) {
      throw new MalformedDraftArticleError(
        rawText,
        '"faq" contains an invalid entry (missing question/answer)'
      );
    }
  }

  if (
    !Array.isArray(obj.relatedKeywords) ||
    !obj.relatedKeywords.every(
      (keyword) => typeof keyword === "string"
    )
  ) {
    throw new MalformedDraftArticleError(
      rawText,
      '"relatedKeywords" is missing or not a string array'
    );
  }

  if (typeof obj.internalReviewerNotes !== "string") {
    throw new MalformedDraftArticleError(
      rawText,
      '"internalReviewerNotes" is missing or not a string'
    );
  }

  return {
    suggestedTitle: obj.suggestedTitle,
    problemSummary: obj.problemSummary,
    stepByStepResolution: obj.stepByStepResolution,
    faq: obj.faq as { question: string; answer: string }[],
    relatedKeywords: obj.relatedKeywords as string[],
    internalReviewerNotes: obj.internalReviewerNotes,
    model,
  };
}

/**
 * Generates one structured draft article for a knowledge gap.
 *
 * PII masking, prompt construction, JSON parsing, validation, and retry
 * are deliberately kept outside the concrete AI provider implementation.
 * This follows the same architecture used by HCIQ-12 recommendations.
 */
export async function generateDraftArticle(
  input: DraftArticlePromptInput
): Promise<DraftArticle> {
  const provider = createAIProvider();

  const maskedInput: DraftArticlePromptInput = {
    ...input,
    representativeTicketExcerpts:
      input.representativeTicketExcerpts.map(
        (ticket) => maskPII(ticket).maskedText
      ),
    existingArticleText: input.existingArticleText
      ? maskPII(input.existingArticleText).maskedText
      : undefined,
  };

  const prompt = buildDraftArticlePrompt(maskedInput);

  let lastError: Error | null = null;

  for (
    let attempt = 1;
    attempt <= MAX_GENERATION_ATTEMPTS;
    attempt++
  ) {
    const { text, model } = await withRetry(() =>
      provider.generateText({ prompt })
    );

    const cleaned = text
      .replace(/```json\s*|```\s*/g, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);

      return validateDraftArticle(parsed, text, model);
    } catch (err) {
      lastError =
        err instanceof MalformedDraftArticleError
          ? err
          : new MalformedDraftArticleError(
              text,
              err instanceof Error
                ? err.message
                : String(err)
            );
    }
  }

  throw (
    lastError ??
    new MalformedDraftArticleError(
      "",
      "unknown parsing failure"
    )
  );
}
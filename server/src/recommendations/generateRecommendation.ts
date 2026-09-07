import { createAIProvider } from "../ai/providers/index.js";
import { withRetry } from "../ai/withRetry.js";
import { maskPII } from "../pii/maskPII.js";
import {
  buildRecommendationPrompt,
  RECOMMENDATION_TYPES,
} from "../ai/prompts/recommendationPrompt.js";
import type { RecommendationPromptInput } from "../ai/prompts/recommendationPrompt.js";

export interface Recommendation {
  type: (typeof RECOMMENDATION_TYPES)[number];
  rationale: string;
  suggestedKeywords: string[];
  suggestedTitle: string | null;
}

export class MalformedRecommendationError extends Error {
  constructor(public readonly rawText: string, reason: string) {
    super(`Malformed recommendation output: ${reason}`);
    this.name = "MalformedRecommendationError";
  }
}

/**
 * Recommendation types allowed for each knowledge-gap classification.
 *
 * Missing gaps need a new article because there is no existing article
 * covering the topic.
 *
 * Weak gaps can be addressed by adding missing steps or updating the
 * existing article.
 *
 * Outdated gaps should update the existing article rather than create
 * a completely new one.
 */
const RECOMMENDATION_TYPES_BY_CLASSIFICATION = {
  missing: ["create_new_article"],
  weak: ["add_missing_steps", "update_existing_article"],
  outdated: ["update_existing_article"],
} as const;

/**
 * Validates a parsed JSON object against the expected Recommendation
 * shape and verifies that the recommendation type is appropriate for
 * the gap classification.
 *
 * Strict on purpose — per HCIQ-12's acceptance criteria, malformed or
 * classification-incompatible output must never be stored.
 */
function validateRecommendation(
  parsed: unknown,
  rawText: string,
  classification: RecommendationPromptInput["classification"],
): Recommendation {
  if (typeof parsed !== "object" || parsed === null) {
    throw new MalformedRecommendationError(
      rawText,
      "response is not a JSON object",
    );
  }

  const obj = parsed as Record<string, unknown>;

  if (
    typeof obj.type !== "string" ||
    !RECOMMENDATION_TYPES.includes(obj.type as never)
  ) {
    throw new MalformedRecommendationError(
      rawText,
      `"type" is missing or not one of the allowed values: ${obj.type}`,
    );
  }

  const allowedTypes =
    RECOMMENDATION_TYPES_BY_CLASSIFICATION[classification];

  if (!(allowedTypes as readonly string[]).includes(obj.type)) {
    throw new MalformedRecommendationError(
      rawText,
      `"type" "${obj.type}" is not appropriate for "${classification}" classification`,
    );
  }

  if (
    typeof obj.rationale !== "string" ||
    obj.rationale.trim().length === 0
  ) {
    throw new MalformedRecommendationError(
      rawText,
      `"rationale" is missing or empty`,
    );
  }

  if (
    !Array.isArray(obj.suggestedKeywords) ||
    obj.suggestedKeywords.length === 0 ||
    !obj.suggestedKeywords.every(
      (keyword) =>
        typeof keyword === "string" && keyword.trim().length > 0,
    )
  ) {
    throw new MalformedRecommendationError(
      rawText,
      `"suggestedKeywords" must contain at least one non-empty string`,
    );
  }

  if (
    obj.suggestedTitle !== null &&
    typeof obj.suggestedTitle !== "string"
  ) {
    throw new MalformedRecommendationError(
      rawText,
      `"suggestedTitle" must be a string or null`,
    );
  }

  return {
    type: obj.type as Recommendation["type"],
    rationale: obj.rationale,
    suggestedKeywords: obj.suggestedKeywords as string[],
    suggestedTitle: (obj.suggestedTitle as string | null) ?? null,
  };
}

const MAX_GENERATION_ATTEMPTS = 2;

/**
 * Generates one recommendation for a non-Good gap.
 *
 * On malformed or classification-incompatible model output, retries once
 * before throwing. Raw/invalid output is never returned as a Recommendation.
 *
 * Ticket excerpts and matched article text are PII-masked before they
 * are included in the AI prompt.
 */
export async function generateRecommendation(
  input: RecommendationPromptInput,
): Promise<Recommendation> {
  const provider = createAIProvider();

  // Mask ticket excerpts and article text before they ever reach the
  // prompt, per ADR-0003 — same rule as every other AI call site.
  const maskedInput: RecommendationPromptInput = {
    ...input,
    representativeTicketExcerpts:
      input.representativeTicketExcerpts.map(
        (t) => maskPII(t).maskedText,
      ),
    matchedArticleText: input.matchedArticleText
      ? maskPII(input.matchedArticleText).maskedText
      : null,
  };

  const prompt = buildRecommendationPrompt(maskedInput);

  let lastError: Error | null = null;

  for (
    let attempt = 1;
    attempt <= MAX_GENERATION_ATTEMPTS;
    attempt++
  ) {
    const { text } = await withRetry(() =>
      provider.generateText({ prompt }),
    );

    // Models sometimes wrap JSON in ```json fences despite instructions —
    // strip them before parsing rather than failing on a technicality.
    const cleaned = text
      .replace(/```json\s*|```\s*/g, "")
      .trim();

    try {
      const parsed = JSON.parse(cleaned);

      return validateRecommendation(
        parsed,
        text,
        input.classification,
      );
    } catch (err) {
      // JSON.parse throws a plain SyntaxError, not our custom type —
      // normalize both parse failures and validation failures to
      // MalformedRecommendationError so callers always get one error type.
      lastError =
        err instanceof MalformedRecommendationError
          ? err
          : new MalformedRecommendationError(
              text,
              err instanceof Error ? err.message : String(err),
            );
    }
  }

  throw (
    lastError ??
    new MalformedRecommendationError(
      "",
      "unknown parsing failure",
    )
  );
}
import { createAIProvider } from "../ai/providers/index.js";
import { withRetry } from "../ai/withRetry.js";
import { maskPII } from "../pii/maskPII.js";
import { buildRecommendationPrompt, RECOMMENDATION_TYPES } from "../ai/prompts/recommendationPrompt.js";
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
 * Validates a parsed JSON object against the expected Recommendation
 * shape. Strict on purpose — per HCIQ-12's acceptance criteria,
 * malformed output must never be stored raw.
 */
function validateRecommendation(parsed: unknown, rawText: string): Recommendation {
  if (typeof parsed !== "object" || parsed === null) {
    throw new MalformedRecommendationError(rawText, "response is not a JSON object");
  }

  const obj = parsed as Record<string, unknown>;

  if (typeof obj.type !== "string" || !RECOMMENDATION_TYPES.includes(obj.type as never)) {
    throw new MalformedRecommendationError(
      rawText,
      `"type" is missing or not one of the allowed values: ${obj.type}`
    );
  }

  if (typeof obj.rationale !== "string" || obj.rationale.trim().length === 0) {
    throw new MalformedRecommendationError(rawText, `"rationale" is missing or empty`);
  }

  if (!Array.isArray(obj.suggestedKeywords) || !obj.suggestedKeywords.every((k) => typeof k === "string")) {
    throw new MalformedRecommendationError(rawText, `"suggestedKeywords" is missing or not a string array`);
  }

  if (obj.suggestedTitle !== null && typeof obj.suggestedTitle !== "string") {
    throw new MalformedRecommendationError(rawText, `"suggestedTitle" must be a string or null`);
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
 * Generates one recommendation for a non-Good gap. On malformed model
 * output, retries once (models occasionally wrap JSON in markdown
 * fences or add stray text) before throwing — never stores raw/invalid
 * output.
 */
export async function generateRecommendation(
  input: RecommendationPromptInput
): Promise<Recommendation> {
  const provider = createAIProvider();

  // Mask ticket excerpts and article text before they ever reach the
  // prompt, per ADR-0003 — same rule as every other AI call site.
  const maskedInput: RecommendationPromptInput = {
    ...input,
    representativeTicketExcerpts: input.representativeTicketExcerpts.map(
      (t) => maskPII(t).maskedText
    ),
    matchedArticleText: input.matchedArticleText ? maskPII(input.matchedArticleText).maskedText : null,
  };

  const prompt = buildRecommendationPrompt(maskedInput);

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    const { text } = await withRetry(() => provider.generateText({ prompt }));

    // Models sometimes wrap JSON in ```json fences despite instructions —
    // strip them before parsing rather than failing on a technicality.
    const cleaned = text.replace(/```json\s*|```\s*/g, "").trim();

    try {
      const parsed = JSON.parse(cleaned);
      return validateRecommendation(parsed, text);
    } catch (err) {
      // JSON.parse throws a plain SyntaxError, not our custom type —
      // normalize both parse failures and validation failures to
      // MalformedRecommendationError so callers always get one error type.
      lastError =
        err instanceof MalformedRecommendationError
          ? err
          : new MalformedRecommendationError(text, err instanceof Error ? err.message : String(err));
      // Retry once on malformed output before giving up.
    }
  }

  throw lastError ?? new MalformedRecommendationError("", "unknown parsing failure");
}
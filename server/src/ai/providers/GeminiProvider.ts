import { GoogleGenAI } from "@google/genai";
import type {
  AIProvider,
  EmbeddingRequest,
  EmbeddingResult,
  DraftArticleRequest,
  DraftArticleResult,
  GenerateTextRequest,
  GenerateTextResult,
} from "./AIProvider.js";
import { buildDraftArticlePrompt } from "../prompts/draftArticlePrompt.js";
const GENERATION_MODEL = process.env.GEMINI_GENERATION_MODEL ?? "gemini-3.5-flash-lite";
const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
const EMBEDDING_DIMENSION = 1536; // must match pgvector column dimension in init-schema migration

/**
 * gemini-embedding-001 only auto-normalizes output at the default 3072
 * dimensions. Since we request a truncated 1536-dim vector (Matryoshka
 * Representation Learning), Google's docs require manual unit-normalization
 * here, or cosine/dot-product similarity in pgvector will be subtly wrong.
 * See: https://ai.google.dev/gemini-api/docs/embeddings
 */
export function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude === 0) return vector;
  return vector.map((val) => val / magnitude);
}

/**
 * Google Gemini implementation of AIProvider.
 *
 * Per ADR-0003 (amended by ADR-0006): free tier is dev/test only, with
 * synthetic or masked data. Callers are responsible for PII masking
 * before calling this — this class trusts its inputs are already clean
 * and does not re-check.
 */
export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  private readonly client: GoogleGenAI;

  constructor(apiKey: string) {
    this.client = new GoogleGenAI({ apiKey });
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const response = await this.client.models.embedContent({
      model: EMBEDDING_MODEL,
      contents: request.text,
      config: { outputDimensionality: EMBEDDING_DIMENSION },
    });

    const values = response.embeddings?.[0]?.values;
    if (!values) {
      throw new Error("Gemini embedContent returned no embedding values");
    }

    return { vector: normalize(values), model: EMBEDDING_MODEL };
  }
  async generateText(request: GenerateTextRequest): Promise<GenerateTextResult> {
    const response = await this.client.models.generateContent({
      model: GENERATION_MODEL,
      contents: request.prompt,
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini generateContent returned no text");
    }

    return { text, model: GENERATION_MODEL };
  }
async draftArticle(request: DraftArticleRequest): Promise<DraftArticleResult> {
    const prompt = buildDraftArticlePrompt({
      topicLabel: request.topicLabel,
      gapType: request.gapType,
      representativeTicketExcerpts: request.ticketExcerpts,
      existingArticleText: request.existingArticleText,
      recommendationRationale: request.recommendationRationale,
    });

    const MAX_ATTEMPTS = 2;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const response = await this.client.models.generateContent({
        model: GENERATION_MODEL,
        contents: prompt,
      });

      const text = response.text;
      if (!text) {
        lastError = new Error("Gemini generateContent returned no text");
        continue;
      }

      const cleaned = text.replace(/```json\s*|```\s*/g, "").trim();

      try {
        const parsed = JSON.parse(cleaned);
        return validateDraftArticle(parsed, GENERATION_MODEL);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError ?? new Error("Unknown draft article generation failure");
  }
}
  function validateDraftArticle(parsed: unknown, model: string): DraftArticleResult {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Draft article response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.suggestedTitle !== "string" || obj.suggestedTitle.trim().length === 0) {
    throw new Error('"suggestedTitle" is missing or empty');
  }
  if (typeof obj.problemSummary !== "string") {
    throw new Error('"problemSummary" is missing or not a string');
  }
  if (typeof obj.stepByStepResolution !== "string") {
    throw new Error('"stepByStepResolution" is missing or not a string');
  }
  if (!Array.isArray(obj.faq)) {
    throw new Error('"faq" is missing or not an array');
  }
  for (const item of obj.faq) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).question !== "string" ||
      typeof (item as Record<string, unknown>).answer !== "string"
    ) {
      throw new Error('"faq" contains an invalid entry (missing question/answer)');
    }
  }
  if (!Array.isArray(obj.relatedKeywords) || !obj.relatedKeywords.every((k) => typeof k === "string")) {
    throw new Error('"relatedKeywords" is missing or not a string array');
  }
  if (typeof obj.internalReviewerNotes !== "string") {
    throw new Error('"internalReviewerNotes" is missing or not a string');
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

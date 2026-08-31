import { GoogleGenAI } from "@google/genai";
import type {
  AIProvider,
  EmbeddingRequest,
  EmbeddingResult,
  GenerateTextRequest,
  GenerateTextResult,
} from "./AIProvider.js";

const GENERATION_MODEL =
  process.env.GEMINI_GENERATION_MODEL ?? "gemini-3.5-flash-lite";

const EMBEDDING_MODEL =
  process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";

const EMBEDDING_DIMENSION = 1536; // must match pgvector column dimension in init-schema migration

/**
 * gemini-embedding-001 only auto-normalizes output at the default 3072
 * dimensions. Since we request a truncated 1536-dim vector (Matryoshka
 * Representation Learning), Google's docs require manual unit-normalization
 * here, or cosine/dot-product similarity in pgvector will be subtly wrong.
 */
export function normalize(vector: number[]): number[] {
  const magnitude = Math.sqrt(
    vector.reduce((sum, val) => sum + val * val, 0)
  );

  if (magnitude === 0) return vector;

  return vector.map((val) => val / magnitude);
}

/**
 * Google Gemini implementation of AIProvider.
 *
 * Per ADR-0003 (amended by ADR-0006): free tier is dev/test only, with
 * synthetic or masked data. Callers are responsible for PII masking
 * before calling this provider.
 *
 * Feature-specific parsing and validation stay outside this class.
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
      config: {
        outputDimensionality: EMBEDDING_DIMENSION,
      },
    });

    const values = response.embeddings?.[0]?.values;

    if (!values) {
      throw new Error("Gemini embedContent returned no embedding values");
    }

    return {
      vector: normalize(values),
      model: EMBEDDING_MODEL,
    };
  }

  async generateText(
    request: GenerateTextRequest
  ): Promise<GenerateTextResult> {
    const response = await this.client.models.generateContent({
      model: GENERATION_MODEL,
      contents: request.prompt,
    });

    const text = response.text;

    if (!text) {
      throw new Error("Gemini generateContent returned no text");
    }

    return {
      text,
      model: GENERATION_MODEL,
    };
  }
}
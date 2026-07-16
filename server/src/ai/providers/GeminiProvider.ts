import { GoogleGenAI } from "@google/genai";
import type {
  AIProvider,
  EmbeddingRequest,
  EmbeddingResult,
  DraftArticleRequest,
  DraftArticleResult,
} from "./AIProvider.js";

const EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL ?? "gemini-embedding-001";
const EMBEDDING_DIMENSION = 1536; // must match pgvector column dimension in init-schema migration

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

    return { vector: values, model: EMBEDDING_MODEL };
  }

  async draftArticle(_request: DraftArticleRequest): Promise<DraftArticleResult> {
    // TODO(HCIQ-13): wire up Gemini generation call using prompts in
    // server/src/ai/prompts/.
    throw new Error("Not implemented");
  }
}
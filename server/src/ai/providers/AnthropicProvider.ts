import type {
  AIProvider,
  EmbeddingRequest,
  EmbeddingResult,
  DraftArticleRequest,
  DraftArticleResult,
} from "./AIProvider.js";

/**
 * Anthropic implementation of AIProvider.
 *
 * Per ADR-0003: only used with a zero-data-retention API agreement in
 * place. Callers are responsible for PII masking before calling this —
 * this class trusts its inputs are already clean and does not re-check.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = "anthropic";

  constructor(private readonly apiKey: string) {}

  async embed(_request: EmbeddingRequest): Promise<EmbeddingResult> {
    // TODO(HCIQ-XX): wire up embeddings call.
    throw new Error("Not implemented");
  }

  async draftArticle(_request: DraftArticleRequest): Promise<DraftArticleResult> {
    // TODO(HCIQ-XX): wire up Claude messages call using prompts in
    // server/src/ai/prompts/.
    throw new Error("Not implemented");
  }
}

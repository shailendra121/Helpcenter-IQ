/**
 * Provider-agnostic AI interface. See docs/adr/0003 for why this exists:
 * the underlying vendor must be swappable, and PII masking must happen
 * upstream of every call made through this interface — never call a
 * vendor SDK directly anywhere else in the codebase.
 */

export interface EmbeddingRequest {
  /** Already PII-masked text. Callers must run input through
   * server/src/pii/ before constructing this request. */
  text: string;
}

export interface EmbeddingResult {
  vector: number[];
  model: string;
}

export interface GenerateTextRequest {
  /** Already PII-masked prompt text. */
  prompt: string;
}

export interface GenerateTextResult {
  text: string;
  model: string;
}

export interface AIProvider {
  readonly name: string;

  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;

  /**
   * Generic text generation used by AI features that need
   * provider-agnostic model output.
   *
   * Callers are responsible for PII masking before calling the provider.
   * Feature-specific parsing and validation must remain outside the
   * concrete provider implementation.
   */
  generateText(request: GenerateTextRequest): Promise<GenerateTextResult>;
}
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

export interface DraftArticleRequest {
  /** PII-masked cluster of ticket excerpts representing one knowledge gap. */
  ticketExcerpts: string[];
  existingArticleText?: string;
  gapType: "missing" | "weak" | "outdated";
}

export interface DraftArticleResult {
  suggestedTitle: string;
  problemSummary: string;
  stepByStepResolution: string;
  faq: { question: string; answer: string }[];
  relatedKeywords: string[];
  internalReviewerNotes: string;
  model: string;
}

export interface AIProvider {
  readonly name: string;

  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;

  draftArticle(request: DraftArticleRequest): Promise<DraftArticleResult>;
}

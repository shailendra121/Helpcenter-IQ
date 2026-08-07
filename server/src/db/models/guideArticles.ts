import { pool } from "../pool.js";

export interface GuideArticleRow {
  id: number;
  zendesk_account_id: number;
  zendesk_article_id: string; // bigint comes back as string from pg
  title: string | null;
  clean_text: string | null;
  section_id: string | null;
  locale: string | null;
  draft: boolean;
  zendesk_created_at: Date | null;
  zendesk_updated_at: Date | null;
  embedding: string | null; // pgvector returns as string
  embedded_at: Date | null;
  ingested_at: Date;
}

export interface UpsertGuideArticleMetaInput {
  zendeskAccountId: number;
  zendeskArticleId: number;
  title: string | null;
  cleanText: string;
  sectionId: number | null;
  locale: string;
  draft: boolean;
  zendeskCreatedAt: Date | null;
  zendeskUpdatedAt: Date | null;
}

/**
 * Upserts article metadata WITHOUT touching the embedding column —
 * used when we're skipping re-embedding (article unchanged) but still
 * want metadata (title, draft status) current. Idempotent per
 * (zendesk_account_id, zendesk_article_id).
 */
export async function upsertArticleMetadata(input: UpsertGuideArticleMetaInput): Promise<void> {
  await pool.query(
    `INSERT INTO guide_articles
       (zendesk_account_id, zendesk_article_id, title, clean_text, section_id,
        locale, draft, zendesk_created_at, zendesk_updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (zendesk_account_id, zendesk_article_id) DO UPDATE SET
       title = EXCLUDED.title,
       clean_text = EXCLUDED.clean_text,
       section_id = EXCLUDED.section_id,
       locale = EXCLUDED.locale,
       draft = EXCLUDED.draft,
       zendesk_created_at = EXCLUDED.zendesk_created_at,
       zendesk_updated_at = EXCLUDED.zendesk_updated_at`,
    [
      input.zendeskAccountId,
      input.zendeskArticleId,
      input.title,
      input.cleanText,
      input.sectionId,
      input.locale,
      input.draft,
      input.zendeskCreatedAt,
      input.zendeskUpdatedAt,
    ]
  );
}

/**
 * Updates only the embedding + embedded_at for an already-upserted
 * article row. Kept separate from upsertArticleMetadata so the
 * incremental-refresh skip path never has to know about vectors.
 */
export async function updateArticleEmbedding(
  zendeskAccountId: number,
  zendeskArticleId: number,
  embedding: number[]
): Promise<void> {
  await pool.query(
    `UPDATE guide_articles
     SET embedding = $1, embedded_at = now()
     WHERE zendesk_account_id = $2 AND zendesk_article_id = $3`,
    [`[${embedding.join(",")}]`, zendeskAccountId, zendeskArticleId]
  );
}

/**
 * Returns the stored zendesk_updated_at for an article, or null if we
 * haven't ingested it before. Used to decide whether re-embedding is
 * needed on refresh (HCIQ-9's incremental-refresh requirement).
 */
export async function getStoredArticleUpdatedAt(
  zendeskAccountId: number,
  zendeskArticleId: number
): Promise<Date | null> {
  const result = await pool.query<{ zendesk_updated_at: Date | null }>(
    `SELECT zendesk_updated_at FROM guide_articles
     WHERE zendesk_account_id = $1 AND zendesk_article_id = $2`,
    [zendeskAccountId, zendeskArticleId]
  );
  return result.rows[0]?.zendesk_updated_at ?? null;
}

export async function countArticlesForAccount(zendeskAccountId: number): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT COUNT(*) FROM guide_articles WHERE zendesk_account_id = $1`,
    [zendeskAccountId]
  );
  return parseInt(result.rows[0].count, 10);
}

/**
 * Finds the nearest articles to a given embedding vector using pgvector
 * cosine distance — used for the demo's similarity query and later by
 * gap classification (HCIQ-11).
 */
export async function findNearestArticles(
  zendeskAccountId: number,
  queryEmbedding: number[],
  limit = 5
): Promise<Array<{ title: string | null; distance: number }>> {
  const result = await pool.query<{ title: string | null; distance: number }>(
    `SELECT title, embedding <=> $1 AS distance
     FROM guide_articles
     WHERE zendesk_account_id = $2 AND embedding IS NOT NULL AND draft = false
     ORDER BY distance ASC
     LIMIT $3`,
    [`[${queryEmbedding.join(",")}]`, zendeskAccountId, limit]
  );
  return result.rows;
}
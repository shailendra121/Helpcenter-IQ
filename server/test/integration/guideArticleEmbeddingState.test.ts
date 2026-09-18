import "dotenv/config";

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest";

import { pool } from "../../src/db/pool.js";

import {
  upsertArticleMetadata,
  updateArticleEmbedding,
} from "../../src/db/models/guideArticles.js";

describe("guide article embedding state", () => {
  let accountId: number;

  const zendeskArticleId = 987654321;

  const embedding = Array.from(
    { length: 1536 },
    () => 0.1
  );

  beforeAll(async () => {
    const result = await pool.query<{ id: number }>(
      `INSERT INTO zendesk_accounts
         (
           subdomain,
           oauth_access_token_encrypted,
           oauth_refresh_token_encrypted
         )
       VALUES ($1, $2, $3)
       RETURNING id`,
      [
        `guide-embedding-test-${Date.now()}`,
        "test-access-token",
        "test-refresh-token",
      ]
    );

    accountId = result.rows[0].id;
  });

  afterAll(async () => {
    if (accountId) {
      await pool.query(
        `DELETE FROM zendesk_accounts
         WHERE id = $1`,
        [accountId]
      );
    }
  });

  async function upsertArticle(
    cleanText: string,
    draft = false,
    updatedAt = new Date(
      "2026-01-01T00:00:00Z"
    )
  ) {
    return upsertArticleMetadata({
      zendeskAccountId: accountId,
      zendeskArticleId,
      title: "Test article",
      cleanText,
      sectionId: 100,
      locale: "en-us",
      draft,
      zendeskCreatedAt: new Date(
        "2025-01-01T00:00:00Z"
      ),
      zendeskUpdatedAt: updatedAt,
    });
  }

  async function getEmbedding() {
    const result = await pool.query<{
      embedding: string | null;
      embedded_at: Date | null;
    }>(
      `SELECT
         embedding,
         embedded_at
       FROM guide_articles
       WHERE zendesk_account_id = $1
         AND zendesk_article_id = $2`,
      [
        accountId,
        zendeskArticleId,
      ]
    );

    return result.rows[0];
  }

  it("preserves the embedding when article content is unchanged", async () => {
    await upsertArticle(
      "Original article content."
    );

    await updateArticleEmbedding(
      accountId,
      zendeskArticleId,
      embedding
    );

    const result = await upsertArticle(
      "Original article content.",
      false,
      new Date(
        "2026-01-01T00:00:00Z"
      )
    );

    expect(result.hasEmbedding).toBe(true);

    const stored = await getEmbedding();

    expect(stored.embedding).not.toBeNull();
    expect(stored.embedded_at).not.toBeNull();
  });

  it("clears the old embedding when article content changes", async () => {
    await upsertArticle(
      "Original content."
    );

    await updateArticleEmbedding(
      accountId,
      zendeskArticleId,
      embedding
    );

    const result = await upsertArticle(
      "Updated article content.",
      false,
      new Date(
        "2026-02-01T00:00:00Z"
      )
    );

    expect(result.hasEmbedding).toBe(false);

    const stored = await getEmbedding();

    expect(stored.embedding).toBeNull();
    expect(stored.embedded_at).toBeNull();
  });

  it("clears the old embedding when an article becomes a draft", async () => {
    await upsertArticle(
      "Published article content.",
      false
    );

    await updateArticleEmbedding(
      accountId,
      zendeskArticleId,
      embedding
    );

    const result = await upsertArticle(
      "Published article content.",
      true,
      new Date(
        "2026-03-01T00:00:00Z"
      )
    );

    expect(result.hasEmbedding).toBe(false);

    const stored = await getEmbedding();

    expect(stored.embedding).toBeNull();
    expect(stored.embedded_at).toBeNull();
  });

  it("clears the old embedding when article content becomes empty", async () => {
    await upsertArticle(
      "Article with real content.",
      false
    );

    await updateArticleEmbedding(
      accountId,
      zendeskArticleId,
      embedding
    );

    const result = await upsertArticle(
      "",
      false,
      new Date(
        "2026-04-01T00:00:00Z"
      )
    );

    expect(result.hasEmbedding).toBe(false);

    const stored = await getEmbedding();

    expect(stored.embedding).toBeNull();
    expect(stored.embedded_at).toBeNull();
  });
});
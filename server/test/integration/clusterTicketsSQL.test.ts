import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../../src/db/pool.js";
import { upsertZendeskAccount } from "../../src/db/models/zendeskAccounts.js";
import { createAnalysisRun } from "../../src/db/models/analysisRuns.js";
import { upsertTicket, updateTicketEmbedding } from "../../src/db/models/tickets.js";
import { clusterTicketsForRunSQL } from "../../src/clustering/clusterTicketsSQL.js";

// Simple, human-readable 3-dimensional test vectors (real embeddings
// are 1536-dim, but the algorithm/SQL logic doesn't care about
// dimension — using small vectors keeps this test easy to verify by
// hand). NOTE: the real schema is vector(1536); this test inserts
// short vectors purely to exercise the clustering logic, not to
// validate dimension handling (that's covered elsewhere).
describe("clusterTicketsForRunSQL (real database)", () => {
  let accountId: number;
  let runId: number;
  const ticketIds: number[] = [];

  beforeAll(async () => {
    const account = await upsertZendeskAccount({
      subdomain: `test-sql-clustering-${Date.now()}`,
      accessTokenEncrypted: "fake-encrypted-token",
      refreshTokenEncrypted: null,
      scope: "read write",
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    accountId = account.id;

    const run = await createAnalysisRun(accountId, 30);
    runId = run.id;

    // Two tickets very similar to each other, one very different —
    // same test shape as clusterTickets.test.ts's pure-algorithm tests.
    const testTickets = [
      { zendeskTicketId: 90001, subject: "Similar A" },
      { zendeskTicketId: 90002, subject: "Similar B" },
      { zendeskTicketId: 90003, subject: "Different" },
    ];

    for (const t of testTickets) {
      await upsertTicket({
        zendeskAccountId: accountId,
        analysisRunId: runId,
        zendeskTicketId: t.zendeskTicketId,
        subject: t.subject,
        description: null,
        firstComment: null,
        status: "open",
        tags: [],
        zendeskCreatedAt: new Date(),
        copilotTopic: null,
        copilotSentiment: null,
        copilotIntent: null,
      });
    }

    const idsResult = await pool.query<{ id: number }>(
      `SELECT id FROM tickets WHERE zendesk_account_id = $1 AND analysis_run_id = $2 ORDER BY zendesk_ticket_id`,
      [accountId, runId]
    );
    ticketIds.push(...idsResult.rows.map((r) => r.id));

    // Build real 1536-dim vectors: two nearly identical, one orthogonal.
    const base = Array(1536).fill(0.1);
    const similarA = [...base];
    const similarB = base.map((v) => v + 0.001); // nearly identical to A
    const different = Array(1536).fill(0);
    different[0] = 1; // orthogonal direction

    await updateTicketEmbedding(ticketIds[0], similarA);
    await updateTicketEmbedding(ticketIds[1], similarB);
    await updateTicketEmbedding(ticketIds[2], different);
  });

  afterAll(async () => {
    await pool.query("DELETE FROM zendesk_accounts WHERE id = $1", [accountId]);
    // Not calling pool.end() — shared singleton, per the pattern
    // established in ticketIdempotency.test.ts.
  });

  it("groups similar tickets and separates dissimilar ones via SQL nearest-neighbor lookup", async () => {
    const result = await clusterTicketsForRunSQL(accountId, runId, {
      similarityThreshold: 0.9,
      minClusterSize: 2,
    });

    expect(result.clusters).toHaveLength(1);
    expect(result.clusters[0].memberTicketIds.sort()).toEqual(
      [ticketIds[0], ticketIds[1]].sort()
    );
    expect(result.unclusteredTicketIds).toEqual([ticketIds[2]]);
  });

  it("is idempotent — re-running clears prior working-cluster rows first", async () => {
    await clusterTicketsForRunSQL(accountId, runId, {
      similarityThreshold: 0.9,
      minClusterSize: 2,
    });

    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*) FROM clustering_working_clusters WHERE zendesk_account_id = $1 AND analysis_run_id = $2`,
      [accountId, runId]
    );

    // Two working clusters expected (the joined pair + the singleton),
    // not accumulating duplicates across the two calls in this test.
    expect(parseInt(countResult.rows[0].count, 10)).toBe(2);
  });
});
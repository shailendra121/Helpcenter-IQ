import { pool } from "../db/pool.js";
import { getEmbeddedTicketsForRun } from "../db/models/tickets.js";
import { getDefaultClusteringConfig, type ClusteringConfig, type ClusteringOutput, type ClusterResult } from "./clusterTickets.js";
import { parseVector } from "./vectorMath.js";

/**
 * Scalability follow-up for HCIQ-10's O(n × k) in-memory clustering
 * (flagged during PR review). Same threshold-based algorithm and
 * config — only the execution strategy changes: instead of comparing
 * each ticket against every cluster's centroid in JS, we ask pgvector
 * for the nearest existing cluster via one indexed SQL query per
 * ticket. This turns per-ticket cost from O(k) JS comparisons into a
 * single O(log k) indexed lookup, so wall-clock time scales with
 * ticket count rather than ticket count × cluster count.
 */
export async function clusterTicketsForRunSQL(
  zendeskAccountId: number,
  analysisRunId: number,
  config: ClusteringConfig = getDefaultClusteringConfig()
): Promise<ClusteringOutput> {
  // Idempotency: clear any working-table rows left over from a prior
  // run of this same analysis run before starting fresh.
  await pool.query(
    `DELETE FROM clustering_working_clusters WHERE zendesk_account_id = $1 AND analysis_run_id = $2`,
    [zendeskAccountId, analysisRunId]
  );

  const embeddedTickets = await getEmbeddedTicketsForRun(zendeskAccountId, analysisRunId);
  const tickets = embeddedTickets
    .filter((t): t is typeof t & { embedding: string } => t.embedding !== null)
    .map((t) => ({ id: t.id, vector: parseVector(t.embedding) }));

  for (const ticket of tickets) {
    const vectorStr = `[${ticket.vector.join(",")}]`;

    // Single indexed query replaces the JS loop over every existing
    // cluster — this is the core of the fix.
    const nearest = await pool.query<{ id: number; distance: number; member_count: number }>(
      `SELECT id, centroid <=> $1 AS distance, member_count
       FROM clustering_working_clusters
       WHERE zendesk_account_id = $2 AND analysis_run_id = $3
       ORDER BY distance ASC
       LIMIT 1`,
      [vectorStr, zendeskAccountId, analysisRunId]
    );

    const similarity = nearest.rows[0] ? 1 - nearest.rows[0].distance : -1;

    if (nearest.rows[0] && similarity >= config.similarityThreshold) {
      // Join the matched cluster. pgvector doesn't support vector /
      // scalar division, so we fetch the current sum, compute the new
      // sum and centroid average in JS, and write both back.
      const clusterId = nearest.rows[0].id;
      const newCount = nearest.rows[0].member_count + 1;

      const currentSumResult = await pool.query<{ sum_embedding: string }>(
        `SELECT sum_embedding FROM clustering_working_clusters WHERE id = $1`,
        [clusterId]
      );
      const currentSum = parseVector(currentSumResult.rows[0].sum_embedding);
      const newSum = currentSum.map((val, i) => val + ticket.vector[i]);
      const newCentroid = newSum.map((val) => val / newCount);

      await pool.query(
        `UPDATE clustering_working_clusters
         SET sum_embedding = $1,
             member_count = $2,
             member_ticket_ids = array_append(member_ticket_ids, $3),
             centroid = $4
         WHERE id = $5`,
        [
          `[${newSum.join(",")}]`,
          newCount,
          ticket.id,
          `[${newCentroid.join(",")}]`,
          clusterId,
        ]
      );
    } else {
      // No match above threshold — start a new working cluster.
      await pool.query(
        `INSERT INTO clustering_working_clusters
           (zendesk_account_id, analysis_run_id, centroid, sum_embedding, member_count, member_ticket_ids)
         VALUES ($1, $2, $3, $3, 1, ARRAY[$4]::integer[])`,
        [zendeskAccountId, analysisRunId, vectorStr, ticket.id]
      );
    }
  }

  // Read back the final working clusters and split into real
  // clusters vs. noise, same minClusterSize rule as the original.
  const finalResult = await pool.query<{
    centroid: string;
    member_count: number;
    member_ticket_ids: number[];
  }>(
    `SELECT centroid, member_count, member_ticket_ids
     FROM clustering_working_clusters
     WHERE zendesk_account_id = $1 AND analysis_run_id = $2`,
    [zendeskAccountId, analysisRunId]
  );

  const clusters: ClusterResult[] = [];
  const unclusteredTicketIds: number[] = [];

  for (const row of finalResult.rows) {
    if (row.member_count >= config.minClusterSize) {
      clusters.push({
        memberTicketIds: row.member_ticket_ids,
        centroid: parseVector(row.centroid),
      });
    } else {
      unclusteredTicketIds.push(...row.member_ticket_ids);
    }
  }

  return { clusters, unclusteredTicketIds };
}
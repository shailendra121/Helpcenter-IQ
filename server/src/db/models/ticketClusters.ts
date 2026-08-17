import { pool } from "../pool.js";

function cosineDistance(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denominator = Math.sqrt(magA) * Math.sqrt(magB);
  if (denominator === 0) return 1; // maximally distant if either vector is zero
  return 1 - dot / denominator;
}

export interface CreateClusterInput {
  zendeskAccountId: number;
  analysisRunId: number;
  topicLabel: string;
  topicSummary: string;
  centroidEmbedding: number[];
  memberTicketIds: number[];
  /** Parallel array to memberTicketIds — used to compute each member's
   * distance from the centroid when inserting membership rows (per
   * review: the distance column was defined but never populated). */
  memberVectors: number[][];
  representativeTicketIds: number[];
}

/**
 * Persists a topic cluster and its ticket membership. Membership is
 * kept in a separate table (ticket_cluster_members) since the same
 * ticket can belong to different clusters across different analysis
 * runs — see HCIQ-10's migration for the rationale.
 */
export async function createTicketCluster(input: CreateClusterInput): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const clusterResult = await client.query<{ id: number }>(
      `INSERT INTO ticket_clusters
         (zendesk_account_id, analysis_run_id, topic_label, topic_summary,
          ticket_count, centroid_embedding, representative_ticket_ids)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        input.zendeskAccountId,
        input.analysisRunId,
        input.topicLabel,
        input.topicSummary,
        input.memberTicketIds.length,
        `[${input.centroidEmbedding.join(",")}]`,
        input.representativeTicketIds,
      ]
    );

    const clusterId = clusterResult.rows[0].id;

    // Bulk insert all members in one query rather than one INSERT per
    // ticket (per review, lower priority — worth doing while we're
    // already touching this loop). Also populates distance, which was
    // previously always NULL (per review).
    if (input.memberTicketIds.length > 0) {
      const distances = input.memberVectors.map((vector) =>
        cosineDistance(vector, input.centroidEmbedding)
      );

      const values: unknown[] = [];
      const placeholders: string[] = [];
      input.memberTicketIds.forEach((ticketId, i) => {
        const base = i * 3;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
        values.push(clusterId, ticketId, distances[i]);
      });

      await client.query(
        `INSERT INTO ticket_cluster_members (cluster_id, ticket_id, distance) VALUES ${placeholders.join(", ")}`,
        values
      );
    }

    await client.query("COMMIT");
    return clusterId;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export interface TicketClusterRow {
  id: number;
  topic_label: string;
  topic_summary: string | null;
  ticket_count: number;
  representative_ticket_ids: string[] | null;
}

export async function getClustersForRun(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<TicketClusterRow[]> {
  const result = await pool.query<TicketClusterRow>(
    `SELECT id, topic_label, topic_summary, ticket_count, representative_ticket_ids
     FROM ticket_clusters
     WHERE zendesk_account_id = $1 AND analysis_run_id = $2
     ORDER BY ticket_count DESC`,
    [zendeskAccountId, analysisRunId]
  );
  return result.rows;
}
/**
 * Deletes existing clusters for a run before re-clustering — makes
 * runClustering() idempotent, so re-running doesn't duplicate rows.
 * Membership rows in ticket_cluster_members cascade-delete automatically.
 */
export async function deleteClustersForRun(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<void> {
  await pool.query(
    `DELETE FROM ticket_clusters WHERE zendesk_account_id = $1 AND analysis_run_id = $2`,
    [zendeskAccountId, analysisRunId]
  );
}
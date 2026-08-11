import { pool } from "../pool.js";

export interface CreateClusterInput {
  zendeskAccountId: number;
  analysisRunId: number;
  topicLabel: string;
  topicSummary: string;
  centroidEmbedding: number[];
  memberTicketIds: number[];
  representativeTicketIds: number[];
}

/**
 * Persists a topic cluster and its ticket membership. Membership is
 * kept in a separate table (ticket_cluster_members) since the same
 * ticket can belong to different clusters across different analysis
 * runs — see HCIQ-10's migration for the rationale.
 */
export async function createTicketCluster(input: CreateClusterInput): Promise<number> {
  const clusterResult = await pool.query<{ id: number }>(
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

  // Insert membership rows. Simple loop is fine at MVP data volumes;
  // a bulk INSERT would be a reasonable optimization if ticket counts
  // per run grow large.
  for (const ticketId of input.memberTicketIds) {
    await pool.query(
      `INSERT INTO ticket_cluster_members (cluster_id, ticket_id) VALUES ($1, $2)`,
      [clusterId, ticketId]
    );
  }

  return clusterId;
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
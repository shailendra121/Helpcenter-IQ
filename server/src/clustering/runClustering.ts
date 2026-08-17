import { embedTickets } from "./embedTickets.js";
import { getDefaultClusteringConfig } from "./clusterTickets.js";
import { clusterTicketsForRunSQL } from "./clusterTicketsSQL.js";
import { generateClusterLabel } from "./generateClusterLabel.js";
import { createTicketCluster, deleteClustersForRun } from "../db/models/ticketClusters.js";
import { getTicketsByIds } from "../db/models/tickets.js";
import { pool } from "../db/pool.js";

const MAX_REPRESENTATIVE_TICKETS = 5;
const FALLBACK_LABEL = "Unlabeled cluster";

export interface ClusteringRunResult {
  clustersCreated: number;
  ticketsClustered: number;
  ticketsUnclustered: number;
}

/**
 * Full clustering pipeline for an analysis run: embed any tickets that
 * don't have an embedding yet, cluster them (greedy threshold-based —
 * see clusterTickets.ts), generate an AI label for each cluster from
 * masked representative tickets, and persist the results.
 */
export async function runClustering(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<ClusteringRunResult> {
  await embedTickets(zendeskAccountId, analysisRunId);

  // Idempotency fix (per review): clear any existing clusters for this
  // run before creating new ones, so re-running doesn't duplicate rows.
  await deleteClustersForRun(zendeskAccountId, analysisRunId);

  const config = getDefaultClusteringConfig();
  const { clusters, unclusteredTicketIds } = await clusterTicketsForRunSQL(
    zendeskAccountId,
    analysisRunId,
    config
  );

  let clustersCreated = 0;

  for (const cluster of clusters) {
    const representativeIds = cluster.memberTicketIds.slice(0, MAX_REPRESENTATIVE_TICKETS);
    const representativeTickets = await getTicketsByIds(representativeIds);

    // Label generation fail-safe (per review): a cluster with real
    // customer tickets is too much to lose silently for a
    // support-facing feature. If labeling fails, fall back to a
    // placeholder label and still persist the cluster and its
    // tickets, rather than dropping them.
    let label = FALLBACK_LABEL;
    let summary = "";

    try {
      const generated = await generateClusterLabel(
        representativeTickets.map((t) => ({ subject: t.subject, description: t.description }))
      );
      label = generated.label;
      summary = generated.summary;
    } catch (err) {
      await logClusteringIssue(zendeskAccountId, analysisRunId, cluster.memberTicketIds.length, err);
    }

    try {
      await createTicketCluster({
        zendeskAccountId,
        analysisRunId,
        topicLabel: label,
        topicSummary: summary,
        centroidEmbedding: cluster.centroid,
        memberTicketIds: cluster.memberTicketIds,
        memberVectors: cluster.memberVectors,
        representativeTicketIds: representativeIds,
      });
      clustersCreated++;
    } catch (err) {
      // A genuine persistence failure (not a labeling failure) is
      // still isolated per-cluster, but logged the same durable way.
      await logClusteringIssue(zendeskAccountId, analysisRunId, cluster.memberTicketIds.length, err);
    }
  }

  return {
    clustersCreated,
    ticketsClustered: clusters.reduce((sum, c) => sum + c.memberTicketIds.length, 0),
    ticketsUnclustered: unclusteredTicketIds.length,
  };
}

/**
 * Logs clustering issues to audit_logs (queryable, not just a
 * console.error that scrolls away) so a real failure gets noticed
 * rather than silently passing.
 */
async function logClusteringIssue(
  zendeskAccountId: number,
  analysisRunId: number,
  ticketCount: number,
  err: unknown
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Cluster processing issue (run ${analysisRunId}, ${ticketCount} tickets):`, err);
  try {
    await pool.query(
      `INSERT INTO audit_logs (zendesk_account_id, event_type, detail_json)
       VALUES ($1, $2, $3)`,
      [
        zendeskAccountId,
        "clustering_cluster_processing_failed",
        JSON.stringify({ analysisRunId, ticketCount, error: message }),
      ]
    );
  } catch {
    // If even the audit log write fails, the console.error above is
    // the last line of defense — don't let logging itself crash the run.
  }
}
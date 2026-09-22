import { embedTickets } from "./embedTickets.js";
import { getDefaultClusteringConfig } from "./clusterTickets.js";
import { clusterTicketsForRunSQL } from "./clusterTicketsSQL.js";
import { generateClusterLabel } from "./generateClusterLabel.js";
import {
  createTicketCluster,
  deleteClustersForRun,
} from "../db/models/ticketClusters.js";
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
 * Full clustering pipeline for an analysis run:
 * - embed tickets
 * - clear prior clusters for idempotent retry
 * - cluster tickets
 * - generate labels
 * - persist clusters
 *
 * Label-generation failures are degraded gracefully with a fallback
 * label because the underlying cluster is still valid.
 *
 * Persistence failures are treated as stage failures so HCIQ-14 does
 * not incorrectly mark a partially persisted clustering stage complete.
 */
export async function runClustering(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<ClusteringRunResult> {
  await embedTickets(zendeskAccountId, analysisRunId);

  await deleteClustersForRun(zendeskAccountId, analysisRunId);

  const config = getDefaultClusteringConfig();

  const { clusters, unclusteredTicketIds } =
    await clusterTicketsForRunSQL(
      zendeskAccountId,
      analysisRunId,
      config
    );

  let clustersCreated = 0;
  const persistenceFailures: unknown[] = [];

  for (const cluster of clusters) {
    const representativeIds = cluster.memberTicketIds.slice(
      0,
      MAX_REPRESENTATIVE_TICKETS
    );

    const representativeTickets = await getTicketsByIds(
      representativeIds,
      zendeskAccountId
    );

    let label = FALLBACK_LABEL;
    let summary = "";

    try {
      const generated = await generateClusterLabel(
        representativeTickets.map((t) => ({
          subject: t.subject,
          description: t.description,
        }))
      );

      label = generated.label;
      summary = generated.summary;
    } catch (err) {
      await logClusteringIssue(
        zendeskAccountId,
        analysisRunId,
        cluster.memberTicketIds.length,
        err
      );
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
      persistenceFailures.push(err);

      await logClusteringIssue(
        zendeskAccountId,
        analysisRunId,
        cluster.memberTicketIds.length,
        err
      );
    }
  }

  if (persistenceFailures.length > 0) {
    const firstFailure = persistenceFailures[0];

    const firstMessage =
      firstFailure instanceof Error
        ? firstFailure.message
        : String(firstFailure);

    throw new Error(
      `Clustering persistence failed for ${persistenceFailures.length} cluster(s). ` +
        `${clustersCreated} cluster(s) persisted successfully. ` +
        `First error: ${firstMessage}`
    );
  }

  return {
    clustersCreated,
    ticketsClustered: clusters.reduce(
      (sum, c) => sum + c.memberTicketIds.length,
      0
    ),
    ticketsUnclustered: unclusteredTicketIds.length,
  };
}

/**
 * Writes clustering issues to audit_logs so degraded label generation
 * and persistence failures remain queryable.
 */
async function logClusteringIssue(
  zendeskAccountId: number,
  analysisRunId: number,
  ticketCount: number,
  err: unknown
): Promise<void> {
  const message =
    err instanceof Error ? err.message : String(err);

  console.error(
    `Cluster processing issue (run ${analysisRunId}, ${ticketCount} tickets):`,
    err
  );

  try {
    await pool.query(
      `INSERT INTO audit_logs (
         zendesk_account_id,
         event_type,
         detail_json
       )
       VALUES ($1, $2, $3)`,
      [
        zendeskAccountId,
        "clustering_cluster_processing_failed",
        JSON.stringify({
          analysisRunId,
          ticketCount,
          error: message,
        }),
      ]
    );
  } catch {
    // Logging must never hide the original clustering behavior.
  }
}
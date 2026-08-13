import { embedTickets } from "./embedTickets.js";
import { clusterTicketsForRun, getDefaultClusteringConfig } from "./clusterTickets.js";
import { generateClusterLabel } from "./generateClusterLabel.js";
import { createTicketCluster, deleteClustersForRun } from "../db/models/ticketClusters.js";
import { getTicketsByIds } from "../db/models/tickets.js";


const MAX_REPRESENTATIVE_TICKETS = 5;

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
  const { clusters, unclusteredTicketIds } = await clusterTicketsForRun(
    zendeskAccountId,
    analysisRunId,
    config
  );

  let clustersCreated = 0;

  for (const cluster of clusters) {
    try {
      const representativeIds = cluster.memberTicketIds.slice(0, MAX_REPRESENTATIVE_TICKETS);
      const representativeTickets = await getTicketsByIds(representativeIds);

      const { label, summary } = await generateClusterLabel(
        representativeTickets.map((t) => ({ subject: t.subject, description: t.description }))
      );

      await createTicketCluster({
        zendeskAccountId,
        analysisRunId,
        topicLabel: label,
        topicSummary: summary,
        centroidEmbedding: cluster.centroid,
        memberTicketIds: cluster.memberTicketIds,
        representativeTicketIds: representativeIds,
      });

      clustersCreated++;
    } catch (err) {
      // Error isolation fix (per review): one cluster's label-generation
      // failure shouldn't abort the whole run — log and continue so the
      // remaining clusters still get processed.
      console.error(
        `Failed to process a cluster with ${cluster.memberTicketIds.length} tickets:`,
        err
      );
    }
  }

  return {
    clustersCreated,
    ticketsClustered: clusters.reduce((sum, c) => sum + c.memberTicketIds.length, 0),
    ticketsUnclustered: unclusteredTicketIds.length,
  };
}
import { embedTickets } from "./embedTickets.js";
import { clusterTicketsForRun, getDefaultClusteringConfig } from "./clusterTickets.js";
import { generateClusterLabel } from "./generateClusterLabel.js";
import { createTicketCluster } from "../db/models/ticketClusters.js";
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
  // Step 1: ensure every ticket in this run has an embedding.
  await embedTickets(zendeskAccountId, analysisRunId);

  // Step 2: cluster the embedded tickets.
  const config = getDefaultClusteringConfig();
  const { clusters, unclusteredTicketIds } = await clusterTicketsForRun(
    zendeskAccountId,
    analysisRunId,
    config
  );

  // Step 3: for each cluster, pick representative tickets, generate a
  // label, and persist.
  for (const cluster of clusters) {
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
  }

  return {
    clustersCreated: clusters.length,
    ticketsClustered: clusters.reduce((sum, c) => sum + c.memberTicketIds.length, 0),
    ticketsUnclustered: unclusteredTicketIds.length,
  };
}
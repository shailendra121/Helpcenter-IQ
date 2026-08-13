import { cosineSimilarity, computeCentroid, parseVector } from "./vectorMath.js";
import { getEmbeddedTicketsForRun, type TicketForClustering } from "../db/models/tickets.js";

/**
 * Clustering parameters — config, not hard-coded, per this story's
 * acceptance criteria. Can be overridden via env vars for tuning
 * without a code change.
 */
export interface ClusteringConfig {
  /** Minimum cosine similarity to join an existing cluster (0-1). */
  similarityThreshold: number;
  /** Clusters smaller than this are treated as noise/unclustered. */
  minClusterSize: number;
}

export function getDefaultClusteringConfig(): ClusteringConfig {
  return {
    similarityThreshold: Number(process.env.CLUSTERING_SIMILARITY_THRESHOLD ?? 0.70),
    minClusterSize: Number(process.env.CLUSTERING_MIN_CLUSTER_SIZE ?? 2),
  };
}

interface WorkingCluster {
  memberTicketIds: number[];
  memberVectors: number[][];
  centroid: number[];
}

export interface ClusterResult {
  memberTicketIds: number[];
  centroid: number[];
}

export interface ClusteringOutput {
  clusters: ClusterResult[];
  unclusteredTicketIds: number[];
}

/**
 * Chosen over more complex options (HDBSCAN, agglomerative) per this
 * story's "start simple, don't over-engineer" guidance — documented on
 * the ticket. For each ticket, in fetch order: join the best matching
 * existing cluster whose centroid similarity exceeds
 * similarityThreshold, or start a new cluster.
 */
export function clusterEmbeddings(
  tickets: Array<{ id: number; vector: number[] }>,
  config: ClusteringConfig
): ClusteringOutput {
  const workingClusters: WorkingCluster[] = [];

  for (const ticket of tickets) {
    let bestCluster: WorkingCluster | null = null;
    let bestSimilarity = -1;

    for (const cluster of workingClusters) {
      const similarity = cosineSimilarity(ticket.vector, cluster.centroid);
      if (similarity >= config.similarityThreshold && similarity > bestSimilarity) {
        bestCluster = cluster;
        bestSimilarity = similarity;
      }
    }

    if (bestCluster) {
      bestCluster.memberTicketIds.push(ticket.id);
      bestCluster.memberVectors.push(ticket.vector);
      bestCluster.centroid = computeCentroid(bestCluster.memberVectors);
    } else {
      workingClusters.push({
        memberTicketIds: [ticket.id],
        memberVectors: [ticket.vector],
        centroid: ticket.vector,
      });
    }
  }

  const clusters: ClusterResult[] = [];
  const unclusteredTicketIds: number[] = [];

  for (const cluster of workingClusters) {
    if (cluster.memberTicketIds.length >= config.minClusterSize) {
      clusters.push({ memberTicketIds: cluster.memberTicketIds, centroid: cluster.centroid });
    } else {
      unclusteredTicketIds.push(...cluster.memberTicketIds);
    }
  }

  return { clusters, unclusteredTicketIds };
}

/**
 * Loads embedded tickets for a run from the DB and clusters them.
 */
export async function clusterTicketsForRun(
  zendeskAccountId: number,
  analysisRunId: number,
  config: ClusteringConfig = getDefaultClusteringConfig()
): Promise<ClusteringOutput> {
  const embeddedTickets = await getEmbeddedTicketsForRun(zendeskAccountId, analysisRunId);

  const withVectors = embeddedTickets
    .filter((t): t is TicketForClustering & { embedding: string } => t.embedding !== null)
    .map((t) => ({ id: t.id, vector: parseVector(t.embedding) }));

  return clusterEmbeddings(withVectors, config);
}
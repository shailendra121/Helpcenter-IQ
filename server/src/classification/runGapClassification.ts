import { getClustersForRun } from "../db/models/ticketClusters.js";
import { getTicketsByIds } from "../db/models/tickets.js";
import { createKnowledgeGap, deleteGapsForRun } from "../db/models/knowledgeGaps.js";
import { classifyGap } from "./classifyGap.js";
import { pool } from "../db/pool.js";

// Limits concurrent cluster processing so large accounts (100+ clusters)
// don't fire hundreds of sequential LLM calls one at a time, while still
// respecting AI provider rate limits by not going fully unbounded.
const BATCH_SIZE = 5;

/**
 * Runs gap classification for every topic cluster in an analysis run —
 * the orchestrator tying HCIQ-11's pieces together. Depends on HCIQ-10
 * (clusters must exist) and HCIQ-9 (article embeddings must exist).
 *
 * Processes clusters in bounded-concurrency batches rather than fully
 * sequentially — at MVP-scale cluster counts (single digits to low
 * tens) this doesn't matter much, but avoids a linear wall-clock-time
 * cliff as accounts grow (flagged during review, same scaling concern
 * raised on HCIQ-10's clustering loop).
 */
export async function runGapClassification(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<{ gapsCreated: number }> {
  await deleteGapsForRun(zendeskAccountId, analysisRunId);

  const clusters = await getClustersForRun(zendeskAccountId, analysisRunId);

  let gapsCreated = 0;

  for (let i = 0; i < clusters.length; i += BATCH_SIZE) {
    const batch = clusters.slice(i, i + BATCH_SIZE);

    const results = await Promise.allSettled(
      batch.map((cluster) => processCluster(zendeskAccountId, analysisRunId, cluster))
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        gapsCreated++;
      } else {
        // Per-cluster error isolation: one cluster's classification
        // failure shouldn't abort the whole run — log and continue,
        // same pattern as HCIQ-10's runClustering.ts.
        console.error("Failed to classify a cluster:", result.reason);
      }
    }
  }

  return { gapsCreated };
}

async function processCluster(
  zendeskAccountId: number,
  analysisRunId: number,
  cluster: Awaited<ReturnType<typeof getClustersForRun>>[number]
): Promise<void> {
  const representativeIds = (cluster.representative_ticket_ids ?? []).map(Number);
  const representativeTickets = await getTicketsByIds(representativeIds);
  const excerpts = representativeTickets.map(
    (t) => `${t.subject ?? ""} — ${t.description ?? ""}`.trim()
  );

  const centroidResult = await pool.query<{ centroid_embedding: string }>(
    `SELECT centroid_embedding FROM ticket_clusters WHERE id = $1`,
    [cluster.id]
  );
  const centroidStr = centroidResult.rows[0].centroid_embedding;
  const topicEmbedding = centroidStr
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);

  const result = await classifyGap({
    zendeskAccountId,
    topicSummary: cluster.topic_summary ?? cluster.topic_label,
    topicEmbedding,
    ticketVolume: cluster.ticket_count,
    representativeTicketExcerpts: excerpts,
  });

  await createKnowledgeGap({
    analysisRunId,
    zendeskAccountId,
    clusterId: cluster.id,
    topicSummary: cluster.topic_label,
    classification: result.classification,
    estimatedTicketVolume: cluster.ticket_count,
    priorityScore: result.priorityScore,
    relatedGuideArticleId: result.relatedGuideArticleId,
    similarityScore: result.similarityScore,
    justification: result.justification,
    topicEmbedding,
  });
}
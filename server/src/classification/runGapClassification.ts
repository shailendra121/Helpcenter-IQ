import { getClustersForRun } from "../db/models/ticketClusters.js";
import { getTicketsByIds } from "../db/models/tickets.js";
import {
  createKnowledgeGap,
  deleteGapsForRun,
} from "../db/models/knowledgeGaps.js";
import { classifyGap } from "./classifyGap.js";
import { pool } from "../db/pool.js";

// Limits concurrent cluster processing so large accounts don't fire
// an unbounded number of AI calls at once.
const BATCH_SIZE = 5;

/**
 * Runs gap classification for every topic cluster in an analysis run.
 *
 * Clusters are processed with bounded concurrency. Individual failures
 * are allowed to settle so the rest of the current batch can finish,
 * but any failure makes the overall classification stage fail.
 *
 * This is important for HCIQ-14: the orchestrator must not mark the
 * classification stage completed when one or more clusters were not
 * successfully classified.
 *
 * A retry starts by clearing gaps for the run and regenerating them,
 * so partially-created gaps from a failed attempt do not survive the
 * next classification attempt.
 */
export async function runGapClassification(
  zendeskAccountId: number,
  analysisRunId: number
): Promise<{ gapsCreated: number }> {
  await deleteGapsForRun(
    zendeskAccountId,
    analysisRunId
  );

  const clusters = await getClustersForRun(
    zendeskAccountId,
    analysisRunId
  );

  let gapsCreated = 0;
  const failures: unknown[] = [];

  for (
    let i = 0;
    i < clusters.length;
    i += BATCH_SIZE
  ) {
    const batch = clusters.slice(
      i,
      i + BATCH_SIZE
    );

    const results = await Promise.allSettled(
      batch.map((cluster) =>
        processCluster(
          zendeskAccountId,
          analysisRunId,
          cluster
        )
      )
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        gapsCreated++;
      } else {
        failures.push(result.reason);

        console.error(
          "Failed to classify a cluster:",
          result.reason
        );
      }
    }
  }

  // HCIQ-14 requires the stage to fail if any cluster could not
  // be classified. Successful work in the batch is allowed to finish,
  // but the orchestrator must receive an error rather than treating
  // this as a completed stage.
  if (failures.length > 0) {
    const firstFailure = failures[0];

    const firstMessage =
      firstFailure instanceof Error
        ? firstFailure.message
        : String(firstFailure);

    throw new Error(
      `Gap classification failed for ${failures.length} cluster(s). ` +
        `${gapsCreated} cluster(s) completed successfully. ` +
        `First error: ${firstMessage}`
    );
  }

  return { gapsCreated };
}

async function processCluster(
  zendeskAccountId: number,
  analysisRunId: number,
  cluster: Awaited<
    ReturnType<typeof getClustersForRun>
  >[number]
): Promise<void> {
  const representativeIds = (
    cluster.representative_ticket_ids ?? []
  ).map(Number);

  const representativeTickets =
    await getTicketsByIds(
      representativeIds,
      zendeskAccountId
    );

  const excerpts = representativeTickets.map(
    (ticket) =>
      `${ticket.subject ?? ""} — ${
        ticket.description ?? ""
      }`.trim()
  );

  const centroidResult =
    await pool.query<{
      centroid_embedding: string;
    }>(
      `SELECT centroid_embedding
       FROM ticket_clusters
       WHERE id = $1`,
      [cluster.id]
    );

  const centroidStr =
    centroidResult.rows[0].centroid_embedding;

  const topicEmbedding = centroidStr
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map(Number);

  const result = await classifyGap({
    zendeskAccountId,
    topicSummary:
      cluster.topic_summary ??
      cluster.topic_label,
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
    estimatedTicketVolume:
      cluster.ticket_count,
    priorityScore: result.priorityScore,
    relatedGuideArticleId:
      result.relatedGuideArticleId,
    similarityScore: result.similarityScore,
    justification: result.justification,
    topicEmbedding,
  });
}
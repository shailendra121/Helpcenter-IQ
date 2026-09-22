import { Router } from "express";
import type { AuthenticatedZafRequest } from "../auth/zafSession.js";
import { requireZafSession } from "../auth/zafSession.js";
import { requireTrustedOrigin } from "../auth/requireTrustedOrigin.js";
import { pool } from "../db/pool.js";
import {
  generateDraftForGap,
  KnowledgeGapMissingClusterError,
  KnowledgeGapNotFoundError,
} from "../drafts/runDraftGeneration.js";

const router = Router();

type GapClassification =
  | "missing"
  | "weak"
  | "outdated"
  | "good_coverage";

/*
 * All dashboard endpoints require a verified ZAF session.
 *
 * The session identifies the Zendesk account and subdomain that
 * the dashboard is allowed to access.
 */
router.use(requireZafSession);

/**
 * GET /api/dashboard/session
 *
 * Returns the Zendesk tenant represented by the authenticated
 * ZAF session.
 *
 * Important:
 * - The tenant identity comes from the verified signed session.
 * - It is not accepted from query params or request body.
 * - An invalid/missing session is rejected by requireZafSession
 *   before this handler runs.
 */
router.get("/session", (rawReq, res) => {
  const req =
    rawReq as unknown as AuthenticatedZafRequest;

  const {
    zendeskAccountId,
    subdomain,
  } = req.zafSession;

  return res.json({
    authenticated: true,
    zendesk_account_id: zendeskAccountId,
    subdomain,
    zendesk_url:
      `https://${subdomain}.zendesk.com`,
  });
});

/**
 * GET /api/dashboard/gaps
 *
 * Returns gaps from the latest completed analysis run
 * belonging to the authenticated Zendesk account.
 *
 * Query params:
 *   classification: missing | weak | outdated | good_coverage
 *   sort: priority | volume | topic
 */
router.get("/gaps", async (rawReq, res) => {
  const req = rawReq as unknown as AuthenticatedZafRequest;

  try {
    const classification = req.query.classification;
    const sort = req.query.sort ?? "priority";

    if (
      classification !== undefined &&
      ![
        "missing",
        "weak",
        "outdated",
        "good_coverage",
      ].includes(String(classification))
    ) {
      return res.status(400).json({
        error:
          "classification must be one of missing, weak, outdated, or good_coverage",
      });
    }

    if (
      sort !== "priority" &&
      sort !== "volume" &&
      sort !== "topic"
    ) {
      return res.status(400).json({
        error: "sort must be one of priority, volume, or topic",
      });
    }

    const accountId = req.zafSession.zendeskAccountId;

    const runResult = await pool.query<{ id: number }>(
      `SELECT id
       FROM analysis_runs
       WHERE zendesk_account_id = $1
         AND status = 'completed'
       ORDER BY completed_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [accountId],
    );

    const run = runResult.rows[0];

    if (!run) {
      return res.json({
        run: null,
        gaps: [],
      });
    }

    let orderBy =
      "kg.priority_score DESC NULLS LAST, kg.id DESC";

    if (sort === "volume") {
      orderBy =
        "kg.estimated_ticket_volume DESC, kg.id DESC";
    } else if (sort === "topic") {
      orderBy =
        "kg.topic_summary ASC, kg.id ASC";
    }

    const params: unknown[] = [run.id];
    let classificationClause = "";

    if (classification !== undefined) {
      params.push(String(classification));
      classificationClause =
        `AND kg.classification = $${params.length}`;
    }

    params.push(accountId);
    const accountParam = params.length;

    const result = await pool.query<{
      id: number;
      analysis_run_id: number;
      topic_summary: string;
      classification: GapClassification;
      estimated_ticket_volume: number;
      priority_score: string | null;
      related_guide_article_id: number | null;
      guide_article_id: string | null;
      guide_article_title: string | null;
      guide_article_locale: string | null;
      justification: string | null;
    }>(
      `SELECT
         kg.id,
         kg.analysis_run_id,
         kg.topic_summary,
         kg.classification,
         kg.estimated_ticket_volume,
         kg.priority_score,
         kg.related_guide_article_id,
         ga.zendesk_article_id::text AS guide_article_id,
         ga.title AS guide_article_title,
         ga.locale AS guide_article_locale,
         kg.justification
       FROM knowledge_gaps kg
       LEFT JOIN guide_articles ga
         ON ga.id = kg.related_guide_article_id
        AND ga.zendesk_account_id = $${accountParam}
       WHERE kg.analysis_run_id = $1
         AND kg.zendesk_account_id = $${accountParam}
         ${classificationClause}
       ORDER BY ${orderBy}`,
      params,
    );

    const subdomain = req.zafSession.subdomain;

    return res.json({
      run: {
        id: run.id,
      },
      gaps: result.rows.map((gap) => ({
        id: gap.id,
        analysis_run_id: gap.analysis_run_id,
        topic: gap.topic_summary,
        classification: gap.classification,
        ticket_volume: gap.estimated_ticket_volume,
        priority_score: gap.priority_score,
        justification: gap.justification,
        matched_article_id:
          gap.related_guide_article_id,
        matched_article_title:
          gap.guide_article_title,
        matched_article_locale:
          gap.guide_article_locale,
        matched_article_url: gap.guide_article_id
          ? `https://${subdomain}.zendesk.com/hc/${
              gap.guide_article_locale ?? "en-us"
            }/articles/${gap.guide_article_id}`
          : null,
      })),
    });
  } catch (error) {
    console.error(
      "[dashboard-api] Failed to list gaps:",
      error,
    );

    return res.status(500).json({
      error: "Failed to load knowledge gaps",
    });
  }
});

/**
 * GET /api/dashboard/summary
 *
 * Returns dashboard summary metrics for the latest completed
 * analysis run belonging to the authenticated Zendesk account.
 */
router.get("/summary", async (rawReq, res) => {
  const req = rawReq as unknown as AuthenticatedZafRequest;

  try {
    const accountId = req.zafSession.zendeskAccountId;

    const runResult = await pool.query<{ id: number }>(
      `SELECT id
       FROM analysis_runs
       WHERE zendesk_account_id = $1
         AND status = 'completed'
       ORDER BY completed_at DESC NULLS LAST, id DESC
       LIMIT 1`,
      [accountId],
    );

    const run = runResult.rows[0];

    if (!run) {
      return res.json({
        run: null,
        summary: null,
      });
    }

    const summaryResult = await pool.query<{
      estimated_ticket_volume: string;
      articles_needing_updates: string;
      potential_deflection_estimate: string;
    }>(
      `SELECT
         COALESCE(
           SUM(estimated_ticket_volume),
           0
         )::text AS estimated_ticket_volume,

         COUNT(*) FILTER (
           WHERE classification IN ('weak', 'outdated')
         )::text AS articles_needing_updates,

         COALESCE(
           SUM(
             CASE
               WHEN classification IN (
                 'missing',
                 'weak',
                 'outdated'
               )
               THEN estimated_ticket_volume
               ELSE 0
             END
           ),
           0
         )::text AS potential_deflection_estimate

       FROM knowledge_gaps
       WHERE zendesk_account_id = $1
         AND analysis_run_id = $2`,
      [accountId, run.id],
    );

    const missingResult = await pool.query<{
      id: number;
      topic_summary: string;
      estimated_ticket_volume: number;
      priority_score: string | null;
      related_guide_article_id: number | null;
      guide_article_title: string | null;
    }>(
      `SELECT
         kg.id,
         kg.topic_summary,
         kg.estimated_ticket_volume,
         kg.priority_score,
         kg.related_guide_article_id,
         ga.title AS guide_article_title
       FROM knowledge_gaps kg
       LEFT JOIN guide_articles ga
         ON ga.id = kg.related_guide_article_id
        AND ga.zendesk_account_id = $1
       WHERE kg.zendesk_account_id = $1
         AND kg.analysis_run_id = $2
         AND kg.classification = 'missing'
       ORDER BY
         kg.priority_score DESC NULLS LAST,
         kg.estimated_ticket_volume DESC,
         kg.id DESC
       LIMIT 5`,
      [accountId, run.id],
    );

    const repeatedQuestionsResult = await pool.query<{
      id: number;
      topic_summary: string;
      estimated_ticket_volume: number;
      classification: GapClassification;
    }>(
      `SELECT
         id,
         topic_summary,
         estimated_ticket_volume,
         classification
       FROM knowledge_gaps
       WHERE zendesk_account_id = $1
         AND analysis_run_id = $2
       ORDER BY
         estimated_ticket_volume DESC,
         id DESC
       LIMIT 5`,
      [accountId, run.id],
    );

    const summary = summaryResult.rows[0];

    const estimatedTicketVolume = Number(
      summary?.estimated_ticket_volume ?? 0,
    );

    const articlesNeedingUpdates = Number(
      summary?.articles_needing_updates ?? 0,
    );

    const potentialDeflectionEstimate = Number(
      summary?.potential_deflection_estimate ?? 0,
    );

    return res.json({
      run: {
        id: run.id,
      },

      summary: {
        top_missing_articles:
          missingResult.rows.map((item) => ({
            id: item.id,
            topic: item.topic_summary,
            ticket_volume:
              item.estimated_ticket_volume,
            priority_score: item.priority_score,
            matched_article_id:
              item.related_guide_article_id,
            matched_article_title:
              item.guide_article_title,
          })),

        most_repeated_questions:
          repeatedQuestionsResult.rows.map((item) => ({
            id: item.id,
            topic: item.topic_summary,
            ticket_volume:
              item.estimated_ticket_volume,
            classification: item.classification,
          })),

        estimated_ticket_volume:
          estimatedTicketVolume,

        articles_needing_updates:
          articlesNeedingUpdates,

        potential_deflection_estimate:
          potentialDeflectionEstimate,

        potential_deflection_label:
          "Estimated potential deflection (volume-based)",

        methodology:
          "Sum of estimated ticket volume for Missing, Weak, and Outdated gaps.",
      },
    });
  } catch (error) {
    console.error(
      "[dashboard-api] Failed to load summary:",
      error,
    );

    return res.status(500).json({
      error: "Failed to load dashboard summary",
    });
  }
});

/**
 * GET /api/dashboard/gaps/:id
 *
 * Returns full detail for one knowledge gap belonging to the
 * authenticated Zendesk account.
 *
 * Includes:
 * - gap metadata
 * - matched Guide article
 * - classification justification
 * - representative Zendesk tickets
 * - HCIQ-12 recommendations
 */
router.get("/gaps/:id", async (rawReq, res) => {
  const req = rawReq as unknown as AuthenticatedZafRequest;

  try {
    const gapId = Number(req.params.id);

    if (!Number.isInteger(gapId)) {
      return res.status(400).json({
        error: "Gap id must be an integer",
      });
    }

    const accountId = req.zafSession.zendeskAccountId;
    const subdomain = req.zafSession.subdomain;

    const gapResult = await pool.query<{
      id: number;
      analysis_run_id: number;
      cluster_id: number | null;
      topic_summary: string;
      classification: GapClassification;
      estimated_ticket_volume: number;
      priority_score: string | null;
      related_guide_article_id: number | null;
      related_guide_article_zendesk_id: string | null;
      related_guide_article_title: string | null;
      related_guide_article_locale: string | null;
      justification: string | null;
    }>(
      `SELECT
         kg.id,
         kg.analysis_run_id,
         kg.cluster_id,
         kg.topic_summary,
         kg.classification,
         kg.estimated_ticket_volume,
         kg.priority_score,
         kg.related_guide_article_id,
         ga.zendesk_article_id::text AS related_guide_article_zendesk_id,
         ga.title AS related_guide_article_title,
         ga.locale AS related_guide_article_locale,
         kg.justification
       FROM knowledge_gaps kg
       LEFT JOIN guide_articles ga
         ON ga.id = kg.related_guide_article_id
        AND ga.zendesk_account_id = kg.zendesk_account_id
       WHERE kg.id = $1
         AND kg.zendesk_account_id = $2
       LIMIT 1`,
      [gapId, accountId],
    );

    const gap = gapResult.rows[0];

    if (!gap) {
      return res.status(404).json({
        error: `Knowledge gap ${gapId} not found`,
      });
    }

    let ticketRows: Array<{
      id: number;
      zendesk_ticket_id: string;
      subject: string | null;
      description: string | null;
      status: string | null;
    }> = [];

    if (gap.cluster_id !== null) {
      const ticketResult = await pool.query<{
        id: number;
        zendesk_ticket_id: string;
        subject: string | null;
        description: string | null;
        status: string | null;
      }>(
        `SELECT
           t.id,
           t.zendesk_ticket_id::text AS zendesk_ticket_id,
           t.subject,
           t.description,
           t.status
         FROM ticket_clusters tc
         CROSS JOIN LATERAL unnest(
           COALESCE(
             tc.representative_ticket_ids,
             '{}'::bigint[]
           )
         ) AS representative_ticket_id
         JOIN tickets t
           ON t.id = representative_ticket_id
          AND t.zendesk_account_id = $2
          AND t.analysis_run_id = tc.analysis_run_id
         WHERE tc.id = $1
           AND tc.zendesk_account_id = $2
         ORDER BY t.zendesk_ticket_id`,
        [gap.cluster_id, accountId],
      );

      ticketRows = ticketResult.rows;
    }

    const recommendationResult = await pool.query<{
      id: number;
      recommendation_type: string;
      rationale: string;
      suggested_keywords: string[] | null;
      suggested_title: string | null;
    }>(
      `SELECT
         gr.id,
         gr.recommendation_type,
         gr.rationale,
         gr.suggested_keywords,
         gr.suggested_title
       FROM gap_recommendations gr
       WHERE gr.gap_id = $1
         AND gr.zendesk_account_id = $2
       ORDER BY gr.id`,
      [gapId, accountId],
    );

    const matchedArticleUrl =
      gap.related_guide_article_zendesk_id
        ? `https://${subdomain}.zendesk.com/hc/${
            gap.related_guide_article_locale ?? "en-us"
          }/articles/${gap.related_guide_article_zendesk_id}`
        : null;

    return res.json({
      id: gap.id,
      analysis_run_id: gap.analysis_run_id,
      cluster_id: gap.cluster_id,
      topic: gap.topic_summary,
      classification: gap.classification,
      ticket_volume: gap.estimated_ticket_volume,
      priority_score: gap.priority_score,
      justification: gap.justification,

      matched_article_id:
        gap.related_guide_article_id,
      matched_article_title:
        gap.related_guide_article_title,
      matched_article_locale:
        gap.related_guide_article_locale,
      matched_article_url: matchedArticleUrl,

      representative_tickets:
        ticketRows.map((ticket) => ({
          id: ticket.id,
          zendesk_ticket_id:
            ticket.zendesk_ticket_id,
          subject: ticket.subject,
          description: ticket.description,
          status: ticket.status,
          zendesk_url:
            `https://${subdomain}.zendesk.com/agent/tickets/${ticket.zendesk_ticket_id}`,
        })),

      recommendations:
        recommendationResult.rows.map(
          (recommendation) => ({
            id: recommendation.id,
            recommendation_type:
              recommendation.recommendation_type,
            rationale: recommendation.rationale,
            suggested_keywords:
              recommendation.suggested_keywords,
            suggested_title:
              recommendation.suggested_title,
          }),
        ),
    });
  } catch (error) {
    console.error(
      "[dashboard-api] Failed to load gap detail:",
      error,
    );

    return res.status(500).json({
      error: "Failed to load knowledge gap",
    });
  }
});

/**
 * POST /api/dashboard/gaps/:id/drafts
 *
 * Generates one draft article for the selected non-Good gap.
 */
router.post("/gaps/:id/drafts", requireTrustedOrigin, async (rawReq, res) => {
  const req = rawReq as unknown as AuthenticatedZafRequest;

  try {
    const gapId = Number(req.params.id);

    if (!Number.isInteger(gapId)) {
      return res.status(400).json({
        error: "Gap id must be an integer",
      });
    }

    const accountId = req.zafSession.zendeskAccountId;

    const result = await generateDraftForGap(
      accountId,
      gapId,
    );

    return res.status(201).json({
      id: result.draftId,
      gap_id: gapId,
    });
  } catch (error) {
    if (error instanceof KnowledgeGapNotFoundError) {
  return res.status(404).json({
    error: error.message,
  });
}

if (
  error instanceof KnowledgeGapMissingClusterError
) {
  return res.status(422).json({
    error: error.message,
  });
    }

    console.error(
      "[dashboard-api] Failed to generate draft:",
      error,
    );

    return res.status(500).json({
      error: "Failed to generate draft",
    });
  }
});

export default router;

import { Router } from "express";
import {
  createQueuedRun,
  getAnalysisRun,
} from "../db/models/analysisRuns.js";
import { findZendeskAccountById } from "../db/models/zendeskAccounts.js";

const router = Router();

/**
 * POST /api/analysis-runs
 *
 * Creates a new background analysis run.
 *
 * Body:
 * {
 *   "zendeskAccountId": 1,
 *   "windowDays": 30
 * }
 */
router.post("/", async (req, res) => {
  try {
    const { zendeskAccountId, windowDays } = req.body;

    if (!Number.isInteger(zendeskAccountId)) {
      return res.status(400).json({
        error: "zendeskAccountId must be an integer",
      });
    }

    if (![30, 60, 90].includes(windowDays)) {
      return res.status(400).json({
        error: "windowDays must be one of 30, 60, or 90",
      });
    }

    const account = await findZendeskAccountById(zendeskAccountId);

    if (!account) {
      return res.status(404).json({
        error: `Zendesk account ${zendeskAccountId} not found`,
      });
    }

    const run = await createQueuedRun(
      zendeskAccountId,
      windowDays,
    );

    return res.status(202).json({
      id: run.id,
      zendesk_account_id: run.zendesk_account_id,
      window_days: run.window_days,
      status: run.status,
      current_stage: run.current_stage,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes("already active")) {
      return res.status(409).json({
        error: message,
      });
    }

    console.error("[analysis-api] Failed to create run:", error);

    return res.status(500).json({
      error: "Failed to create analysis run",
    });
  }
});

/**
 * GET /api/analysis-runs/:id
 *
 * Returns the current status of an analysis run.
 */
router.get("/:id", async (req, res) => {
  try {
    const runId = Number(req.params.id);

    if (!Number.isInteger(runId)) {
      return res.status(400).json({
        error: "Run id must be an integer",
      });
    }

    const run = await getAnalysisRun(runId);

    if (!run) {
      return res.status(404).json({
        error: `Analysis run ${runId} not found`,
      });
    }

    return res.json({
      id: run.id,
      zendesk_account_id: run.zendesk_account_id,
      window_days: run.window_days,
      status: run.status,
      current_stage: run.current_stage,
      error_stage: run.error_stage,
      error_message: run.error_message,
      started_at: run.started_at,
      completed_at: run.completed_at,
      stage_timestamps: run.stage_timestamps,
    });
  } catch (error) {
    console.error("[analysis-api] Failed to get run:", error);

    return res.status(500).json({
      error: "Failed to get analysis run",
    });
  }
});

export default router;
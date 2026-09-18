import { Router } from "express";
import type { AuthenticatedZafRequest } from "../auth/zafSession.js";
import { requireZafSession } from "../auth/zafSession.js";
import { requireTrustedOrigin } from "../auth/requireTrustedOrigin.js";
import {
  ActiveRunExistsError,
  createQueuedRun,
  getLatestRunForAccount,
  getAnalysisRun,
} from "../db/models/analysisRuns.js";
const router = Router();

/**
 * All analysis-run APIs require a verified ZAF session.
 *
 * The Zendesk account is taken from the authenticated session rather
 * than from a client-supplied zendeskAccountId.
 */
router.use(requireZafSession);

/**
 * POST /api/analysis-runs
 *
 * Creates a new background analysis run for the authenticated
 * Zendesk account.
 *
 * Body:
 * {
 *   "windowDays": 30
 * }
 */
router.post("/",requireTrustedOrigin, async (rawReq, res) => {
  const req = rawReq as unknown as AuthenticatedZafRequest;

  try {
    const { windowDays } = req.body;

    if (![30, 60, 90].includes(windowDays)) {
      return res.status(400).json({
        error: "windowDays must be one of 30, 60, or 90",
      });
    }

    const run = await createQueuedRun(
      req.zafSession.zendeskAccountId,
      windowDays,
    );

    return res.status(202).json({
      id: run.id,
      window_days: run.window_days,
      status: run.status,
      current_stage: run.current_stage,
    });
  } catch (error) {
    if (error instanceof ActiveRunExistsError) {
      return res.status(409).json({
        error: error.message,
      });
    }

    console.error("[analysis-api] Failed to create run:", error);

    return res.status(500).json({
      error: "Failed to create analysis run",
    });
  }
});

/**
 * GET /api/analysis-runs/latest
 *
 * Returns the authenticated Zendesk account's most recent
 * analysis run, regardless of status.
 *
 * Used by the dashboard when it loads/reloads so queued,
 * running, completed, and failed runs can be restored.
 *
 * IMPORTANT: this route must remain above /:id so Express does not
 * interpret "latest" as an analysis-run id.
 */
router.get("/latest", async (rawReq, res) => {
  const req = rawReq as unknown as AuthenticatedZafRequest;

  try {
    const run = await getLatestRunForAccount(
      req.zafSession.zendeskAccountId,
    );

    if (!run) {
      return res.json({
        run: null,
      });
    }

    return res.json({
      run: {
        id: run.id,
        window_days: run.window_days,
        status: run.status,
        current_stage: run.current_stage,
        error_stage: run.error_stage,
        error_message: run.error_message,
        started_at: run.started_at,
        completed_at: run.completed_at,
        stage_timestamps: run.stage_timestamps,
      },
    });
  } catch (error) {
    console.error(
  "[analysis-api] Failed to get latest run:",
  error,
);

return res.status(500).json({
  error: "Failed to get latest analysis run",
});
  }
});

/**
 * GET /api/analysis-runs/:id
 *
 * Returns the current status of an analysis run.
 *
 * A run belonging to another Zendesk account is intentionally
 * returned as 404 so its existence is not disclosed.
 */
router.get("/:id", async (rawReq, res) => {
  const req = rawReq as unknown as AuthenticatedZafRequest;

  try {
    const runId = Number(req.params.id);

    if (!Number.isInteger(runId)) {
      return res.status(400).json({
        error: "Run id must be an integer",
      });
    }

    const run = await getAnalysisRun(runId);

    if (
      !run ||
      run.zendesk_account_id !== req.zafSession.zendeskAccountId
    ) {
      return res.status(404).json({
        error: `Analysis run ${runId} not found`,
      });
    }

    return res.json({
      id: run.id,
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
    console.error(
      "[analysis-api] Failed to get run:",
      error,
    );

    return res.status(500).json({
      error: "Failed to get analysis run",
    });
  }
});

export default router;
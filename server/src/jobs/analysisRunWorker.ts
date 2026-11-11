import {
  claimNextQueuedRun,
  failAnalysisRun,
  getAnalysisRun,
} from "../db/models/analysisRuns.js";
import { runAnalysisPipeline } from "./runAnalysisPipeline.js";

export async function processNextAnalysisRun(): Promise<boolean> {
  const run = await claimNextQueuedRun();

  if (!run) {
    return false;
  }

  console.log(
    `[analysis-worker] Claimed run ${run.id} for account ${run.zendesk_account_id}`,
  );

  try {
    await runAnalysisPipeline(run.id, run.zendesk_account_id);
    console.log(`[analysis-worker] Run ${run.id} completed successfully`);
  } catch (error) {
    console.error(`[analysis-worker] Run ${run.id} failed:`, error);

    // The pipeline records stage-level failures; this is a safety net for
    // failures that happen outside a stage.
    const currentRun = await getAnalysisRun(run.id, run.zendesk_account_id);
    if (currentRun?.status !== "failed") {
      await failAnalysisRun(run.id, run.zendesk_account_id);
    }
  }

  return true;
}
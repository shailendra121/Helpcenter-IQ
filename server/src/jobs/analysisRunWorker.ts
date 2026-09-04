import {
  claimNextQueuedRun,
  failAnalysisRun,
  getAnalysisRun,
  recoverInterruptedRuns,
} from "../db/models/analysisRuns.js";
import { runAnalysisPipeline } from "./runAnalysisPipeline.js";

const POLL_INTERVAL_MS = 2000;

let workerRunning = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function processNextAnalysisRun(): Promise<boolean> {
  const run = await claimNextQueuedRun();

  if (!run) {
    return false;
  }

  console.log(
    `[analysis-worker] Claimed run ${run.id} for account ${run.zendesk_account_id}`,
  );

  try {
    await runAnalysisPipeline(run.id);

    console.log(
      `[analysis-worker] Run ${run.id} completed successfully`,
    );
  } catch (error) {
    console.error(
      `[analysis-worker] Run ${run.id} failed:`,
      error,
    );

    // The pipeline records stage-level failures.
    // This is a safety net for failures that happen outside a stage.
    const currentRun = await getAnalysisRun(run.id);

    if (currentRun?.status !== "failed") {
      await failAnalysisRun(run.id);
    }
  }

  return true;
}

export async function startAnalysisRunWorker(): Promise<void> {
  if (workerRunning) {
    return;
  }

  workerRunning = true;
  const recoveredRuns = await recoverInterruptedRuns();

  if (recoveredRuns > 0) {
    console.log(
      `[analysis-worker] Recovered ${recoveredRuns} interrupted run(s)`,
    );
  }

  console.log("[analysis-worker] Started");

  while (workerRunning) {
    try {
      const processed = await processNextAnalysisRun();

      if (!processed) {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (error) {
      console.error(
        "[analysis-worker] Unexpected worker error:",
        error,
      );

      await sleep(POLL_INTERVAL_MS);
    }
  }
}

export function stopAnalysisRunWorker(): void {
  workerRunning = false;

  console.log("[analysis-worker] Stopped");
}
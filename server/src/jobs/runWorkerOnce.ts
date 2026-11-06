import "dotenv/config";
import { processNextAnalysisRun } from "./analysisRunWorker.js";
import { recoverStaleRuns } from "../db/models/analysisRuns.js";
import { pool } from "../db/pool.js";

/**
 * Cloud Run Job entrypoint: recover any stale runs, drain the queue, then exit.
 * Triggered on a schedule by Cloud Scheduler and immediately when a run is
 * queued. Executions can overlap, so recovery is stale-only (see recoverStaleRuns).
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log(
      "[worker-job] DATABASE_URL not configured yet - nothing to do.",
    );
    return;
  }

  // Re-queue runs a previous execution left stale (killed mid-run by timeout,
  // OOM or deploy). Stale-only, so it never disturbs a run another overlapping
  // execution is actively processing.
  const recovered = await recoverStaleRuns();
  if (recovered > 0) {
    console.log(`[worker-job] Re-queued ${recovered} stale run(s).`);
  }

  while (await processNextAnalysisRun()) {
    // keep going until the queue is empty
  }

  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
import "dotenv/config";
import { processNextAnalysisRun } from "./analysisRunWorker.js";
import { pool } from "../db/pool.js";

/**
 * Cloud Run Job entrypoint: drain the queued analysis runs, then exit.
 * Triggered on a schedule by Cloud Scheduler.
 */
async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log(
      "[worker-job] DATABASE_URL not configured yet - nothing to do.",
    );
    return;
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
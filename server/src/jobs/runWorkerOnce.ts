import "dotenv/config";
import { processNextAnalysisRun } from "./analysisRunWorker.js";
import { pool } from "../db/pool.js";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log("[worker-job] DATABASE_URL not configured yet - nothing to do.");
    return;
  }

  while (await processNextAnalysisRun()) {
    // next run
  }
  await pool.end();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
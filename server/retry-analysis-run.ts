import "dotenv/config";
import { retryAnalysisRun } from "./src/db/models/analysisRuns.js";

async function main() {
  console.log("Retry script started");

  const run = await retryAnalysisRun(8);

  console.log("Retry result:");
  console.log(run);

  if (!run) {
    console.log("Run 8 was not retried. It may not be in failed status.");
    return;
  }

  console.log(
    JSON.stringify(run, null, 2)
  );
}

main().catch((error) => {
  console.error("RETRY FAILED:");
  console.error(error);
  process.exitCode = 1;
});
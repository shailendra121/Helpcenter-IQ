import "dotenv/config";
import app from "./app";
import { startAnalysisRunWorker } from "./jobs/analysisRunWorker.js";

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`HelpCenterIQ server listening on port ${PORT}`);

  void startAnalysisRunWorker().catch((error) => {
    console.error(
      "[analysis-worker] Failed to start:",
      error,
    );
  });
});
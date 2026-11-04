import "dotenv/config";
import app from "./app";

const PORT = process.env.PORT || 4000;

// The analysis worker no longer runs inside the web server: on Cloud Run it
// runs as a Cloud Run Job (see src/jobs/runWorkerOnce.ts).
app.listen(PORT, () => {
  console.log(`HelpCenterIQ server listening on port ${PORT}`);
});
/**
 * Fire-and-forget: ask Cloud Run to start the analysis worker job right away,
 * so a freshly queued run doesn't wait for the next Cloud Scheduler tick.
 * Never throws; a no-op off Cloud Run (local/CI), where the scheduler (or a
 * manual execute) remains the backstop.
 */
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

async function getAccessToken(): Promise<string | null> {
  try {
    const res = await fetch(METADATA_TOKEN_URL, {
      headers: { "Metadata-Flavor": "Google" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null; // not on Cloud Run (local / tests)
  }
}

export async function triggerWorkerJob(): Promise<void> {
  const region = process.env.GCP_REGION ?? "asia-south1";
  const project = process.env.GCP_PROJECT_ID;
  const job = process.env.WORKER_JOB_NAME ?? "helpcenteriq-worker";
  if (!project) return;

  const token = await getAccessToken();
  if (!token) return;

  try {
    const res = await fetch(
      `https://${region}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${project}/jobs/${job}:run`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      console.error(
        `triggerWorkerJob: ${job}:run returned ${res.status} — the run will wait for the next schedule`,
      );
    }
  } catch (err) {
    console.error(
      "triggerWorkerJob failed; the scheduler will pick the run up:",
      err instanceof Error ? err.message : err,
    );
  }
}

import "dotenv/config";
import { afterEach, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import {
  createAnalysisRun,
  recoverStaleRuns,
  claimNextQueuedRun,
} from "../../src/db/models/analysisRuns.js";
import { upsertZendeskAccount } from "../../src/db/models/zendeskAccounts.js";

/**
 * HCIQ-21 — recoverStaleRuns must re-queue only runs that have been RUNNING
 * longer than the limit (by claimed_at, the last time they were picked up),
 * never a freshly claimed run, and never a run that was recovered then
 * re-claimed (its claimed_at is fresh again).
 */
describe("recoverStaleRuns — stale-only by claimed_at (real database)", () => {
  const created: number[] = [];

  async function makeAccount(): Promise<number> {
    const a = await upsertZendeskAccount({
      subdomain: `stale-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      accessTokenEncrypted: "fake",
      refreshTokenEncrypted: null,
      scope: "read write",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    created.push(a.id);
    return a.id;
  }

  // Put a run into 'running' with an explicit claimed_at (minutes ago).
  async function makeRunningRun(
    accountId: number,
    claimedMinutesAgo: number,
  ): Promise<number> {
    const run = await createAnalysisRun(accountId, 30);
    await pool.query(
      `UPDATE analysis_runs
       SET status = 'running',
           claimed_at = now() - ($2 || ' minutes')::interval
       WHERE id = $1`,
      [run.id, String(claimedMinutesAgo)],
    );
    return run.id;
  }

  afterEach(async () => {
    if (created.length) {
      await pool.query("DELETE FROM zendesk_accounts WHERE id = ANY($1)", [
        created,
      ]);
      created.length = 0;
    }
  });

  it("re-queues a run that has been running longer than the limit", async () => {
    const acc = await makeAccount();
    const staleId = await makeRunningRun(acc, 90); // > 70-minute limit

    const count = await recoverStaleRuns();
    expect(count).toBeGreaterThanOrEqual(1);

    const row = await pool.query(
      "SELECT status FROM analysis_runs WHERE id = $1",
      [staleId],
    );
    expect(row.rows[0].status).toBe("queued");
  });

  it("leaves a freshly claimed run alone", async () => {
    const acc = await makeAccount();
    const freshId = await makeRunningRun(acc, 2); // just claimed

    await recoverStaleRuns();

    const row = await pool.query(
      "SELECT status FROM analysis_runs WHERE id = $1",
      [freshId],
    );
    expect(row.rows[0].status).toBe("running"); // untouched
  });

    it("leaves a recovered-then-reclaimed run alone (real claim refreshes claimed_at)", async () => {
    const acc = await makeAccount();
    const run = await createAnalysisRun(acc, 30);

    // Make it the ONLY claimable row, with an old original start.
    await pool.query(
      `UPDATE analysis_runs
       SET status = 'queued',
           started_at = now() - interval '200 minutes',
           claimed_at = NULL
       WHERE id = $1`,
      [run.id],
    );
    // Park any other queued rows so claimNextQueuedRun picks ours.
    await pool.query(
      `UPDATE analysis_runs SET status = 'completed'
       WHERE status = 'queued' AND id <> $1`,
      [run.id],
    );

    const claimed = await claimNextQueuedRun();
    expect(claimed?.id).toBe(run.id);

    await recoverStaleRuns();

    const row = await pool.query(
      "SELECT status FROM analysis_runs WHERE id = $1",
      [run.id],
    );
    expect(row.rows[0].status).toBe("running"); // fresh claimed_at → not re-queued
  });
    it("recovers a running row with NULL claimed_at and an old started_at", async () => {
    const acc = await makeAccount();
    const run = await createAnalysisRun(acc, 30);
    // Simulate a pre-migration / standalone run: running, old start, NO claim.
    await pool.query(
      `UPDATE analysis_runs
       SET status = 'running',
           started_at = now() - interval '120 minutes',
           claimed_at = NULL
       WHERE id = $1`,
      [run.id],
    );

    await recoverStaleRuns();

    const row = await pool.query(
      "SELECT status FROM analysis_runs WHERE id = $1",
      [run.id],
    );
    expect(row.rows[0].status).toBe("queued"); // recovered via COALESCE fallback
  });
});
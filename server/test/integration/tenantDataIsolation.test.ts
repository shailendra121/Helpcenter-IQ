import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pool } from "../../src/db/pool.js";
import { upsertZendeskAccount } from "../../src/db/models/zendeskAccounts.js";
import {
  createQueuedRun,
  getAnalysisRun,
  completeAnalysisRun,
  failAnalysisRun,
} from "../../src/db/models/analysisRuns.js";

/**
 * Two-account isolation (real database) — HCIQ-20 AC#1 / merge gate.
 * Installs accounts A and B, gives each an analysis run, and proves A can
 * never read or mutate B's run, and vice versa (zero cross-visibility).
 */
describe("tenant isolation — two accounts (real database)", () => {
  let accountA: number;
  let accountB: number;
  let runA: number;
  let runB: number;

  beforeAll(async () => {
    const a = await upsertZendeskAccount({
      subdomain: `iso-a-${Date.now()}`,
      accessTokenEncrypted: "fake",
      refreshTokenEncrypted: null,
      scope: "read write",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const b = await upsertZendeskAccount({
      subdomain: `iso-b-${Date.now()}`,
      accessTokenEncrypted: "fake",
      refreshTokenEncrypted: null,
      scope: "read write",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    accountA = a.id;
    accountB = b.id;

    runA = (await createQueuedRun(accountA, 30)).id;
    runB = (await createQueuedRun(accountB, 30)).id;
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM analysis_runs WHERE zendesk_account_id = ANY($1)",
      [[accountA, accountB]],
    );
    await pool.query("DELETE FROM zendesk_accounts WHERE id = ANY($1)", [
      [accountA, accountB],
    ]);
  });

  it("an account can read its OWN run", async () => {
    const run = await getAnalysisRun(runA, accountA);
    expect(run?.id).toBe(runA);
  });

  it("an account CANNOT read another account's run", async () => {
    const run = await getAnalysisRun(runA, accountB); // B asks for A's run
    expect(run).toBeNull();
  });

  it("an account CANNOT complete another account's run", async () => {
    await completeAnalysisRun(runA, accountB); // B tries to mutate A's run
    const run = await getAnalysisRun(runA, accountA);
    expect(run?.status).not.toBe("completed");
  });

  it("an account CANNOT fail another account's run", async () => {
    await failAnalysisRun(runB, accountA); // A tries to mutate B's run
    const run = await getAnalysisRun(runB, accountB);
    expect(run?.status).not.toBe("failed");
  });

  it("an account CAN complete its own run", async () => {
    await completeAnalysisRun(runA, accountA);
    const run = await getAnalysisRun(runA, accountA);
    expect(run?.status).toBe("completed");
  });
});
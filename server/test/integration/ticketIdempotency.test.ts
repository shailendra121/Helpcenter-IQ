import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../../src/db/pool.js";
import { upsertTicket } from "../../src/db/models/tickets.js";
import { upsertZendeskAccount } from "../../src/db/models/zendeskAccounts.js";
import { createAnalysisRun } from "../../src/db/models/analysisRuns.js";

// This test hits a real local Postgres (see infra/docker/docker-compose.yml)
// to prove the actual DB constraint prevents duplicates — the mocked
// tests in ingestTickets.test.ts verify the call pattern, this verifies
// the real guarantee.
describe("ticket idempotency (real database)", () => {
  let accountId: number;
  let runId: number;

  beforeAll(async () => {
    const account = await upsertZendeskAccount({
      subdomain: `test-idempotency-${Date.now()}`, // unique per test run
      accessTokenEncrypted: "fake-encrypted-token",
      refreshTokenEncrypted: null,
      scope: "read write",
      expiresAt: new Date(Date.now() + 3600 * 1000),
    });
    accountId = account.id;

    const run = await createAnalysisRun(accountId, 30);
    runId = run.id;
  });

  afterAll(async () => {
    // Clean up test data — CASCADE handles tickets/analysis_runs.
    await pool.query("DELETE FROM zendesk_accounts WHERE id = $1", [accountId]);
    await pool.end();
  });

  it("upserting the same ticket twice does not create a duplicate row", async () => {
    const ticketInput = {
      zendeskAccountId: accountId,
      analysisRunId: runId,
      zendeskTicketId: 99999,
      subject: "Original subject",
      description: "Original description",
      firstComment: "Original description",
      status: "open",
      tags: ["urgent"],
      zendeskCreatedAt: new Date(),
      copilotTopic: null,
      copilotSentiment: null,
      copilotIntent: null,
    };

    await upsertTicket(ticketInput);
    // Second call simulates a re-run with the same ticket, possibly
    // with updated fields (e.g. status changed since first ingest).
    await upsertTicket({ ...ticketInput, subject: "Updated subject", status: "closed" });

    const result = await pool.query(
      "SELECT COUNT(*) FROM tickets WHERE zendesk_account_id = $1 AND zendesk_ticket_id = $2",
      [accountId, 99999]
    );

    expect(parseInt(result.rows[0].count, 10)).toBe(1);

    // Also confirm the update actually took effect (not just dedup).
    const row = await pool.query(
      "SELECT subject, status FROM tickets WHERE zendesk_account_id = $1 AND zendesk_ticket_id = $2",
      [accountId, 99999]
    );
    expect(row.rows[0].subject).toBe("Updated subject");
    expect(row.rows[0].status).toBe("closed");
  });
});
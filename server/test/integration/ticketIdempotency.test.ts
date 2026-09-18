import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../../src/db/pool.js";
import {
  upsertTicket,
  updateTicketEmbedding,
} from "../../src/db/models/tickets.js";
import { upsertZendeskAccount } from "../../src/db/models/zendeskAccounts.js";
import { createAnalysisRun } from "../../src/db/models/analysisRuns.js";

describe("ticket idempotency (real database)", () => {
  let accountId: number;
  let runId: number;

  beforeAll(async () => {
    const account = await upsertZendeskAccount({
      subdomain: `test-idempotency-${Date.now()}`,
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
    await pool.query(
      "DELETE FROM zendesk_accounts WHERE id = $1",
      [accountId]
    );

    // Intentionally not calling pool.end() here because pool is shared
    // across integration test files.
  });

  it("upserting the same ticket twice in the same run does not create a duplicate row", async () => {
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

    await upsertTicket({
      ...ticketInput,
      subject: "Updated subject",
      status: "closed",
    });

    const result = await pool.query(
      `SELECT COUNT(*)
       FROM tickets
       WHERE zendesk_account_id = $1
         AND analysis_run_id = $2
         AND zendesk_ticket_id = $3`,
      [accountId, runId, 99999]
    );

    expect(parseInt(result.rows[0].count, 10)).toBe(1);

    const row = await pool.query(
      `SELECT subject, status
       FROM tickets
       WHERE zendesk_account_id = $1
         AND analysis_run_id = $2
         AND zendesk_ticket_id = $3`,
      [accountId, runId, 99999]
    );

    expect(row.rows[0].subject).toBe("Updated subject");
    expect(row.rows[0].status).toBe("closed");
  });

  it("stores separate snapshots of the same Zendesk ticket across different analysis runs", async () => {
    const firstRunTicket = {
      zendeskAccountId: accountId,
      analysisRunId: runId,
      zendeskTicketId: 88888,
      subject: "First run subject",
      description: "First run description",
      firstComment: "First run description",
      status: "open",
      tags: ["first-run"],
      zendeskCreatedAt: new Date(),
      copilotTopic: null,
      copilotSentiment: null,
      copilotIntent: null,
    };

    await upsertTicket(firstRunTicket);

    await pool.query(
      `UPDATE analysis_runs
       SET status = 'completed',
           completed_at = NOW()
       WHERE id = $1`,
      [runId]
    );

    const secondRun = await createAnalysisRun(accountId, 30);

    await upsertTicket({
      ...firstRunTicket,
      analysisRunId: secondRun.id,
      subject: "Second run subject",
      status: "closed",
      tags: ["second-run"],
    });

    const result = await pool.query(
      `SELECT id, analysis_run_id, subject, status
       FROM tickets
       WHERE zendesk_account_id = $1
         AND zendesk_ticket_id = $2
       ORDER BY analysis_run_id`,
      [accountId, 88888]
    );

    expect(result.rows).toHaveLength(2);

    const firstRunRow = result.rows.find(
      (row) => Number(row.analysis_run_id) === runId
    );

    const secondRunRow = result.rows.find(
      (row) => Number(row.analysis_run_id) === secondRun.id
    );

    expect(firstRunRow).toBeDefined();
    expect(secondRunRow).toBeDefined();

    expect(firstRunRow?.subject).toBe("First run subject");
    expect(firstRunRow?.status).toBe("open");

    expect(secondRunRow?.subject).toBe("Second run subject");
    expect(secondRunRow?.status).toBe("closed");

    expect(firstRunRow?.id).not.toBe(secondRunRow?.id);
  });

  it("clears the existing embedding when subject or description changes", async () => {
    const activeRunResult = await pool.query(
      `SELECT id
       FROM analysis_runs
       WHERE zendesk_account_id = $1
         AND status IN ('queued', 'running')
       ORDER BY id DESC
       LIMIT 1`,
      [accountId]
    );

    const activeRunId = Number(activeRunResult.rows[0].id);

    const ticketInput = {
      zendeskAccountId: accountId,
      analysisRunId: activeRunId,
      zendeskTicketId: 77777,
      subject: "Cannot login",
      description: "Login fails with an error",
      firstComment: "Please help",
      status: "open",
      tags: ["login"],
      zendeskCreatedAt: new Date(),
      copilotTopic: null,
      copilotSentiment: null,
      copilotIntent: null,
    };

    await upsertTicket(ticketInput);

    const ticketResult = await pool.query(
      `SELECT id
       FROM tickets
       WHERE zendesk_account_id = $1
         AND analysis_run_id = $2
         AND zendesk_ticket_id = $3`,
      [accountId, activeRunId, 77777]
    );

    const ticketId = Number(ticketResult.rows[0].id);

    await updateTicketEmbedding(
      ticketId,
      Array.from({ length: 1536 }, () => 0.1)
    );

    await upsertTicket({
      ...ticketInput,
      subject: "Cannot login after password reset",
    });

    const result = await pool.query(
      `SELECT embedding
       FROM tickets
       WHERE id = $1`,
      [ticketId]
    );

    expect(result.rows[0].embedding).toBeNull();
  });

  it("keeps the existing embedding when only non-embedding fields change", async () => {
    const activeRunResult = await pool.query(
      `SELECT id
       FROM analysis_runs
       WHERE zendesk_account_id = $1
         AND status IN ('queued', 'running')
       ORDER BY id DESC
       LIMIT 1`,
      [accountId]
    );

    const activeRunId = Number(activeRunResult.rows[0].id);

    const ticketInput = {
      zendeskAccountId: accountId,
      analysisRunId: activeRunId,
      zendeskTicketId: 66666,
      subject: "Billing question",
      description: "Need help understanding invoice",
      firstComment: "Original comment",
      status: "open",
      tags: ["billing"],
      zendeskCreatedAt: new Date(),
      copilotTopic: null,
      copilotSentiment: null,
      copilotIntent: null,
    };

    await upsertTicket(ticketInput);

    const ticketResult = await pool.query(
      `SELECT id
       FROM tickets
       WHERE zendesk_account_id = $1
         AND analysis_run_id = $2
         AND zendesk_ticket_id = $3`,
      [accountId, activeRunId, 66666]
    );

    const ticketId = Number(ticketResult.rows[0].id);

    await updateTicketEmbedding(
      ticketId,
      Array.from({ length: 1536 }, () => 0.4)
    );

    await upsertTicket({
      ...ticketInput,
      status: "closed",
      tags: ["billing", "resolved"],
      firstComment: "Updated comment",
    });

    const result = await pool.query(
      `SELECT embedding, status
       FROM tickets
       WHERE id = $1`,
      [ticketId]
    );

    expect(result.rows[0].embedding).not.toBeNull();
    expect(result.rows[0].status).toBe("closed");
  });
});
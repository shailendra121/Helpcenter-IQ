import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { pool } from "../../src/db/pool.js";

const SECRET = "test-api-iso-secret-test-api-iso-secret";
vi.mock("../../src/db/models/zendeskAccounts.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/db/models/zendeskAccounts.js")
  >("../../src/db/models/zendeskAccounts.js");
  return { ...actual, getAccountZafSecret: vi.fn().mockResolvedValue("x") };
});
vi.mock("../../src/auth/tokenEncryption.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../src/auth/tokenEncryption.js")
  >("../../src/auth/tokenEncryption.js");
  return { ...actual, decryptToken: () => SECRET };
});

import app from "../../src/app.js";
import { upsertZendeskAccount } from "../../src/db/models/zendeskAccounts.js";
import { createAnalysisRun } from "../../src/db/models/analysisRuns.js";
import { createTicketCluster } from "../../src/db/models/ticketClusters.js";
import { createKnowledgeGap } from "../../src/db/models/knowledgeGaps.js";
import { createDraftArticle } from "../../src/db/models/draftArticles.js";

function bearer(subdomain: string): string {
  return `Bearer ${jwt.sign({ subdomain }, SECRET, { expiresIn: 300 })}`;
}

/**
 * HCIQ-20 AC#1 — API-level two-account isolation.
 * Each account has its own run, gap and draft. Every data-serving endpoint is
 * called with account A's token but account B's ids, and must return nothing /
 * 404 and change nothing of B's. Mutation endpoints may also reject with 400
 * (validation) — the point is that B's data is never read or changed.
 */
describe("API tenant isolation — two accounts (real database)", () => {
  const subA = `api-a-${Date.now()}`;
  const subB = `api-b-${Date.now()}`;
  let accA: number;
  let accB: number;
  let runB: number;
  let gapB: number;
  let draftB: number;

  async function seed(accountId: number) {
    const run = await createAnalysisRun(accountId, 30);
    const clusterId = await createTicketCluster({
      zendeskAccountId: accountId,
      analysisRunId: run.id,
      topicLabel: "seed cluster",
      topicSummary: "seed",
      centroidEmbedding: Array(1536).fill(0.01),
      memberTicketIds: [],
      memberVectors: [],
      representativeTicketIds: [],
    });
    const gapId = await createKnowledgeGap({
      analysisRunId: run.id,
      zendeskAccountId: accountId,
      clusterId,
      topicSummary: "seed gap",
      classification: "missing",
      estimatedTicketVolume: 5,
      priorityScore: 10,
      relatedGuideArticleId: null,
      similarityScore: null,
      justification: "seed",
      topicEmbedding: Array(1536).fill(0.01),
    });
    const draftId = await createDraftArticle({
      knowledgeGapId: gapId,
      zendeskAccountId: accountId,
      suggestedTitle: "seed draft",
      problemSummary: "p",
      stepByStepResolution: "s",
      faq: [],
      relatedKeywords: [],
      internalReviewerNotes: "",
      aiModelUsed: "test",
    });
    return { runId: run.id, gapId, draftId };
  }

  beforeAll(async () => {
    const a = await upsertZendeskAccount({
      subdomain: subA,
      accessTokenEncrypted: "fake",
      refreshTokenEncrypted: null,
      scope: "read write",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const b = await upsertZendeskAccount({
      subdomain: subB,
      accessTokenEncrypted: "fake",
      refreshTokenEncrypted: null,
      scope: "read write",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    accA = a.id;
    accB = b.id;

    await seed(accA);
    const bData = await seed(accB);
    runB = bData.runId;
    gapB = bData.gapId;
    draftB = bData.draftId;
  });

  afterAll(async () => {
    await pool.query("DELETE FROM zendesk_accounts WHERE id = ANY($1)", [
      [accA, accB],
    ]);
  });

  const A = () => ({ Authorization: bearer(subA) });

  it("A's session is A, not B", async () => {
    const res = await request(app).get("/api/dashboard/session").set(A());
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(subA);
    expect(JSON.stringify(res.body)).not.toContain(subB);
  });

  it("A's gaps/drafts never include B's data", async () => {
    const gaps = await request(app).get("/api/dashboard/gaps").set(A());
    expect(gaps.status).toBe(200);
    expect(JSON.stringify(gaps.body)).not.toContain(`"id":${gapB}`);

    const drafts = await request(app).get("/api/dashboard/drafts").set(A());
    expect(drafts.status).toBe(200);
    expect(JSON.stringify(drafts.body)).not.toContain(`"id":${draftB}`);
  });

  it("A cannot read B's gap detail", async () => {
    const res = await request(app).get(`/api/dashboard/gaps/${gapB}`).set(A());
    expect(res.status).toBe(404);
  });

  it("A cannot read B's draft", async () => {
    const res = await request(app)
      .get(`/api/dashboard/drafts/${draftB}`)
      .set(A());
    expect(res.status).toBe(404);
  });

  it("A cannot edit B's draft", async () => {
    const res = await request(app)
      .put(`/api/dashboard/drafts/${draftB}`)
      .set(A())
      .send({ suggested_title: "hacked" });
    expect([400, 403, 404]).toContain(res.status);
  });

  it("A cannot change B's draft status", async () => {
    const res = await request(app)
      .post(`/api/dashboard/drafts/${draftB}/status`)
      .set(A())
      .send({ status: "approved" });
    expect([400, 403, 404]).toContain(res.status);
  });

  it("A cannot regenerate B's draft", async () => {
    const res = await request(app)
      .post(`/api/dashboard/drafts/${draftB}/regenerate`)
      .set(A())
      .send({});
    expect([400, 403, 404]).toContain(res.status);
  });

  it("A cannot create a draft from B's gap", async () => {
    const res = await request(app)
      .post(`/api/dashboard/gaps/${gapB}/drafts`)
      .set(A())
      .send({});
    expect([400, 403, 404]).toContain(res.status);
  });

  it("A cannot read B's analysis run", async () => {
    const res = await request(app).get(`/api/analysis-runs/${runB}`).set(A());
    expect(res.status).toBe(404);
  });
});
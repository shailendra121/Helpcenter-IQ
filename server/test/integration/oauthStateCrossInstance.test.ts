import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { pool } from "../../src/db/pool.js";

async function loadApp() {
  vi.resetModules();
  process.env.ZENDESK_OAUTH_CLIENT_ID = "test-client-id";
  process.env.ZENDESK_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.APP_ORIGIN = "https://test.example";

  vi.doMock("../../src/auth/getOAuthClient.js", () => ({
    getOAuthClient: () => ({
      buildAuthorizeUrl: (_s: string, _r: string, state: string) =>
        `https://zendesk.example/oauth?state=${encodeURIComponent(state)}`,
      exchangeCodeForToken: vi.fn().mockResolvedValue({
        accessToken: "a",
        refreshToken: "r",
        scope: "read write",
        expiresAt: new Date(Date.now() + 3600_000),
      }),
    }),
  }));
  vi.doMock("../../src/db/models/zendeskAccounts.js", async () => {
    const actual = await vi.importActual<
      typeof import("../../src/db/models/zendeskAccounts.js")
    >("../../src/db/models/zendeskAccounts.js");
    return {
      ...actual,
      upsertZendeskAccount: vi.fn().mockResolvedValue({ id: 1 }),
      setAccountZafSecret: vi.fn().mockResolvedValue(undefined),
    };
  });
  vi.doMock("../../src/zendesk/setAppJwtSecret.js", () => ({
    setAppJwtSecret: vi.fn().mockResolvedValue(undefined),
  }));

  const mod = await import("../../src/app.js");
  return mod.default;
}

describe("OAuth install works across instances (real database)", () => {
  let capturedJti: string | null = null;

  afterAll(async () => {
    if (capturedJti) {
      await pool.query("DELETE FROM oauth_state_used WHERE jti = $1", [
        capturedJti,
      ]);
    }
  });

  it("start on instance A, callback on instance B completes; replay is rejected", async () => {
    const appA = await loadApp();
    const start = await request(appA).get(
      "/zendesk/oauth/start?subdomain=acme",
    );
    expect(start.status).toBe(302);

    const location = start.headers.location as string;
    const state = new URL(location).searchParams.get("state");
    expect(state).toBeTruthy();
    const payload = JSON.parse(
      Buffer.from((state as string).split(".")[1], "base64url").toString(),
    );
    capturedJti = payload.jti;

    const appB = await loadApp();
    const first = await request(appB).get(
      `/zendesk/oauth/callback?code=abc&state=${encodeURIComponent(state as string)}`,
    );
    expect(first.status).toBe(200);
    expect(first.text).toContain("connected");

    const replay = await request(appB).get(
      `/zendesk/oauth/callback?code=abc&state=${encodeURIComponent(state as string)}`,
    );
    expect(replay.status).toBe(400);
  });
});
import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { pool } from "../../src/db/pool.js";

// Make the token exchange fail fast so the test never hits real Zendesk — the
// replay rejection happens on the state check, before the exchange anyway.
vi.mock("../../src/auth/getOAuthClient.js", () => ({
  getOAuthClient: () => ({
    buildAuthorizeUrl: () => "",
    exchangeCodeForToken: vi
      .fn()
      .mockRejectedValue(new Error("no real zendesk in test")),
  }),
}));

import app from "../../src/app.js";

const secret = process.env.ZAF_SESSION_SECRET ?? "x".repeat(32);

describe("OAuth callback rejects a reused state (real database)", () => {
  const jti = `route-replay-${Date.now()}`;

  afterAll(async () => {
    await pool.query("DELETE FROM oauth_state_used WHERE jti = $1", [jti]);
  });

  it("accepts the state once, then rejects the same state on replay", async () => {
    const state = jwt.sign({ subdomain: "acme", jti }, secret, {
      expiresIn: "10m",
    });
    const path = `/zendesk/oauth/callback?code=abc&state=${encodeURIComponent(state)}`;

    // First use: passes the one-time state check (the exchange then fails, but
    // the state id is now consumed in the shared table).
    const first = await request(app).get(path);
    expect(first.status).not.toBe(400); // not rejected as a used/invalid state

    // Replay the SAME state → rejected as invalid/used.
    const replay = await request(app).get(path);
    expect(replay.status).toBe(400);
    expect(replay.text).toContain("Invalid or expired");
  });
});
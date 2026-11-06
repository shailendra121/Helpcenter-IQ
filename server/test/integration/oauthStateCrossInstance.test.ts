import "dotenv/config";
import { describe, it, expect, afterAll } from "vitest";
import jwt from "jsonwebtoken";
import { pool } from "../../src/db/pool.js";
import { consumeOAuthState } from "../../src/db/models/oauthState.js";

/**
 * HCIQ-21 / AC-1: OAuth CSRF state must work when the authorize-start and the
 * callback are served by different server instances. The state is a signed JWT
 * (any instance can verify with the shared secret) and one-time use is enforced
 * in a shared DB table — so there is no per-instance memory to lose. This test
 * simulates "signed on instance A, verified + consumed on instance B".
 */
describe("OAuth state works across instances (real database)", () => {
  const secret = process.env.ZAF_SESSION_SECRET ?? "x".repeat(32);
  const jtis: string[] = [];

  afterAll(async () => {
    if (jtis.length) {
      await pool.query("DELETE FROM oauth_state_used WHERE jti = ANY($1)", [
        jtis,
      ]);
    }
  });

  it("a state signed on one instance is accepted and consumed on another", async () => {
    // Instance A signs the state.
    const jti = `cross-${Date.now()}`;
    jtis.push(jti);
    const state = jwt.sign({ subdomain: "acme", jti }, secret, {
      expiresIn: "10m",
    });

    // Instance B (no shared memory) verifies the signature...
    const payload = jwt.verify(state, secret) as { subdomain: string; jti: string };
    expect(payload.subdomain).toBe("acme");

    // ...and consumes the one-time state from the shared DB table.
    const firstUse = await consumeOAuthState(payload.jti);
    expect(firstUse).toBe(true);
  });

  it("the same state cannot be replayed on any instance (one-time use is shared)", async () => {
    const jti = `cross-replay-${Date.now()}`;
    jtis.push(jti);

    // First consume (instance A) succeeds.
    expect(await consumeOAuthState(jti)).toBe(true);
    // Replay on a different instance hits the same shared table → rejected.
    expect(await consumeOAuthState(jti)).toBe(false);
  });
});
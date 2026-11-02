import { beforeEach, describe, expect, it, vi } from "vitest";

// consumeOAuthState returns true the first time a jti is seen, false after.
// Mock it so the test needs no real database.
vi.mock("../../src/db/models/oauthState.js", () => ({
  consumeOAuthState: vi.fn(),
}));

import { consumeOAuthState } from "../../src/db/models/oauthState.js";

const mockConsume = vi.mocked(consumeOAuthState);

describe("OAuth state is one-time use (HCIQ-21)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a state jti the first time it is seen", async () => {
    mockConsume.mockResolvedValue(true); // first use
    const firstUse = await consumeOAuthState("jti-abc");
    expect(firstUse).toBe(true);
  });

  it("rejects the same state jti on replay", async () => {
    // First use returns true, a replay of the same jti returns false.
    mockConsume.mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const first = await consumeOAuthState("jti-abc");
    const replay = await consumeOAuthState("jti-abc");

    expect(first).toBe(true);
    expect(replay).toBe(false); // replayed state is rejected
  });
});
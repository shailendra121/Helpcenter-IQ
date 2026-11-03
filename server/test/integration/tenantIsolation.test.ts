import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

// Mock the DB lookup so the test needs no real database.
vi.mock("../../src/db/models/zendeskAccounts.js", () => ({
  getAccountZafSecret: vi.fn(),
}));
// Mock encryption so the stored "encrypted" value is just the raw secret.
vi.mock("../../src/auth/tokenEncryption.js", () => ({
  decryptToken: (s: string) => s,
}));

import { verifyZafBearer } from "../../src/auth/zafJwt.js";
import { getAccountZafSecret } from "../../src/db/models/zendeskAccounts.js";

const SECRET_A = "secret-of-account-a";
const SECRET_B = "secret-of-account-b";

function reqWith(token: string) {
  return { get: (h: string) => (h === "Authorization" ? `Bearer ${token}` : "") } as any;
}

describe("tenant isolation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("accepts a token signed with the account's own secret", async () => {
    (getAccountZafSecret as any).mockResolvedValue(SECRET_A);
    const token = jwt.sign({ subdomain: "account-a" }, SECRET_A, {
      algorithm: "HS256",
      expiresIn: 300,
    });

    const result = await verifyZafBearer(reqWith(token));
    expect(result.ok).toBe(true);
    expect(result.ok && result.claims.subdomain).toBe("account-a");
  });

  it("rejects a token from account A claiming to be account B", async () => {
    // Backend will look up account B's secret...
    (getAccountZafSecret as any).mockResolvedValue(SECRET_B);
    // ...but the attacker signed with account A's secret, claiming B.
    const forged = jwt.sign({ subdomain: "account-b" }, SECRET_A, {
      algorithm: "HS256",
      expiresIn: 300,
    });

    const result = await verifyZafBearer(reqWith(forged));
    expect(result.ok).toBe(false);
  });
});
import "dotenv/config";
import { encryptToken, decryptToken } from "../../src/auth/tokenEncryption.js";
import { describe, it, expect } from "vitest";


// Provide a deterministic test-only key if none is set (e.g. in CI),
// so this pure unit test — which never touches a real network or DB —
// doesn't depend on secrets being configured. Never use this value for
// anything beyond this test file.
process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ?? "0".repeat(64);


describe("tokenEncryption", () => {
  it("encrypts and decrypts a token back to the original value", () => {
    const original = "super-secret-zendesk-access-token-12345";
    const encrypted = encryptToken(original);

    expect(encrypted).not.toBe(original);
    expect(encrypted).not.toContain(original);

    const decrypted = decryptToken(encrypted);
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const original = "same-token-value";
    const encrypted1 = encryptToken(original);
    const encrypted2 = encryptToken(original);

    expect(encrypted1).not.toBe(encrypted2);
    expect(decryptToken(encrypted1)).toBe(original);
    expect(decryptToken(encrypted2)).toBe(original);
  });

  it("throws if the ciphertext is tampered with", () => {
    const encrypted = encryptToken("some-token");
    const tampered = encrypted.slice(0, -2) + "00"; // corrupt last byte

    expect(() => decryptToken(tampered)).toThrow();
  });
});
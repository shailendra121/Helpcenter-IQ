import { describe, it, expect } from "vitest";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { verifyZafJwt } from "../../src/zendesk/client/verifyZafJwt.js";

// Generate a throwaway RSA keypair for testing — never use real
// production keys in tests.
const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const INSTALLATION_ID = "12345";
const AUDIENCE = `https://${INSTALLATION_ID}/api/v2/apps/installations`;

function signToken(payload: object, key: string = privateKey) {
  return jwt.sign(payload, key, {
    algorithm: "RS256",
    audience: AUDIENCE,
    expiresIn: "5m",
  });
}

describe("verifyZafJwt", () => {
  it("accepts a validly signed token", () => {
    const token = signToken({ iss: "d3v-astonous.zendesk.com" });
    const claims = verifyZafJwt(token, publicKey, INSTALLATION_ID) as { iss: string };
    expect(claims.iss).toBe("d3v-astonous.zendesk.com");
  });

  it("rejects a token signed with the wrong key (tampered/forged)", () => {
    const { privateKey: wrongKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    const token = signToken({ iss: "d3v-astonous.zendesk.com" }, wrongKey);

    expect(() => verifyZafJwt(token, publicKey, INSTALLATION_ID)).toThrow();
  });

  it("rejects an unsigned token (alg=none)", () => {
    const unsignedToken = jwt.sign({ iss: "d3v-astonous.zendesk.com" }, "", {
      algorithm: "none",
      audience: AUDIENCE,
    });

    expect(() => verifyZafJwt(unsignedToken, publicKey, INSTALLATION_ID)).toThrow();
  });

  it("rejects a token with the wrong audience (different installation)", () => {
    const token = jwt.sign({ iss: "d3v-astonous.zendesk.com" }, privateKey, {
      algorithm: "RS256",
      audience: "https://99999/api/v2/apps/installations",
      expiresIn: "5m",
    });

    expect(() => verifyZafJwt(token, publicKey, INSTALLATION_ID)).toThrow();
  });

  it("rejects an expired token", () => {
    const token = jwt.sign({ iss: "d3v-astonous.zendesk.com" }, privateKey, {
      algorithm: "RS256",
      audience: AUDIENCE,
      expiresIn: "-1s", // already expired
    });

    expect(() => verifyZafJwt(token, publicKey, INSTALLATION_ID)).toThrow();
  });
});
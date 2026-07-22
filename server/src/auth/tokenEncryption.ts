import crypto from "crypto";

/**
 * Symmetric encryption for Zendesk OAuth tokens at rest, per ADR-0004.
 * Uses AES-256-GCM: authenticated encryption, so tampering with stored
 * ciphertext is detected on decrypt rather than silently producing
 * garbage. TOKEN_ENCRYPTION_KEY must be a 32-byte key, hex-encoded
 * (64 hex characters) in .env.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function getKey(): Buffer {
  const hexKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hexKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(hexKey, "hex");
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENCRYPTION_KEY must be a 32-byte key (64 hex characters); got ${key.length} bytes`
    );
  }
  return key;
}

/**
 * Returns a single string combining iv, authTag, and ciphertext
 * (colon-separated, each hex-encoded) so it can be stored as one
 * text column value.
 */
export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv.toString("hex"), authTag.toString("hex"), encrypted.toString("hex")].join(":");
}

export function decryptToken(ciphertext: string): string {
  const key = getKey();
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    throw new Error("Malformed encrypted token: expected iv:authTag:ciphertext");
  }
  const [ivHex, authTagHex, encryptedHex] = parts;

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(encryptedHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
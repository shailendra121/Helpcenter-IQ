import jwt from "jsonwebtoken";
import type { Request } from "express";
import { getAccountZafSecret } from "../db/models/zendeskAccounts.js";
import { decryptToken } from "./tokenEncryption.js";

export interface ZafBearerClaims {
  subdomain: string;
  exp: number;
}

export type ZafAuthResult =
  | { ok: true; claims: ZafBearerClaims }
  | { ok: false; reason: "invalid" }        // missing / bad / expired token
  | { ok: false; reason: "not_installed" }; // no account or secret yet

export async function verifyZafBearer(req: Request): Promise<ZafAuthResult> {
  const header = req.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return { ok: false, reason: "invalid" };

  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  const claimed = String(decoded?.subdomain ?? "").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(claimed)) return { ok: false, reason: "invalid" };

  // DB lookup is OUTSIDE try/catch: a database error propagates so callers
  // return 503 (an outage, not an auth failure).
  const enc = await getAccountZafSecret(claimed);
  if (!enc) return { ok: false, reason: "not_installed" }; // account not connected yet

  try {
    const claims = jwt.verify(token, decryptToken(enc), {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
    const subdomain = String(claims.subdomain ?? "").toLowerCase();
    if (subdomain !== claimed || !claims.exp) return { ok: false, reason: "invalid" };
    return { ok: true, claims: { subdomain, exp: claims.exp } };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
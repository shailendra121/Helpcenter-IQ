import jwt from "jsonwebtoken";
import type { Request } from "express";
import { getAccountZafSecret } from "../db/models/zendeskAccounts.js";
import { decryptToken } from "./tokenEncryption.js";

export interface ZafBearerClaims {
  subdomain: string;
  exp: number;
}

export async function verifyZafBearer(
  req: Request,
): Promise<ZafBearerClaims | null> {
  const header = req.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) return null;

  try {
    // 1. Read the claimed subdomain WITHOUT trusting it yet.
    const decoded = jwt.decode(token) as jwt.JwtPayload | null;
    const claimed = String(decoded?.subdomain ?? "").toLowerCase();
    if (!/^[a-z0-9-]+$/.test(claimed)) return null;

    // 2. Look up THAT account's own secret
    const enc = await getAccountZafSecret(claimed);
    if (!enc) return null;

    // 3. Verify the token against the account's own secret
    const claims = jwt.verify(token, decryptToken(enc), {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;

    const subdomain = String(claims.subdomain ?? "").toLowerCase();
    if (subdomain !== claimed || !claims.exp) return null;

    return { subdomain, exp: claims.exp };
  } catch {
    return null;
  }
}
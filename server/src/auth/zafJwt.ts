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

  // Read the claimed subdomain WITHOUT trusting it yet.
  const decoded = jwt.decode(token) as jwt.JwtPayload | null;
  const claimed = String(decoded?.subdomain ?? "").toLowerCase();
  if (!/^[a-z0-9-]+$/.test(claimed)) return null;

  // DB lookup is OUTSIDE the try/catch: if the database is down, the error
  // propagates so the caller can return 503 (an outage, not an auth failure).
  const enc = await getAccountZafSecret(claimed);
  if (!enc) return null;

  // Only token verification itself fails "closed" as a 401.
  try {
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
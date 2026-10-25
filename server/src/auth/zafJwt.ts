import jwt from "jsonwebtoken";
import type { Request } from "express";

export interface ZafBearerClaims {
  subdomain: string;
  exp: number;
}

/**
 * Verifies the ZAF-signed HS256 JWT sent by the packaged Zendesk app
 * (Authorization: Bearer ...). Returns null if missing/invalid.
 * Does not touch the database.
 */
export function verifyZafBearer(req: Request): ZafBearerClaims | null {
  const header = req.get("Authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const secret = process.env.ZAF_JWT_SECRET;

  if (!token || !secret) return null;

  try {
    const claims = jwt.verify(token, secret, {
        algorithms: ["HS256"],
    }) as jwt.JwtPayload;

    const subdomain = String(claims.subdomain ?? "").toLowerCase();
    if (!/^[a-z0-9-]+$/.test(subdomain) || !claims.exp) return null;

    return { subdomain, exp: claims.exp };
  } catch {
    return null;
  }
}
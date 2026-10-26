import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { verifyZafBearer } from "./zafJwt.js";
import { findZendeskAccountBySubdomain } from "../db/models/zendeskAccounts.js";


const COOKIE_NAME = "hciq_zaf_session";
const SESSION_TTL_SECONDS = 60 * 60 * 8; // 8 hours

export interface ZafSession {
  zendeskAccountId: number;
  subdomain: string;
  exp: number;
}

function getSecret(): string {
  const secret = process.env.ZAF_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "ZAF_SESSION_SECRET must be set to at least 32 characters",
    );
  }

  return secret;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return crypto
    .createHmac("sha256", getSecret())
    .update(payload)
    .digest("base64url");
}

export function createZafSessionToken(
  zendeskAccountId: number,
  subdomain: string,
): string {
  const session: ZafSession = {
    zendeskAccountId,
    subdomain,
    exp:
      Math.floor(Date.now() / 1000) +
      SESSION_TTL_SECONDS,
  };

  const payload = encode(JSON.stringify(session));

  return `${payload}.${sign(payload)}`;
}

export function verifyZafSessionToken(
  token: string,
): ZafSession | null {
  const [payload, signature] = token.split(".");

  if (!payload || !signature) {
    return null;
  }

  const expected = sign(payload);

  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  if (
    actualBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(
      actualBuffer,
      expectedBuffer,
    )
  ) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      decode(payload),
    ) as Partial<ZafSession>;

    if (
      !Number.isInteger(parsed.zendeskAccountId) ||
      typeof parsed.subdomain !== "string" ||
      !parsed.subdomain ||
      typeof parsed.exp !== "number" ||
      parsed.exp <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }

    return parsed as ZafSession;
  } catch {
    return null;
  }
}

export function setZafSessionCookie(
  res: Response,
  zendeskAccountId: number,
  subdomain: string,
): void {
  const token = createZafSessionToken(
    zendeskAccountId,
    subdomain,
  );

  /*
   * HelpCenterIQ runs inside a Zendesk iframe.
   *
   * The dashboard is therefore cross-site relative to the Zendesk
   * parent page. SameSite=None is required so the browser can send
   * this session cookie with dashboard API requests made from the
   * embedded application.
   *
   * Modern browsers require Secure whenever SameSite=None is used.
   */
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${SESSION_TTL_SECONDS}`,
  );
}

function readCookie(
  req: Request,
  name: string,
): string | null {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const [key, ...valueParts] = part
      .trim()
      .split("=");

    if (key === name) {
      return valueParts.join("=") || null;
    }
  }

  return null;
}

export interface AuthenticatedZafRequest
  extends Request {
  zafSession: ZafSession;
}

function requireZafCookieSession(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const token = readCookie(req, COOKIE_NAME);

    const session = token
      ? verifyZafSessionToken(token)
      : null;

    if (!session) {
      res.status(401).json({
        error: "ZAF-authenticated session required",
      });
      return;
    }

    (
      req as AuthenticatedZafRequest
    ).zafSession = session;

    next();
  } catch (error) {
    console.error(
      "[zaf-session] Failed to verify session:",
      error,
    );

    res.status(401).json({
      error: "Invalid ZAF session",
    });
  }
}
 /**
 * Production path: Bearer ZAF JWT from the packaged Zendesk app.
 * The cookie path above is kept only as a local-dev / test fallback.
 */
export async function requireZafSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const authHeader = req.get("Authorization") ?? "";

  if (!authHeader.startsWith("Bearer ")) {
    requireZafCookieSession(req, res, next);
    return;
  }

  const claims = verifyZafBearer(req);

  if (!claims) {
    res.status(401).json({ error: "Invalid ZAF JWT" });
    return;
  }

  try {
    const account = await findZendeskAccountBySubdomain(claims.subdomain);

    if (!account) {
      res
        .status(404)
        .json({ error: "not_installed", subdomain: claims.subdomain });
      return;
    }

    (req as AuthenticatedZafRequest).zafSession = {
      zendeskAccountId: account.id,
      subdomain: account.subdomain,
      exp: claims.exp,
    };

    next();
  } catch (error) {
    console.error("[zaf-session] account lookup failed:", error);
    res.status(503).json({ error: "database_unavailable" });
  }
}
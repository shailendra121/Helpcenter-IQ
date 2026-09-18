import type {
  NextFunction,
  Request,
  Response,
} from "express";
import type {
  AuthenticatedZafRequest,
} from "./zafSession.js";

/**
 * CSRF protection for cookie-authenticated ZAF API requests.
 *
 * The ZAF session cookie uses SameSite=None because the dashboard
 * runs in an embedded context. State-changing requests therefore
 * require an Origin that exactly matches the configured HelpCenterIQ
 * application origin.
 */
export function requireTrustedOrigin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (
    req.method === "GET" ||
    req.method === "HEAD" ||
    req.method === "OPTIONS"
  ) {
    next();
    return;
  }

  const authenticatedRequest =
    req as AuthenticatedZafRequest;

  if (!authenticatedRequest.zafSession) {
    res.status(401).json({
      error: "ZAF-authenticated session required",
    });
    return;
  }

  const configuredOrigin =
    process.env.APP_ORIGIN;

  if (!configuredOrigin) {
    console.error(
      "[csrf] APP_ORIGIN is not configured",
    );

    res.status(500).json({
      error: "Application origin is not configured",
    });
    return;
  }

  let expectedOrigin: string;

  try {
    expectedOrigin =
      new URL(configuredOrigin).origin;
  } catch {
    console.error(
      "[csrf] APP_ORIGIN is invalid",
    );

    res.status(500).json({
      error: "Application origin is invalid",
    });
    return;
  }

  const originHeader = req.get("Origin");

  if (!originHeader) {
    res.status(403).json({
      error: "Trusted request origin required",
    });
    return;
  }

  let requestOrigin: string;

  try {
    requestOrigin =
      new URL(originHeader).origin;
  } catch {
    res.status(403).json({
      error: "Invalid request origin",
    });
    return;
  }

  if (requestOrigin !== expectedOrigin) {
    res.status(403).json({
      error: "Untrusted request origin",
    });
    return;
  }

  next();
}
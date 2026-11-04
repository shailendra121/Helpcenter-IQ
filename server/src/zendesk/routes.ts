import { Router } from "express";
import jwt from "jsonwebtoken";
import { getOAuthClient } from "../auth/getOAuthClient.js";
import { encryptToken } from "../auth/tokenEncryption.js";
import { upsertZendeskAccount } from "../db/models/zendeskAccounts.js";
import crypto from "crypto";
import { setAccountZafSecret } from "../db/models/zendeskAccounts.js";
import { setAppJwtSecret } from "./setAppJwtSecret.js";
import { consumeOAuthState } from "../db/models/oauthState.js";

const router = Router();

function stateSecret(): string {
  const secret = process.env.ZAF_SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error("ZAF_SESSION_SECRET must be at least 32 characters");
  }

  return secret;
}

// Must exactly match the redirect URL registered in the Zendesk OAuth
// client (ADR-0004). Taken from APP_ORIGIN so it is correct behind the
// Cloud Run proxy.
function getRedirectUri(): string {
  const origin = process.env.APP_ORIGIN;

  if (!origin) {
    throw new Error("APP_ORIGIN is not set");
  }

  return `${new URL(origin).origin}/zendesk/oauth/callback`;
}

/**
 * Step 1 of the OAuth handshake: redirect the installer to Zendesk's
 * authorize screen. Opened in a new tab by the packaged Zendesk app.
 */
router.get("/zendesk/oauth/start", (req, res) => {
  const subdomain = req.query.subdomain;

  if (typeof subdomain !== "string" || !/^[a-z0-9-]+$/i.test(subdomain)) {
    return res
      .status(400)
      .json({ error: "Missing or invalid subdomain query parameter" });
  }

  const normalized = subdomain.toLowerCase();

  // Signed, self-contained state: works across Cloud Run instances and
  // scale-to-zero (an in-memory Map would not).
  const state = jwt.sign(
    { subdomain: normalized, jti: crypto.randomUUID() },
    stateSecret(),
    { expiresIn: "10m" },
  );

  const authorizeUrl = getOAuthClient().buildAuthorizeUrl(
    normalized,
    getRedirectUri(),
    state,
  );

  return res.redirect(authorizeUrl);
});

/**
 * Step 2: Zendesk redirects back here with an authorization code.
 * Exchanges it for tokens and stores them encrypted.
 */
router.get("/zendesk/oauth/callback", async (req, res) => {
  const { code, state } = req.query;

  if (typeof code !== "string" || typeof state !== "string") {
    return res.status(400).send("Missing code or state parameter.");
  }

  let subdomain: string;

  try {
    const payload = jwt.verify(state, stateSecret(), {
      algorithms: ["HS256"],
    }) as { subdomain?: string; jti?: string };

    if (!payload.subdomain || !payload.jti) {
      throw new Error("missing subdomain or jti");
    }

    // One-time use: reject a replayed state (HCIQ-21).
    const firstUse = await consumeOAuthState(payload.jti);
    if (!firstUse) {
      throw new Error("state already used");
    }

    subdomain = payload.subdomain;
  } catch {
    return res
      .status(400)
      .send(
        "Invalid or expired authorization request. Please try installing again.",
      );
  }

  try {
    const tokens = await getOAuthClient().exchangeCodeForToken(
      subdomain,
      code,
      getRedirectUri(),
    );

    await upsertZendeskAccount({
      subdomain,
      accessTokenEncrypted: encryptToken(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken
        ? encryptToken(tokens.refreshToken)
        : null,
      scope: tokens.scope,
      expiresAt: tokens.expiresAt,
    });

    // Per-account ZAF signing secret (ADR-0007: tenant isolation).
    // Generate, store encrypted, and push into the app's jwt_secret setting
    // so no one has to paste a shared secret by hand.
    const zafSecret = crypto.randomBytes(32).toString("hex");
    await setAccountZafSecret(subdomain, encryptToken(zafSecret));

    try {
      await setAppJwtSecret(subdomain, tokens.accessToken, zafSecret);
    } catch (err) {
      console.error(
        "Could not set jwt_secret app setting for:",
        subdomain,
        err instanceof Error ? err.message : err,
      );

      // The account is connected, but the app can't authenticate until its
      // jwt_secret is set. Don't show success — tell the user to retry.
      return res
        .status(502)
        .send(
          `<html><body style="font-family:sans-serif;padding:24px">
            <h3>Almost there — setup didn't finish.</h3>
            <p>We connected your Zendesk account but couldn't finish configuring
            the app. Please try connecting again. If this keeps happening,
            contact support@helpcenteriq.com.</p>
          </body></html>`,
        );
    }

    return res.send(
      `<html><body style="font-family:sans-serif;padding:24px">
        <h3>HelpCenterIQ is connected.</h3>
        <p>You can close this tab and reload HelpCenterIQ in Zendesk.</p>
      </body></html>`,
    );
  } catch {
    // Never log/return the raw error, which could contain token data
    // from a failed exchange response.
    console.error("OAuth token exchange failed for subdomain:", subdomain);

    return res
      .status(502)
      .send("Failed to complete Zendesk authorization. Please try again.");
  }
});

export default router;
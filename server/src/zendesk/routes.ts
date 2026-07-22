import { verifyZafJwt } from "./client/verifyZafJwt.js";
import { findZendeskAccountBySubdomain } from "../db/models/zendeskAccounts.js";
import fs from "fs";
import { Router } from "express";
import crypto from "crypto";
import { ZendeskOAuthClient } from "../auth/ZendeskOAuthClient.js";
import { encryptToken } from "../auth/tokenEncryption.js";
import { upsertZendeskAccount } from "../db/models/zendeskAccounts.js";

const router = Router();

// In-memory state store for CSRF protection during the OAuth handshake.
// A real multi-instance deployment would use Redis/DB instead — fine for
// MVP single-instance dev/trial use.
const pendingStates = new Map<string, { subdomain: string; createdAt: number }>();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getOAuthClient(): ZendeskOAuthClient {
  const clientId = process.env.ZENDESK_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ZENDESK_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ZENDESK_OAUTH_CLIENT_ID / ZENDESK_OAUTH_CLIENT_SECRET are not set");
  }
  return new ZendeskOAuthClient(clientId, clientSecret);
}

function getRedirectUri(req: import("express").Request): string {
  // Must exactly match the redirect_uri registered with the Zendesk
  // OAuth client, per ADR-0004 / Zendesk's OAuth error handling.
  return `${req.protocol}://${req.get("host")}/zendesk/oauth/callback`;
}

/**
 * Step 1 of the OAuth handshake: redirect the installer to Zendesk's
 * authorize screen. Triggered from the ZAF iframe's bootstrap.js redirect
 * (see zendesk-app/assets/js/bootstrap.js and HCIQ-3), or directly by an
 * admin during install.
 */
router.get("/zendesk/oauth/start", (req, res) => {
  const subdomain = req.query.subdomain;
  if (typeof subdomain !== "string" || !subdomain) {
    return res.status(400).json({ error: "Missing subdomain query parameter" });
  }

  const state = crypto.randomBytes(24).toString("hex");
  pendingStates.set(state, { subdomain, createdAt: Date.now() });

  const client = getOAuthClient();
  const authorizeUrl = client.buildAuthorizeUrl(subdomain, getRedirectUri(req), state);
  res.redirect(authorizeUrl);
});

/**
 * Step 2: Zendesk redirects back here with an authorization code.
 * Exchanges it for tokens, stores them encrypted, and forwards the
 * installer into the dashboard.
 */
router.get("/zendesk/oauth/callback", async (req, res) => {
  const { code, state } = req.query;

  if (typeof code !== "string" || typeof state !== "string") {
    return res.status(400).send("Missing code or state parameter.");
  }

  const pending = pendingStates.get(state);
  if (!pending) {
    // Unknown/expired/replayed state — reject rather than trust an
    // unverified subdomain from the query string.
    return res.status(400).send("Invalid or expired authorization request. Please try installing again.");
  }
  pendingStates.delete(state); // one-time use

  if (Date.now() - pending.createdAt > STATE_TTL_MS) {
    return res.status(400).send("Authorization request expired. Please try installing again.");
  }

  try {
    const client = getOAuthClient();
    const tokens = await client.exchangeCodeForToken(pending.subdomain, code, getRedirectUri(req));

    await upsertZendeskAccount({
      subdomain: pending.subdomain,
      accessTokenEncrypted: encryptToken(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken ? encryptToken(tokens.refreshToken) : null,
      scope: tokens.scope,
      expiresAt: tokens.expiresAt,
    });

res.redirect(`/zaf/dashboard?origin=${encodeURIComponent(pending.subdomain)}`);  } catch (err) {
    // Never log/return the raw error, which could contain token data
    // from a failed exchange response.
    console.error("OAuth token exchange failed for subdomain:", pending.subdomain);
    res.status(502).send("Failed to complete Zendesk authorization. Please try again.");
  }
});
/**
 * Serves the dashboard shell inside the ZAF iframe. Two request shapes
 * are supported, per the architecture established in HCIQ-3:
 *
 * 1. POST with a `token` field (signedUrls:true's real JWT flow) — only
 *    triggers once the app is hosted at a real public URL (post-HCIQ-18
 *    Marketplace publish); verified via verifyZafJwt().
 * 2. GET with `origin`/`app_guid` query params — the local zcli
 *    apps:server dev/trial flow from bootstrap.js (see HCIQ-3). This
 *    path is NOT cryptographically verified (zcli's local override
 *    doesn't sign requests), so it only ever serves the unauthenticated
 *    "please install" state, never account data. Flagged on HCIQ-7 for
 *    review — full JWT enforcement on this path isn't possible until
 *    the app is Marketplace-published.
 */
router.post("/zaf/dashboard", async (req, res) => {
  const token = req.body?.token;
  if (typeof token !== "string" || !token) {
    return res.status(401).send("Missing ZAF signature.");
  }

  const publicKeyPath = process.env.ZAF_APP_PUBLIC_KEY_PATH;
  if (!publicKeyPath) {
    console.error("ZAF_APP_PUBLIC_KEY_PATH is not set");
    return res.status(500).send("Server misconfiguration.");
  }

  let claims: { iss?: string; aud?: string };
  try {
    const publicKeyPem = fs.readFileSync(publicKeyPath, "utf8");
    const installationId = process.env.ZENDESK_MARKETPLACE_APP_ID ?? "";
    claims = verifyZafJwt(token, publicKeyPem, installationId) as typeof claims;
  } catch (err) {
    console.error("ZAF JWT verification failed");
    return res.status(401).send("Invalid signature.");
  }

  const subdomain = claims.iss?.replace(/\.zendesk\.com$/, "");
  if (!subdomain) {
    return res.status(401).send("Invalid token claims.");
  }

  await serveDashboardFor(subdomain, res);
});

router.get("/zaf/dashboard", async (req, res) => {
  const { origin } = req.query;
  if (typeof origin !== "string" || !origin) {
    return res.status(400).send("Missing origin parameter.");
  }
  const subdomain = origin.replace(/^https?:\/\//, "").replace(/\.zendesk\.com$/, "");
  await serveDashboardFor(subdomain, res);
});

async function serveDashboardFor(subdomain: string, res: import("express").Response) {
  const account = await findZendeskAccountBySubdomain(subdomain);

  if (!account) {
    return res.send(
      `<html><body><p>HelpCenterIQ isn't installed for this account yet.</p>
       <a href="/zendesk/oauth/start?subdomain=${encodeURIComponent(subdomain)}">Install now</a>
       </body></html>`
    );
  }

  res.send(`<html><body><h1>HelpCenterIQ</h1><p>Installed for ${subdomain}. Dashboard coming soon.</p></body></html>`);
}

export default router;

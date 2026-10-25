import { Router } from "express";
import jwt from "jsonwebtoken";
import { getOAuthClient } from "../auth/getOAuthClient.js";
import { encryptToken } from "../auth/tokenEncryption.js";
import { upsertZendeskAccount } from "../db/models/zendeskAccounts.js";

const router = Router();

function stateSecret(): string {
  const secret = process.env.ZAF_SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ZAF_SESSION_SECRET must be at least 32 characters");
  }
  return secret;
}
// Must exactly match the redirect URL registered in the Zendesk OAuth client.
function getRedirectUri(): string {
  const origin = process.env.APP_ORIGIN;
  if (!origin) throw new Error("APP_ORIGIN is not set");
  return `${new URL(origin).origin}/zendesk/oauth/callback`;
}

/** Step 1: send the installer to Zendesk's authorize screen. */
router.get("/zendesk/oauth/start", (req, res) => {
  const subdomain = req.query.subdomain;

  if (typeof subdomain !== "string" || !/^[a-z0-9-]+$/i.test(subdomain)) {
    return res
      .status(400)
      .json({ error: "Missing or invalid subdomain query parameter" });
  }

  const normalized = subdomain.toLowerCase();

  // Signed, self-contained state: works across Cloud Run instances.
  const state = jwt.sign({ subdomain: normalized }, stateSecret(), {
    expiresIn: "10m",
  });
  const authorizeUrl = getOAuthClient().buildAuthorizeUrl(
    normalized,
    getRedirectUri(),
    state,
  );

  return res.redirect(authorizeUrl);
});

/** Step 2: exchange the code for tokens, store them encrypted. */
router.get("/zendesk/oauth/callback", async (req, res) => {
  const { code, state } = req.query;

  if (typeof code !== "string" || typeof state !== "string") {
    return res.status(400).send("Missing code or state parameter.");
  }
let subdomain: string;
  try {
    const payload = jwt.verify(state, stateSecret(), {
      algorithms: ["HS256"],
    }) as { subdomain?: string };
    if (!payload.subdomain) throw new Error("missing subdomain");
    subdomain = payload.subdomain;
  } catch {
    return res
      .status(400)
      .send("Invalid or expired authorization request. Please try installing again.");
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

    return res.send(
      `<html><body style="font-family:sans-serif;padding:24px">
        <h3>HelpCenterIQ is connected.</h3>
        <p>You can close this tab and reload HelpCenterIQ in Zendesk.</p>
      </body></html>`,
    );
  } catch {
    // Never log the raw error: it may contain token data.
    console.error("OAuth token exchange failed for subdomain:", subdomain);
    return res
      .status(502)
      .send("Failed to complete Zendesk authorization. Please try again.");
  }
  });

export default router;
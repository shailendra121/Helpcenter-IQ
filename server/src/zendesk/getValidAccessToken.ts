import { ZendeskOAuthClient } from "../auth/ZendeskOAuthClient.js";
import { encryptToken, decryptToken } from "../auth/tokenEncryption.js";
import {
  findZendeskAccountBySubdomain,
  updateZendeskAccountTokens,
} from "../db/models/zendeskAccounts.js";

export class ReAuthRequiredError extends Error {
  constructor(public readonly subdomain: string) {
    super(`Re-authorization required for ${subdomain}`);
    this.name = "ReAuthRequiredError";
  }
}

/**
 * Returns a valid (non-expired) decrypted access token for the given
 * subdomain, transparently refreshing it if expired. Throws
 * ReAuthRequiredError if there is no account, no refresh token, or the
 * refresh itself fails (e.g. the grant was revoked in Zendesk) — callers
 * should catch this and redirect to /zendesk/oauth/start rather than
 * surface a generic 500.
 */
export async function getValidAccessToken(subdomain: string): Promise<string> {
  const account = await findZendeskAccountBySubdomain(subdomain);
  if (!account) {
    throw new ReAuthRequiredError(subdomain);
  }

  const isExpired =
    !account.oauth_expires_at || new Date(account.oauth_expires_at).getTime() <= Date.now();

  if (!isExpired) {
    return decryptToken(account.oauth_access_token_encrypted);
  }

  if (!account.oauth_refresh_token_encrypted) {
    throw new ReAuthRequiredError(subdomain);
  }

  const clientId = process.env.ZENDESK_OAUTH_CLIENT_ID;
  const clientSecret = process.env.ZENDESK_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("ZENDESK_OAUTH_CLIENT_ID / ZENDESK_OAUTH_CLIENT_SECRET are not set");
  }

  try {
    const client = new ZendeskOAuthClient(clientId, clientSecret);
    const refreshToken = decryptToken(account.oauth_refresh_token_encrypted);
    const tokens = await client.refreshAccessToken(subdomain, refreshToken);

    await updateZendeskAccountTokens(subdomain, {
      accessTokenEncrypted: encryptToken(tokens.accessToken),
      refreshTokenEncrypted: tokens.refreshToken
        ? encryptToken(tokens.refreshToken)
        : account.oauth_refresh_token_encrypted,
      expiresAt: tokens.expiresAt,
    });

    return tokens.accessToken;
  } catch {
    // Refresh failed — most likely the grant was revoked in Zendesk.
    // Never log the raw error (may contain token fragments).
    console.error("Token refresh failed for subdomain:", subdomain);
    throw new ReAuthRequiredError(subdomain);
  }
}
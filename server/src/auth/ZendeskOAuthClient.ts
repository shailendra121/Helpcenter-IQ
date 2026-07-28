/**
 * Global OAuth client for Zendesk API access. See ADR-0004 — customer
 * API tokens / regular OAuth tokens must never be requested or stored;
 * this is the only sanctioned path for obtaining Zendesk API credentials.
 */

export interface ZendeskOAuthTokens {
  accessToken: string;
  refreshToken?: string;
  scope: string;
  expiresAt: Date;
}

interface ZendeskTokenResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  scope: string;
  expires_in?: number; // seconds; absent on older clients without expiry configured
}

export class ZendeskOAuthClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  buildAuthorizeUrl(subdomain: string, redirectUri: string, state: string): string {
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: redirectUri,
      scope: "read write",
      state,
    });
    return `https://${subdomain}.zendesk.com/oauth/authorizations/new?${params.toString()}`;
  }

  async exchangeCodeForToken(
    subdomain: string,
    code: string,
    redirectUri: string,
  ): Promise<ZendeskOAuthTokens> {
    return this.requestToken(subdomain, {
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    });
  }

  async refreshAccessToken(
    subdomain: string,
    refreshToken: string,
  ): Promise<ZendeskOAuthTokens> {
    return this.requestToken(subdomain, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  }

  private async requestToken(
    subdomain: string,
    grantParams: Record<string, string>,
  ): Promise<ZendeskOAuthTokens> {
    const response = await fetch(`https://${subdomain}.zendesk.com/oauth/tokens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        ...grantParams,
      }),
    });

    if (!response.ok) {
      // Never include response body in the thrown error — it may echo
      // back request params, and we don't want secrets in logs/errors.
      throw new Error(
        `Zendesk OAuth token request failed: ${response.status} ${response.statusText}`
      );
    }

    const data = (await response.json()) as ZendeskTokenResponse;

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : // Older clients without expiry configured — treat as long-lived;
        // refresh-on-401 handling covers actual expiry regardless.
        new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      scope: data.scope,
      expiresAt,
    };
  }
}
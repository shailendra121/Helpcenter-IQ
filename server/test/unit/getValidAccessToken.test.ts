import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindAccount = vi.fn();
const mockUpdateTokens = vi.fn();

vi.mock("../../src/db/models/zendeskAccounts.js", () => ({
  findZendeskAccountBySubdomain: mockFindAccount,
  updateZendeskAccountTokens: mockUpdateTokens,
}));

const mockRefreshAccessToken = vi.fn();
vi.mock("../../src/auth/ZendeskOAuthClient.js", () => ({
  ZendeskOAuthClient: vi.fn().mockImplementation(() => ({
    refreshAccessToken: mockRefreshAccessToken,
  })),
}));

process.env.ZENDESK_OAUTH_CLIENT_ID = "fake-client-id";
process.env.ZENDESK_OAUTH_CLIENT_SECRET = "fake-client-secret";
process.env.TOKEN_ENCRYPTION_KEY =
  process.env.TOKEN_ENCRYPTION_KEY ?? "0".repeat(64); // valid 32-byte hex for tests

const { getValidAccessToken, ReAuthRequiredError } = await import(
  "../../src/zendesk/getValidAccessToken.js"
);
const { encryptToken } = await import("../../src/auth/tokenEncryption.js");

describe("getValidAccessToken", () => {
  beforeEach(() => {
    mockFindAccount.mockReset();
    mockUpdateTokens.mockReset();
    mockRefreshAccessToken.mockReset();
  });

  it("returns the existing token when it is not expired", async () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    mockFindAccount.mockResolvedValue({
      subdomain: "d3v-astonous",
      oauth_access_token_encrypted: encryptToken("valid-access-token"),
      oauth_refresh_token_encrypted: encryptToken("some-refresh-token"),
      oauth_expires_at: futureDate,
    });

    const token = await getValidAccessToken("d3v-astonous");

    expect(token).toBe("valid-access-token");
    expect(mockRefreshAccessToken).not.toHaveBeenCalled();
  });

  it("transparently refreshes an expired token", async () => {
    const pastDate = new Date(Date.now() - 60 * 1000);
    mockFindAccount.mockResolvedValue({
      subdomain: "d3v-astonous",
      oauth_access_token_encrypted: encryptToken("expired-token"),
      oauth_refresh_token_encrypted: encryptToken("valid-refresh-token"),
      oauth_expires_at: pastDate,
    });
    mockRefreshAccessToken.mockResolvedValue({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token",
      scope: "read write",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });

    const token = await getValidAccessToken("d3v-astonous");

    expect(token).toBe("new-access-token");
    expect(mockUpdateTokens).toHaveBeenCalledOnce();
  });

  it("throws ReAuthRequiredError when refresh fails (revoked grant)", async () => {
    const pastDate = new Date(Date.now() - 60 * 1000);
    mockFindAccount.mockResolvedValue({
      subdomain: "d3v-astonous",
      oauth_access_token_encrypted: encryptToken("expired-token"),
      oauth_refresh_token_encrypted: encryptToken("revoked-refresh-token"),
      oauth_expires_at: pastDate,
    });
    mockRefreshAccessToken.mockRejectedValue(new Error("invalid_grant"));

    await expect(getValidAccessToken("d3v-astonous")).rejects.toThrow(ReAuthRequiredError);
  });

  it("throws ReAuthRequiredError when no account exists", async () => {
    mockFindAccount.mockResolvedValue(null);

    await expect(getValidAccessToken("unknown-subdomain")).rejects.toThrow(ReAuthRequiredError);
  });
});
import { pool } from "../pool.js";

export interface ZendeskAccountRow {
  id: number;
  subdomain: string;
  oauth_access_token_encrypted: string;
  oauth_refresh_token_encrypted: string | null;
  oauth_scope: string | null;
  oauth_expires_at: Date | null;
  installed_at: Date;
}

export interface UpsertZendeskAccountInput {
  subdomain: string;
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  scope: string;
  expiresAt: Date;
}

/**
 * Insert a new zendesk_accounts row, or update the existing row for this
 * subdomain (fresh install / re-install / re-auth all upsert). Never
 * logs or returns tokens in plaintext — callers pass already-encrypted
 * values (see server/src/auth/tokenEncryption.ts).
 */
export async function upsertZendeskAccount(
  input: UpsertZendeskAccountInput
): Promise<ZendeskAccountRow> {
  const result = await pool.query<ZendeskAccountRow>(
    `INSERT INTO zendesk_accounts
       (subdomain, oauth_access_token_encrypted, oauth_refresh_token_encrypted, oauth_scope, oauth_expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subdomain) DO UPDATE SET
       oauth_access_token_encrypted = EXCLUDED.oauth_access_token_encrypted,
       oauth_refresh_token_encrypted = EXCLUDED.oauth_refresh_token_encrypted,
       oauth_scope = EXCLUDED.oauth_scope,
       oauth_expires_at = EXCLUDED.oauth_expires_at
     RETURNING *`,
    [input.subdomain, input.accessTokenEncrypted, input.refreshTokenEncrypted, input.scope, input.expiresAt]
  );
  return result.rows[0];
}

export async function findZendeskAccountBySubdomain(
  subdomain: string
): Promise<ZendeskAccountRow | null> {
  const result = await pool.query<ZendeskAccountRow>(
    `SELECT * FROM zendesk_accounts WHERE subdomain = $1`,
    [subdomain]
  );
  return result.rows[0] ?? null;
}
export interface UpdateZendeskAccountTokensInput {
  accessTokenEncrypted: string;
  refreshTokenEncrypted: string | null;
  expiresAt: Date;
}

export async function updateZendeskAccountTokens(
  subdomain: string,
  input: UpdateZendeskAccountTokensInput
): Promise<void> {
  await pool.query(
    `UPDATE zendesk_accounts
     SET oauth_access_token_encrypted = $1,
         oauth_refresh_token_encrypted = $2,
         oauth_expires_at = $3
     WHERE subdomain = $4`,
    [input.accessTokenEncrypted, input.refreshTokenEncrypted, input.expiresAt, subdomain]
  );
}

/**
 * Writes the per-account ZAF secret into this account's HelpCenterIQ app
 * installation (the `jwt_secret` secure setting), using the account's
 * OAuth access token. Admin-level token required (installs are admin-only).
 *
 * Note: ZAF caches secure settings, so the setting takes effect only after
 * the user reloads the app — which the OAuth success page already asks for.
 */

const APP_NAME = "HelpCenterIQ"; // must match the app's manifest name

async function zendeskGet(subdomain: string, accessToken: string, path: string) {
  const res = await fetch(`https://${subdomain}.zendesk.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Zendesk GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

/**
 * Finds the HelpCenterIQ installation id for this account, then sets its
 * jwt_secret. Throws on any failure (caller decides how to handle).
 */
export async function setAppJwtSecret(
  subdomain: string,
  accessToken: string,
  jwtSecret: string,
): Promise<void> {
  // 1. find our app's installation id
  const data = (await zendeskGet(
    subdomain,
    accessToken,
    "/api/v2/apps/installations.json",
  )) as { installations: Array<{ id: number; settings?: { name?: string } }> };

  const install = data.installations.find(
    (i) => i.settings?.name === APP_NAME,
  );
  if (!install) {
    throw new Error(`No "${APP_NAME}" app installation found for ${subdomain}`);
  }

  // 2. update its jwt_secret setting
  const res = await fetch(
    `https://${subdomain}.zendesk.com/api/v2/apps/installations/${install.id}.json`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ settings: { jwt_secret: jwtSecret } }),
    },
  );

  if (!res.ok) {
    throw new Error(`Zendesk PUT installation failed: ${res.status}`);
  }
}
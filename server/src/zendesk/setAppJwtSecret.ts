/**
 * Writes the per-account ZAF secret into this account's HelpCenterIQ app
 * installation (the `jwt_secret` secure setting), using the account's OAuth
 * access token. Admin-level token required (installs are admin-only).
 *
 * Matches the installation by app_id (stable, Zendesk-managed) rather than by
 * the editable install "Title", so it doesn't break if an admin renames it.
 *
 * Note: ZAF caches secure settings, so the setting takes effect only after the
 * user reloads the app — which the OAuth success page already asks for.
 */

const APP_NAME = "HelpCenterIQ"; // must match the app's manifest "name"

async function zendeskGet(subdomain: string, accessToken: string, path: string) {
  const res = await fetch(`https://${subdomain}.zendesk.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Zendesk GET ${path} failed: ${res.status}`);
  }
  return res.json();
}

export async function setAppJwtSecret(
  subdomain: string,
  accessToken: string,
  jwtSecret: string,
): Promise<void> {
  // 1. Find OUR app's id by its manifest name (not the editable install Title).
  const apps = (await zendeskGet(
    subdomain,
    accessToken,
    "/api/v2/apps.json",
  )) as { apps: Array<{ id: number; name: string }> };

  const app = apps.apps.find((a) => a.name === APP_NAME);
  if (!app) {
    throw new Error(`App "${APP_NAME}" not found for ${subdomain}`);
  }

  // 2. Find THIS app's installation by app_id (admins can't change app_id).
  const data = (await zendeskGet(
    subdomain,
    accessToken,
    "/api/v2/apps/installations.json",
  )) as { installations: Array<{ id: number; app_id: number }> };

  const install = data.installations.find((i) => i.app_id === app.id);
  if (!install) {
    throw new Error(`No installation of "${APP_NAME}" found for ${subdomain}`);
  }

  // 3. Set its jwt_secret.
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
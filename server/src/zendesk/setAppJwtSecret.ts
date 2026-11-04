/**
 * Writes the per-account ZAF secret into this account's HelpCenterIQ app
 * installation (the `jwt_secret` secure setting), using the account's OAuth
 * access token. Matches the installation directly by its settings.name,
 * because a zcli/dev install does not reliably appear in /api/v2/apps.json.
 */

const APP_NAME = "HelpCenterIQ"; // matches settings.name on the installation

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
  const data = (await zendeskGet(
    subdomain,
    accessToken,
    "/api/v2/apps/installations.json",
  )) as {
    installations: Array<{ id: number; settings?: { name?: string } }>;
  };

  const install = data.installations.find(
    (i) => i.settings?.name === APP_NAME,
  );
  if (!install) {
    throw new Error(`No installation of "${APP_NAME}" found for ${subdomain}`);
  }

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
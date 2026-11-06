/**
 * Writes the per-account ZAF secret into this account's HelpCenterIQ app
 * installation (the `jwt_secret` secure setting), using the account's OAuth
 * access token.
 *
 * Matches the installation by app_id first (stable, Zendesk-managed). Falls
 * back to the install title (settings.name) only for dev/zcli installs that
 * don't appear in /api/v2/apps.json. (Tracked on HCIQ-25 — not part of HCIQ-20.)
 */

const APP_NAME = "HelpCenterIQ"; // manifest name / dev-install title

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
  const installs = (await zendeskGet(
    subdomain,
    accessToken,
    "/api/v2/apps/installations.json",
  )) as {
    installations: Array<{
      id: number;
      app_id: number;
      settings?: { name?: string };
    }>;
  };

  // 1. Prefer app_id: find OUR app in /api/v2/apps.json, then match its
  //    installation by app_id (admins can't change app_id).
  let install: { id: number } | undefined;
  try {
    const apps = (await zendeskGet(
      subdomain,
      accessToken,
      "/api/v2/apps.json",
    )) as { apps: Array<{ id: number; name: string }> };

    const app = apps.apps.find((a) => a.name === APP_NAME);
    if (app) {
      install = installs.installations.find((i) => i.app_id === app.id);
    }
  } catch {
    // apps.json not available / app not owned here — fall back below.
  }

  // 2. Fallback for dev/zcli installs that don't show in apps.json: match the
  //    install title. Only safe when exactly one install carries that title.
  if (!install) {
    const byTitle = installs.installations.filter(
      (i) => i.settings?.name === APP_NAME,
    );
    if (byTitle.length === 1) {
      install = byTitle[0];
    } else if (byTitle.length > 1) {
      throw new Error(
        `Ambiguous: ${byTitle.length} installs titled "${APP_NAME}" for ${subdomain}`,
      );
    }
  }

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
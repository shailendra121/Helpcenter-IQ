/* eslint-disable @typescript-eslint/no-explicit-any */
declare const ZAFClient: { init(): any } | undefined;

const zaf = typeof ZAFClient !== "undefined" ? ZAFClient.init() : null;
// Fixed backend URL — intentionally NOT an editable app setting, so an admin
// can't point the app at the wrong host. When the backend URL changes
// (e.g. a custom domain before Marketplace), update it here AND in the
// manifest domainWhitelist.
const BACKEND_URL = "https://helpcenteriq-backend-295420833463.asia-south1.run.app";

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Drop-in replacement for fetch() for backend calls.
 *
 * Inside Zendesk (packaged app): goes through the ZAF client with a
 * ZAF-signed HS256 JWT, so the backend can verify the calling Zendesk
 * account. Outside Zendesk (local dev, unit tests): plain fetch with
 * cookies.
 */
export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!zaf) {
    return fetch(path, { ...init, credentials: "include" });
  }

  const ctx = await zaf.context();
  const base = BACKEND_URL;

  try {
    const data = await zaf.request({
      url: base + path,
      type: (init.method ?? "GET").toUpperCase(),
      contentType: "application/json",
      data: typeof init.body === "string" ? init.body : undefined,
      dataType: "json",
      secure: true,
      cors: false,
      headers: { Authorization: "Bearer {{jwt.token}}" },
      jwt: {
        algorithm: "HS256",
        secret_key: "{{setting.jwt_secret}}",
        expiry: 300,
        claims: { subdomain: ctx.account.subdomain },
      },
    });

    return jsonResponse(data, 200);
  } catch (err: any) {
    return jsonResponse(err?.responseJSON, err?.status ?? 500);
  }
}

/**
 * URL that starts the Zendesk OAuth install flow for the current account.
 * Opened in a new tab (Zendesk's authorize screen cannot load in the iframe).
 */
export async function getInstallUrl(): Promise<string | null> {
  if (!zaf) return null;

  const ctx = await zaf.context();
  const base = BACKEND_URL;
  return `${base}/zendesk/oauth/start?subdomain=${encodeURIComponent(ctx.account.subdomain)}`;
}
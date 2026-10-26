/* eslint-disable @typescript-eslint/no-explicit-any */
declare const ZAFClient: { init(): any } | undefined;

const zaf = typeof ZAFClient !== "undefined" ? ZAFClient.init() : null;

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data ?? {}), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Drop-in replacement for fetch() for backend calls.
 * Inside Zendesk: ZAF client.request with a ZAF-signed HS256 JWT.
 * Outside Zendesk (local dev, tests): plain fetch with cookies.
 */
export async function apiFetch(
    path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!zaf) {
    return fetch(path, { ...init, credentials: "include" });
  }

  const [md, ctx] = await Promise.all([zaf.metadata(), zaf.context()]);
  const base = String(md.settings.backendUrl).replace(/\/$/, "");

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
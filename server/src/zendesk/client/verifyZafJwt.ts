import jwt from "jsonwebtoken";

/**
 * Verifies the ZAF JWT Zendesk sends with the initial iframe page request,
 * confirming the request originates from a legitimate Zendesk app
 * installation rather than a forged/downgraded request.
 *
 * Zendesk sets the JWT audience to the URI of the specific app installation:
 * https://{subdomain}.zendesk.com/api/v2/apps/installations/{installationId}.json
 */
export function verifyZafJwt(
  token: string,
  appPublicKeyPem: string,
  subdomain: string,
  installationId: string,
) {
  const audience =
    `https://${subdomain}.zendesk.com/api/v2/apps/installations/` +
    `${installationId}.json`;

  return jwt.verify(token, appPublicKeyPem, {
    algorithms: ["RS256"],
    audience,
  });
}
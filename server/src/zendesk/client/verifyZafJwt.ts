import jwt from "jsonwebtoken";

/**
 * Verifies the ZAF JWT Zendesk sends with the initial iframe page request,
 * confirming the request originates from a legitimate Zendesk app
 * installation rather than a forged/downgraded request.
 * See docs/adr/0001-server-side-zaf-architecture.md.
 */
export function verifyZafJwt(token: string, appPublicKeyPem: string, installationId: string) {
  return jwt.verify(token, appPublicKeyPem, {
    algorithms: ["RS256"],
    audience: `https://${installationId}/api/v2/apps/installations`,
  });
}

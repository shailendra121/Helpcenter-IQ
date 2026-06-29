// Initializes the ZAF client and forwards the agent/admin into the
// backend-served dashboard, passing origin + app_guid so the backend can
// validate the request came from a legitimate Zendesk instance (see
// server/src/zendesk/ and docs/adr/0001-server-side-zaf-architecture.md).

(function () {
  const client = ZAFClient.init();

  client.context().then((context) => {
    const params = new URLSearchParams({
      origin: context.account.subdomain,
      app_guid: context.instanceGuid,
    });

    window.location.href = `https://app.helpcenteriq.example/zaf/dashboard?${params.toString()}`;
  });
})();

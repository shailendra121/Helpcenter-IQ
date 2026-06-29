# Infra (Terraform)

`modules/` — reusable building blocks (backend service, managed Postgres,
secrets storage for the AI provider key + Zendesk OAuth client secret).

`environments/{dev,staging,production}/` — one state per environment,
each composing the modules above with environment-specific sizing.

Per ADR-0001/0002, production Postgres should be provisioned in the same
region as the majority of target customers' Zendesk pod, to minimize
cross-region transfer of ticket data during analysis runs.

Secrets (Zendesk OAuth client secret, AI provider API key, token
encryption key) must be provisioned via the secrets module, never as plain
Terraform variables committed to this repo.

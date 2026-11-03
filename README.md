# HelpCenterIQ

AI-powered knowledge gap intelligence for Zendesk.

HelpCenterIQ analyzes Zendesk support tickets to identify missing, weak, or
outdated help center articles and recommends content improvements that
reduce repeat tickets.

> Find knowledge gaps in Zendesk tickets and turn them into better help
> center content.

## Repo layout

zendesk-app/   Zendesk Apps Framework (ZAF) package — manifest, thin iframe shell.
                Submitted to the Zendesk Marketplace as a server-side app.
server/        Backend — API, Zendesk integration, AI pipeline, jobs, DB.
dashboard/     Frontend built and packaged into the ZAF app (not served by the backend).
infra/         Docker + Terraform for environments (dev/staging/production).
docs/          Architecture decision records, diagrams, project docs.
scripts/       One-off / dev / release scripts.
.github/       CI workflows, issue + PR templates.
```

## Architecture summary

- **Pattern:** Zendesk server-side app (thin ZAF iframe, real logic lives on
  our infrastructure). See `docs/adr/0001-server-side-zaf-architecture.md`.
- **Backend:** Node.js / TypeScript, deployed on Google Cloud Run.
- **Database:** PostgreSQL + `pgvector` (relational + embeddings, one store),
  on Cloud SQL via Private Service Connect.
- **AI:** Provider-abstracted (`server/src/ai/providers/`), zero-data-retention
  agreement, PII masked before any request leaves our backend.
- **Zendesk auth:** Global OAuth (per Zendesk Marketplace requirements — no
  customer API tokens).

See `docs/adr/` for the full reasoning behind each decision, and
`PROJECT_SCOPE.md` for the product brief this build is based on.

## Getting started

See `docs/SETUP.md`.

## Deployment (Google Cloud)

HelpCenterIQ runs on Google Cloud. The backend and the Cloud SQL database are
both in `asia-south1` (Mumbai), connected over Private Service Connect.

- **Backend API** — a Cloud Run service (`helpcenteriq-backend`) with a public
  HTTPS URL. `min-instances` is 0 to keep idle cost near zero.
- **Jobs** — DB migrations (`helpcenteriq-migrate`) and the analysis worker
  (`helpcenteriq-worker`) run as Cloud Run Jobs. The worker is triggered on a
  schedule by Cloud Scheduler.
- **Images** — stored in Artifact Registry
  (`asia-south1-docker.pkg.dev/helpcenter-iq/helpcenteriq/backend`).
- **Secrets** — all read from Secret Manager at runtime. No secrets live in the repo.
- **Frontend** — the dashboard is packaged into the Zendesk (ZAF) app and uploaded
  with ZCLI; it is **not** served from the backend. It calls the Cloud Run API
  using ZAF-signed requests.

### Auto-deploy flow (CI/CD)

Auto-deploy is handled by `.github/workflows/backend-deploy.yml`. On every
push/merge to `main` that touches backend paths (`server/**`, `package*.json`,
the deploy/test workflows):

1. Tests run first — a failed test **blocks** the deploy.
2. GitHub authenticates to Google Cloud via **Workload Identity Federation**
   (OIDC). No service-account JSON keys are stored in GitHub.
3. The container image is built and pushed to Artifact Registry.
4. The new revision is deployed to Cloud Run (service), and the migrate and
   worker Jobs are updated.

Frontend-only commits do **not** trigger a backend deploy (path filters).

Required **GitHub repository variables** (Settings → Secrets and variables →
Actions → Variables):

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | `helpcenter-iq` |
| `GCP_REGION` | `asia-south1` |
| `WIF_PROVIDER` | `projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-pool/providers/github-provider` |
| `DEPLOY_SA` | `helpcenteriq-github-deployer@helpcenter-iq.iam.gserviceaccount.com` |
| `APP_ORIGIN` | the Cloud Run service URL |
| `VPC_NETWORK` | `default` |
| `VPC_SUBNET` | `default` |

(`CLOUDSQL_INSTANCE` is left unset — the DB uses Private Service Connect, not a
unix socket.)

### Required GCP roles

**Deploy service account** (`helpcenteriq-github-deployer@...`) — least privilege,
used only by CI:

- `roles/run.admin` — deploy Cloud Run service and jobs
- `roles/artifactregistry.writer` — push images
- `roles/iam.serviceAccountUser` — act as the runtime service account
- `roles/cloudscheduler.admin` — create/update the worker's Cloud Scheduler trigger

**Runtime service account** (`helpcenteriq-runtime@...`) — used by the Cloud Run
service and jobs at runtime:
- `roles/secretmanager.secretAccessor` — read the secrets it needs
- `roles/run.invoker` on `helpcenteriq-worker` — run the worker job (Cloud
  Scheduler trigger and the "start the worker now" call)

### Secrets (Secret Manager)

Secrets used at runtime: `DATABASE_URL`, `ZENDESK_OAUTH_CLIENT_ID`,
`ZENDESK_OAUTH_CLIENT_SECRET`, `GEMINI_API_KEY`, `TOKEN_ENCRYPTION_KEY`,
`ZAF_SESSION_SECRET`.

**Add a new secret:**

```bash
printf '%s' "THE_VALUE" | gcloud secrets create SECRET_NAME \
  --data-file=- --replication-policy=automatic

# grant the runtime SA read access
gcloud secrets add-iam-policy-binding SECRET_NAME \
  --member="serviceAccount:helpcenteriq-runtime@helpcenter-iq.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Rotate (update) an existing secret:**

```bash
# add a new version
printf '%s' "THE_NEW_VALUE" | gcloud secrets versions add SECRET_NAME --data-file=-

# make the service/jobs pick up the new version
gcloud run services update helpcenteriq-backend --region asia-south1 \
  --update-secrets SECRET_NAME=SECRET_NAME:latest
gcloud run jobs update helpcenteriq-worker --region asia-south1 \
  --update-secrets SECRET_NAME=SECRET_NAME:latest
```

Secrets are referenced as `SECRET_NAME:latest`, so a new version is used on the
next deploy/update — never commit secret values to the repo.

### Database: Cloud SQL + Private Service Connect

The database is Cloud SQL for PostgreSQL (with the `pgvector` extension) in
`asia-south1`, reachable only over **Private Service Connect (PSC)** — it has no
public IP.

Setup (one-time, already provisioned):

- The instance has PSC enabled and the consumer project (`helpcenter-iq`) in its
  allowed-projects list.
- A PSC endpoint exposes the instance at an internal IP (e.g. `10.142.0.2`) on the
  `default` VPC network, with **global access** enabled so Cloud Run in
  `asia-south1` can reach it cross-region.
- Cloud Run connects via **Direct VPC egress**
  (`--network=default --subnet=default --vpc-egress=private-ranges-only`), using
  that internal IP.

`DATABASE_URL` therefore uses the PSC internal IP and requires SSL:

```
postgresql://USER:PASSWORD@<PSC_INTERNAL_IP>:5432/helpcenteriq?sslmode=require
```

Migrations run automatically as a Cloud Run Job (`helpcenteriq-migrate`) on each
deploy, which also enables `pgvector` (`CREATE EXTENSION vector`).

### How `jwt_secret` is set (per-account tenant isolation)

The dashboard authenticates to the backend with a ZAF-signed JWT. To isolate
tenants, **each Zendesk account gets its own signing secret** — there is no
shared secret:

1. During the Zendesk OAuth install, the backend generates a random per-account
   secret, stores it encrypted (AES-256-GCM, `TOKEN_ENCRYPTION_KEY`) in the
   `zendesk_accounts` table, and writes it into that account's app installation
   `jwt_secret` setting via the Zendesk Apps API
   (`PUT /api/v2/apps/installations/{id}`).
2. On every request, the backend reads the claimed subdomain, looks up **that
   account's** secret, and verifies the token against it. A token signed with one
   account's secret but claiming another account is rejected (covered by
   `server/test/integration/tenantIsolation.test.ts`).

Admins do not enter the secret by hand. The `jwt_secret` manifest setting is
`secure: true` and is populated automatically after OAuth (the app must be
reloaded once for ZAF to pick it up).

> Note: after this release, any existing install must re-authorize once
> (click Connect in the app) so its per-account `jwt_secret` is generated
> and set. New installs get this automatically during OAuth.

### Manual deploy (without CI)

```bash
IMAGE=asia-south1-docker.pkg.dev/helpcenter-iq/helpcenteriq/backend:manual
docker build -f server/Dockerfile -t "$IMAGE" .
docker push "$IMAGE"
gcloud run services update helpcenteriq-backend --region asia-south1 --image "$IMAGE"
```

## Project management

Work is tracked in Jira under project key **HCIQ**. See `docs/JIRA.md` for
the workflow, ticket conventions, and how commits/PRs link back to issues.
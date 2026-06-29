# ADR-0001: Server-side ZAF architecture

- Status: Accepted
- Date: 2026-06-29
- Jira: HCIQ-1

## Context

HelpCenterIQ needs to: pull ticket history (30/60/90 days) from Zendesk,
run AI clustering and gap analysis against Zendesk Guide content, persist
analysis results and draft articles between runs, and present a manager-
facing dashboard inside Zendesk.

Zendesk apps can be built as:

1. **Client-side ZAF app** — static HTML/JS/CSS, hosted and served by
   Zendesk, runs entirely in the agent's browser.
2. **Server-side ZAF app** — the iframe is a thin shell; the real
   logic/state lives on infrastructure we own and operate.

We also evaluated whether the app could avoid an external backend entirely
("Salesforce-native" style — compute and storage fully inside the host
platform).

## Decision

Build a **server-side ZAF app**: a minimal Zendesk app package
(`zendesk-app/`) containing only the manifest and a thin iframe shell, with
all business logic, AI orchestration, and persistence in our own backend
(`server/`).

## Alternatives considered

**Pure client-side app.** Rejected — no application logic or content can
be stored in Zendesk's infrastructure for a client-side app; it's static
assets in a browser tab. Can't run scheduled ticket analysis, can't hold an
AI provider key safely, can't persist clustering results across sessions.

**"Fully native, nothing leaves Zendesk" (Salesforce-style).** Rejected —
Zendesk has no equivalent to Salesforce's Apex/Force.com execution + data
layer. The closest analog, Sunshine Custom Objects, is (a) meant for small
structured records tied to tickets/users, not AI pipeline state or vector
embeddings, and (b) the *legacy* version is being fully removed
2026-07-27 — an unstable foundation regardless of fit. There is no
documented way to run our own compute or persist arbitrary application
state inside Zendesk's infrastructure.

**Using Zendesk's own AI (Intelligent Triage / Copilot / Content Cues)
instead of our own AI calls.** Rejected as a *replacement* — these are
admin-console features Zendesk runs over its own data, with no public API
exposing the underlying capability for a third-party app to invoke as part
of a custom pipeline. We do plan to *read* Topic/Sentiment fields when
present (a free signal), but this doesn't replace our own clustering/
drafting AI calls.

## Consequences

- We own a backend's full operational lifecycle (uptime, scaling, security
  patching, on-call).
- We must implement Zendesk's server-side app auth requirements: global
  OAuth tokens (see ADR-0004), and JWT verification of the initial iframe
  request to confirm it originates from a legitimate Zendesk instance.
- We get full control over deploys — backend changes ship without
  resubmitting the Zendesk app package, only iframe-shell changes do.
- We must explicitly disclose in the Marketplace listing what Zendesk data
  the app accesses and why, per Zendesk's publishing requirements.

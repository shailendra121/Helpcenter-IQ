# Project Scope — HelpCenterIQ (Zendesk Knowledge Gap Finder)

> This file is the canonical, version-controlled copy of the product scope.
> If the scope changes, update this file via PR so the history of *why*
> architecture decisions were made stays traceable against the scope that
> motivated them. Cross-reference relevant ADRs in `docs/adr/`.

## Product Concept

**Knowledge Gap Finder** is an AI-powered Zendesk Marketplace app that helps
support teams identify missing, outdated, or weak knowledge base content by
analyzing real customer support tickets. The app continuously reviews
Zendesk tickets, detects repeated questions or unresolved patterns, compares
them with existing help center articles, and recommends new or updated
knowledge articles.

The goal is to reduce repeated support tickets, improve self-service, and
help support teams keep their knowledge base aligned with real customer
issues.

## Value Proposition

Most companies already have a help center, but their knowledge base often
becomes outdated or incomplete over time. Support agents repeatedly answer
the same questions because customers cannot find the right article, the
article does not exist, or the existing article does not fully answer the
issue.

**Knowledge Gap Finder helps Zendesk customers turn support tickets into
actionable knowledge improvements.**

Key value for customers:

- Reduce repeat support tickets by identifying common unanswered questions.
- Improve customer self-service by suggesting missing help articles.
- Save support team time by converting real ticket patterns into draft KB
  content.
- Keep existing articles up to date by detecting outdated or incomplete
  content.
- Help support managers understand why customers are still contacting
  support.
- Improve deflection rate and reduce support cost over time.

## Target Customers

- SaaS companies using Zendesk Support and Zendesk Guide.
- Ecommerce companies with high-volume support tickets.
- Customer support teams with a growing help center.
- Companies where agents repeatedly answer similar questions.
- Support leaders focused on ticket deflection, self-service, and
  operational efficiency.

## Core Features – MVP

### 1. Ticket Analysis

Analyzes historical and recent Zendesk tickets to identify repeated
customer issues, common questions, and themes.

### 2. Knowledge Base Matching

For each detected issue, checks whether a related Zendesk Guide article
already exists, classifying each topic as:

- **Missing Article** – no relevant article found.
- **Weak Article** – article exists but does not fully answer the issue.
- **Outdated Article** – article may contain old or incomplete information.
- **Good Coverage** – existing article appears sufficient.

### 3. AI Recommendations

Per-gap recommendations: create new article, update existing, add missing
steps, add screenshots/examples, improve title for discoverability, add
related keywords.

### 4. Draft Article Generator

Generates a draft KB article using real ticket context: suggested title,
problem summary, step-by-step resolution, FAQ section, related keywords,
internal reviewer notes. **Never auto-publishes** — human review required.

### 5. Knowledge Gap Dashboard

Shows: top missing articles, most repeated questions, estimated ticket
volume per gap, suggested priority, articles needing updates, potential
deflection opportunity.

## Future Features (post-MVP)

- Auto-tagging tickets by knowledge gap.
- Weekly knowledge gap reports.
- Slack / email notifications.
- Multi-language article suggestions.
- Article performance tracking after publishing.
- AI-based article quality scoring.
- Agent sidebar suggestions inside tickets.
- Integration with Confluence, Notion, SharePoint, Google Drive.
- Approval workflow for knowledge managers.

## User Flow

1. Admin installs the app from Zendesk Marketplace.
2. Admin connects Zendesk Support and Zendesk Guide.
3. App analyzes selected tickets from the last 30/60/90 days.
4. AI groups similar tickets into knowledge topics.
5. App compares topics with existing help center articles.
6. Dashboard shows missing, weak, or outdated knowledge areas.
7. Knowledge manager reviews recommendations.
8. App generates draft articles or update suggestions.
9. Human reviewer edits and publishes approved content.

## AI Capabilities

Ticket clustering, intent detection, semantic search against Zendesk Guide,
gap detection, article drafting, article improvement suggestions, keyword
extraction, priority scoring.

Enterprise readiness requires: PII masking, audit logs, configurable AI
model usage. See `docs/adr/0003-ai-provider-abstraction-and-pii-masking.md`.

## MVP Scope

**In scope:**

- Zendesk Support ticket analysis
- Zendesk Guide article matching
- Knowledge gap classification
- AI-generated recommendations
- Draft article generation
- Basic admin dashboard

**Out of scope for MVP:**

- Auto-publishing articles
- Complex workflow approvals
- Multi-language support
- External knowledge source integrations
- Real-time ticket sidebar assistant
- Advanced analytics across multiple brands

## Success Metrics

- Reduction in repeated ticket volume
- Number of new articles created
- Number of outdated articles improved
- Increase in self-service usage
- Improvement in ticket deflection
- Reduced average handle time
- Reduced agent effort on repeated issues

## Positioning Statement

**Knowledge Gap Finder helps Zendesk customers discover what their help
center is missing by analyzing real support tickets and turning repeated
customer questions into actionable knowledge base improvements.**

Instead of guessing what articles to write, support teams can use AI to
identify the highest-impact knowledge gaps and continuously improve
self-service.

## Suggested Pricing Model

- Starter: $99/month — small teams, limited ticket analysis.
- Growth: $299/month — higher ticket volume, dashboard, article drafts.
- Enterprise: $799+/month — advanced security, custom AI model support,
  audit logs, priority support.

Pricing may also key off monthly ticket volume or agent count.

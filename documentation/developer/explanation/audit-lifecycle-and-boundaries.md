# Audit Lifecycle And Boundaries

The app separates the paid audit lifecycle from public knowledge surfaces.

## Paid Audit Flow

The intake route validates `IntakeInput`, resolves a trip context, runs the completeness gate, and returns a preview risk only when enough evidence exists. Checkout is blocked until the audit is complete and eligible for payment.

Stripe Checkout is a handoff, not the unlock boundary. The status page can show that the traveler returned from Checkout, but the report lifecycle changes only after `/api/stripe/webhook` verifies a signed Stripe event.

Report generation uses controlled read-only retrieval tools and the OpenAI Responses API adapter. The generator receives bounded facts and evidence, then deterministic validation checks structure, evidence IDs, freshness, payment state, and consequential claims. The reviewer pass returns structured approval, correction, or block results before publication.

## Public Knowledge Flow

Public accommodation, area, route, operator, and risk pages are generated from normalized public fact records. Human HTML, LLM Markdown, JSON APIs, JSON-LD, sitemap entries, and `llms.txt` must not materially diverge because they share the same source facts.

Public eligibility requires republishable facts, non-low confidence, critical public evidence, no private user data, no raw provider payloads, and a confident or probable canonical entity match.

## Privacy And Security Boundaries

Private audit and admin routes are marked `noindex`. `robots.txt` disallows private audit, admin, audit API, and Stripe API paths. Security headers are configured globally in `next.config.ts`.

Telemetry uses sanitized payloads. Intake metrics keep coarse completion attributes and omit accommodation names, platform URLs, and free-form traveler details. Server-only secrets are read without the `NEXT_PUBLIC_` prefix, and tests assert sensitive server keys do not appear in client-facing files.

## Operational Boundaries

Current rate limits are in-memory policies for intake, checkout, public APIs, report access, and provider/webhook calls. Production deployment should replace or back these limits with shared infrastructure when multiple instances are running.

Background job primitives exist for audit generation and reviewer publication, but the production worker backend remains a launch integration task. Provider integrations for booking, review, social, and partner data remain subject to API access and terms approval.

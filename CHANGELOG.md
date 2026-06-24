# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning when releases are tagged.

## [Unreleased]

### Added

- Established progress tracking for the shadcn/Panda migration plan.
- Added the Ask Siargao `/chat` workspace with desktop three-column context layout, mobile chat layout, mock conversation cards, and Playwright coverage.
- Added the landing and chat mockup implementation plan with step-by-step progress tracking.
- Added a repository-backed public-page generation boundary using persisted-page-shaped governed facts, public evidence bundles, and source fact IDs across human, Markdown, JSON, JSON-LD, sitemap, and `llms.txt` outputs.
- Added the first governed provider ingestion slice for local verified public-directory accommodation records, producing governed facts, evidence, and checkout-safe accommodation candidates.
- Added a GitHub Actions CI release gate for non-mutating Biome checks, TypeScript, Bun tests, database validation, production build, and Playwright e2e.
- Added release-candidate developer documentation for local setup, quality gates, environment variables, routes, demo data, audit lifecycle boundaries, provider limitations, and manual QA.
- Added a typed release-candidate demo scenario manifest and tests for synthetic or permitted local QA fixtures.
- Added sanitized observability events, privacy helpers, server-only secret handling, endpoint rate limits, security/noindex headers, and robots crawl rules.
- Added security tests for rate limiting, telemetry redaction, server-only secrets, public/private boundary enforcement, client-side secret absence, and crawl/noindex behavior.
- Added source-backed public knowledge surfaces for accommodations, areas, routes, operators, and risks, with human pages, LLM Markdown, JSON APIs, JSON-LD, sitemap, and `llms.txt`.
- Added public-surface tests proving human, Markdown, JSON, and JSON-LD outputs share the same facts and block private, raw, restricted, low-confidence, or weak-match content from publication.
- Added an environment-gated admin diagnostics console, diagnostics aggregation, redaction utilities, structured diagnostic log events, and operator drill-down views.
- Added admin diagnostics tests for production access gating, sensitive value redaction, blocked audit summaries, stale facts, provider errors, reviewer blocks, LLM cost estimates, job failures, and browser rendering without sample secret leaks.
- Added OpenAI Responses API adapter boundaries, controlled read-only retrieval tools, reviewer validation, mocked LLM coverage, and the final paid report page.
- Added report generation tests for unsupported data filtering, tool budgets, structured report parsing, deterministic validator failures, reviewer revision/block paths, and browser rendering of evidence-backed reports.
- Added Stripe Checkout session creation, verified webhook extraction, payment event records, audit lifecycle guards, background job primitives, and processing status UI.
- Added payment lifecycle tests proving checkout is gated, checkout returns do not unlock reports, webhook signatures are verified, generation starts only after verified payment, impossible publication states are rejected, and job failures preserve diagnostics.
- Added deterministic risk contracts, risk ranking, evidence bundle creation, stricter report schemas, and report publication validators.
- Added report validation tests for missing sections, invalid evidence, uncited accommodation claims, stale facts, payment-state violations, and low-confidence consequential claims.
- Added audit intake UI, `/api/audit/intake`, accommodation resolution, completeness gating, preview-risk generation, targeted refresh hooks, and checkout eligibility blocking.
- Added intake/completeness tests and a browser e2e submission for the minimum viable intake flow.
- Added source registry, provider adapter contracts, fact graph normalization, source/fact scoring, and conflict detection foundations.
- Added source governance tests for explicit source profiles, disallowed source rejection, allowed-use behavior, separate scoring records, and official-source precedence.
- Added the initial audit domain model with typed job states, risk/source/public visibility enums, report/intake validation schemas, and Siargao seed taxonomy.
- Added Drizzle/Postgres database setup, an initial SQL migration for the core fact graph and audit tables, and PGlite-backed migration/seed validation commands.
- Added tests for audit state transitions, schema validation, taxonomy coverage, and migration table coverage.
- Built the static Siargao Trip Risk Audit landing page with header, hero, risk preview, check grid, process section, trust band, sample report, testimonials, pricing/FAQ, and footer.
- Added a generated coastal dusk background image under `public/images/` and wired it into the global page background.
- Added landing-focused Panda tokens, recipes, local UI primitives, and Playwright checks for key sections, FAQ keyboard interaction, and responsive overflow.
- Scaffolded the Next.js App Router application with TypeScript, React, Panda CSS, and a minimal root page.
- Added Biome formatting and linting, Bun unit tests, Playwright e2e smoke tests, production build scripts, and development scripts.
- Added environment variable placeholders, dependency/build/test ignore rules, and generated Panda styling output.
- Established project progress tracking with `PROGRESS.md` and changelog tracking for the implementation plan.

### Changed

- Aligned route documentation, local QA docs, release-candidate checks, and site config regression coverage with the Ask Siargao landing and `/chat` surfaces.
- Replaced the audit-first root landing page with the Ask Siargao mockup landing experience, including the prompt card, weather card, suggestion chips, trust row, feature cards, and updated root e2e coverage.
- Reframed the shared app shell metadata, dark coastal background, brand tokens, and reusable Ask Siargao UI primitives for the landing and chat mockups.

### Deprecated

### Removed

### Fixed

- Returned stable `invalid_json` responses for malformed audit intake request bodies while preserving schema-level `invalid_intake` errors.
- Computed evidence freshness against the current clock so expired facts become stale and invalid expiry values remain unknown.
- Required paid report validation to cover every mandatory risk category in the full risk table while keeping top risks as a ranked subset.
- Added an injectable rate-limit store path, local expiry cleanup, and opt-in trusted-proxy identity handling so spoofed forwarding headers do not bypass limits by default.
- Allowed audit intake to use a selected arrival route when the free-text origin is absent.
- Moved API route test helpers out of Next route modules so production builds validate App Router exports.
- Derived public-page republication eligibility from registered source policy, blocking citation-only official facts from public answer-engine surfaces.
- Scoped controlled retrieval evidence IDs to the facts selected by each tool so unrelated evidence cannot be returned with route or accommodation facts.
- Required signed-token access plus paid, published, reviewer-approved state before rendering private audit reports, with the sample report moved to an explicit demo route.
- Applied verified Stripe checkout webhooks to the persisted audit/payment lifecycle with duplicate-event idempotency and generation job enqueueing.
- Loaded audit checkout eligibility from persisted server-side audit, completeness, and payment state instead of trusting client-supplied lifecycle fields.
- Kept the typed Drizzle schema exports in parity with the initial SQL migration, including candidate matching, scoring, refresh, LLM tool-call, provider-health, and public-page generation tables.

### Security

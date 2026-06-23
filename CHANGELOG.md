# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning when releases are tagged.

## [Unreleased]

### Added

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

### Deprecated

### Removed

### Fixed

### Security

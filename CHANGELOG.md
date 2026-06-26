# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to Semantic Versioning when releases are tagged.

## [Unreleased]

### Added

- Added a shared place-intent classifier for Priority 1 local recommendations, covering food,
  cafes, bars, activity places, services, specific places, live open-now and hours needs, nearby
  context, constraints, and named-place map-link prompts.
- Established progress tracking for the Priority 1 live local recommendation implementation plan.
- Established progress tracking for the Google Places persistence implementation plan.
- Added typed Google Places capture tables for identities, snapshots, details, reviews, freshness,
  retention, attribution, and migration parity.
- Added central Google Places field-mask, freshness, retention, reuse-state, and attribution policy
  helpers.
- Added a Google Places capture store for typed upserts, fresh lookups, normalized facts/evidence,
  review governance, and expired-content deletion.
- Added a Google Places retention cleanup job and `db:prune:google-places` script with dry-run
  support.
- Added a DB-first `AnswerContextStore` for bounded Google Places answer facts, source freshness,
  refresh gating, and gap reporting.
- Added end-to-end route coverage proving DB-first Google chat context, blocked-refresh gaps, and
  restricted Google content filtering before LLM input.
- Added a cached Google Places chat lookup path for recommendation answers, including persisted
  fresh search context and opening-hour signals.
- Added a logged local development stack workflow for host and Compose startup, database
  migration/seed steps, stack commands, and redacted command logging.
- Added curated Siargao beach guidance for grounded beach follow-up answers around General Luna,
  Cloud 9, sandy beaches, ride-time constraints, swimming, and sunset fit.
- Added Ask Siargao positioning and roadmap documentation focused on live local checks,
  weather-aware planning, place recommendations, map-first UX, and trust labels.
- Added mocked browser coverage for real chat submission, assistant response rendering, and prompt auto-submit.
- Established progress tracking for the real chat replacement plan.
- Added a first GPT-backed Ask Siargao chat slice with a server-side OpenAI Responses API adapter, `/api/chat` endpoint, rate limiting, validation, landing prompt deep links, and interactive desktop/mobile composers.
- Added explicit empty states to the admin diagnostics console for empty blocked-audit, completeness, provider/job, reviewer, LLM-cost, and drill-down datasets.
- Added shadcn primitives for sidebar, scroll area, avatar, input groups, button groups, toggles, items, empty states, breadcrumbs, collapsibles, and navigation menus.
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

- Generalized the recommendation agent from food-only deterministic searches to Priority 1 local
  place searches, including open-now food, cafes, bars, activity places, service places, and
  specific-place identity/map-link lookups.
- Routed Priority 1 local-place chat requests through the recommendation agent with route coverage
  for open-now follow-ups, bar/drinks prompts, service-place prompts, covered/beachfront requests,
  and named-place map-link follow-ups.
- Restored `/api/chat` Google Places answer-context wiring for live/stored place facts and expanded
  recommendation detection to accommodation rating follow-ups near Cloud 9.
- Runs the checked-in SQL database migration during Compose startup after Postgres is healthy and
  before the app container starts serving.
- Routed `/api/chat` Google Places recommendation context through the DB-first
  `AnswerContextStore` dependency instead of direct provider lookup.
- Documented the Google Places persistence lifecycle, DB-first chat flow, retention pruning, and
  restricted-content operator limits.
- Constrained chat generation with a bounded answer-context contract for provider-specific facts,
  source freshness, attribution, and gaps.
- Made Google Places chat and details adapters capture-ready while preserving existing chat context
  compatibility.
- Optimized chat Google Maps link enrichment so existing linked URIs are detected reliably and
  missing map links are appended near matching place names.
- Bounded the client chat history sent to `/api/chat` by limiting prior completed turns and
  truncating long message content before follow-up requests.
- Routed food and place recommendation questions through the multi-step recommendation agent with
  request IDs, structured logs, provider-backed candidates, ranking, and fallback errors.
- Grounded weather-sensitive activity plans and beach follow-up answers in interpreted chat intent,
  live weather context when available, and local Siargao guidance before falling back to generic LLM
  responses.
- Changed `/chat?prompt=` deep links to prefill the composer without auto-submitting or clearing
  the prompt URL parameter.
- Wired weather-related `/api/chat` requests to Siargao Open-Meteo weather context, including direct live fallback when stored forecast rows are unavailable and Del Carmen area detection.
- Aligned landing-to-chat prompt links and copy with the GPT-only real chat surface, removing live-data and source-backed freshness claims from the landing shell.
- Replaced the `/chat` mock sidebar/context workspace with one focused responsive real chat shell.
- Completed final shadcn migration verification with Panda-free build/e2e gates and visual smoke checks across landing, chat, admin, status, public, and report surfaces.
- Updated package scripts, React Doctor config, Biome config, and developer docs for the Panda-free Tailwind/shadcn styling path.
- Migrated the paid report, admin diagnostics, public knowledge, and audit status surfaces from Panda helpers to shadcn/Tailwind classes and primitives.
- Migrated the Ask Siargao landing and chat workspace surfaces from Panda helpers to shadcn/Tailwind components.
- Migrated shared Ask Siargao primitives from Panda helpers to shadcn-backed Tailwind utilities.
- Moved Ask Siargao brand tokens into the Tailwind/shadcn CSS variable layer while keeping Panda available as a temporary fallback.
- Recorded the Panda-removal baseline inventory and confirmed planned shadcn migration primitives are available.
- Aligned route documentation, local QA docs, release-candidate checks, and site config regression coverage with the Ask Siargao landing and `/chat` surfaces.
- Replaced the audit-first root landing page with the Ask Siargao mockup landing experience, including the prompt card, weather card, suggestion chips, trust row, feature cards, and updated root e2e coverage.
- Reframed the shared app shell metadata, dark coastal background, brand tokens, and reusable Ask Siargao UI primitives for the landing and chat mockups.

### Deprecated

### Removed

- Removed completed `PLAN.md`, `PROGRESS.md`, and old implementation plan files after consolidating
  current product direction into roadmap documentation.
- Removed Panda CSS configuration, generated `styled-system` output, Panda theme token/recipe files, Panda codegen scripts, `postinstall`, and the `@pandacss/dev` dependency.

### Fixed

- Kept recommendation-agent candidate state consistent across planner steps so newly found places
  are available to ranking and final-answer rendering.
- Rendered assistant chat Markdown for bold text and bullet lists instead of collapsing formatted responses into a plain paragraph.
- Hoisted the chat timestamp formatter so message rendering does not rebuild `Intl.DateTimeFormat` for every timestamp.
- Hardened chat pending and error states with disabled in-flight controls, safe failure copy, retry affordance, and keyboard resubmission coverage.
- Improved admin and public outline badge contrast after final visual inspection.
- Added explicit sidebar rail button type and migrated the sidebar context read to the React 19 `use(context)` API.
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

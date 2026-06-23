# Implementation Plan

## Source Documents
- Path: `docs/PRD.md`
  - Role: Primary product requirements.
  - Summary: Defines the Siargao Trip Risk Audit product, user stories, implementation decisions, testing decisions, out-of-scope boundaries, and the central promise: one evidence-backed USD 9.99 audit, charged only when the system can complete it to a defined standard.
- Path: `docs/TECH.md`
  - Role: Primary technical specification.
  - Summary: Requires a production Next.js App Router and TypeScript app with Panda CSS, shadcn-derived local components, Postgres, Stripe Checkout, background jobs, OpenAI-based generator/reviewer flows, public agent-readable pages, source governance, audit states, observability, and privacy controls.
- Path: `docs/LANDING_STYLE_REQUIREMENTS.md`
  - Role: Detailed landing page design specification.
  - Summary: Extracts the visual system from `landing.png`: dark Siargao beach background, violet brand tokens, white analytical panels, risk preview/report components, responsive layouts, lucide icons, Panda recipes, accessibility requirements, and QA checklist.
- Path: `landing.png`
  - Role: Required visual design reference.
  - Summary: Shows the target first-page composition: header, hero, trip risk preview card, what-we-check grid, how-it-works section, trust band, sample report preview, testimonials, pricing/FAQ, and footer.
- Path: `docs/DATA_STRATEGY.md`
  - Role: Data architecture and source governance strategy.
  - Summary: Requires an autonomous fact graph with source profiles, allowed-use policy, entity resolution, atomic facts, separate source credibility and fact confidence, conflict detection, freshness windows, targeted refresh before payment, public visibility gates, and ingestion metrics.
- Path: `docs/COMPETITORS.md`
  - Role: Market and positioning constraints.
  - Summary: Establishes the competitive gap: do not build another directory, booking site, or generic guide. Win with source-aware trip feasibility, official-source synthesis, fresh logistics intelligence, transparent AI use, and segment-specific risk evaluation.
- Path: `docs/STARTUP_IDEA_LAB.md`
  - Role: Product wedge and validation strategy.
  - Summary: Positions the product as a Siargao trust layer, prioritizing accommodation reality checks, arrival logistics, full trip audit, pre-arrival refresh, safety-net add-ons, and public AI-agent pages from permitted data.
- Path: `docs/ai-travel-concierge-proven-base.md`
  - Role: Prior concept and demand proof.
  - Summary: Clarifies that the proven pattern is paid expert trip-planning support, not generic AI itinerary generation. Useful constraints include intake-first UX, local/verified data, trust signals, and evidence-backed advice.
- Path: `docs/ai-travel-startup-ideas.md`
  - Role: Original concept framing.
  - Summary: Identifies "Trip Doctor" as the strongest solo-founder travel idea: audit an existing plan for feasibility, currentness, routing, and missing operational risks instead of generating broad itineraries.
- Path: `docs/deep-research-report.md`
  - Role: Research evidence behind the market thesis.
  - Summary: Shows fragmented Siargao information sources, weak official consolidation, uneven competitor freshness/disclosure, and the need to combine local directories, official sources, booking/review platforms, and operator/social signals.

## Goals
- Build a production-grade Siargao Trip Risk Audit web application, starting with the required landing page and intake flow.
- Preserve the product promise: one free preview risk, USD 9.99 full audit, and no payment unless the completeness gate passes.
- Implement source governance as a first-class system capability: allowed-use policy, source credibility, fact confidence, evidence IDs, freshness, and public visibility controls.
- Generate final audit reports with green/yellow/red rating, top risks, full risk table, cited evidence, recommendations, host questions, freshness/confidence labels, and explicit limitations.
- Support agent-readable public surfaces from permitted facts: human pages, LLM Markdown, structured JSON, evidence bundles, JSON-LD, sitemap, and `llms.txt`.
- Match the required landing page design from `landing.png` and `docs/LANDING_STYLE_REQUIREMENTS.md` using Panda CSS tokens and shared recipes.
- Establish quality gates before feature implementation so later agents can make small, validated commits.

## Non-Goals
- Do not implement a generic AI itinerary planner or chatbot as the core product.
- Do not build multi-destination support beyond isolating destination-specific rules for later reuse.
- Do not depend on Airbnb scraping or any ToS-risky scraping for v1.
- Do not build affiliate-first recommendations, commission-driven booking, or a public review marketplace in v1.
- Do not publish private paid reports, user trip details, non-republishable provider data, or unsupported claims to public or agent-readable pages.
- Do not build a native mobile app.
- Do not build a full account system unless email-based secure report links prove insufficient.
- Do not implement exhaustive real-time monitoring for every Siargao business, event, closure, fee, and operator in the first release.

## Assumptions and Open Questions
- Assumption: Because the workspace contains only docs and `landing.png`, implementation starts as a greenfield app in this project root. Impact: Step 1 must create the application scaffold, quality gates, and CI-ready scripts before product work.
- Assumption: Use Bun as the package manager and script runner, with Next.js App Router, TypeScript, Panda CSS, Biome, Vitest or Bun test, and Playwright. Impact: another package manager can be substituted in Step 1, but all scripts in this plan should be updated consistently if that changes.
- Assumption: Use Drizzle for the first Postgres ORM unless the implementing agent finds a strong repo-specific reason to choose Prisma. Impact: schema and migration steps are written around Drizzle-style migrations but can be adapted before Step 3 starts.
- Assumption: Use Inngest as the initial job runner for local/dev-friendly async workflows unless Trigger.dev or Redis-backed workers are chosen during setup. Impact: job abstractions should hide the runner choice.
- Assumption: Use OpenAI Responses API or Agents SDK behind a server-side LLM adapter; do not hard-code model names into business logic. Impact: tests should mock the adapter contract.
- Open question: Which provider access paths are approved first for accommodation and review data: Agoda, Google Places, Tripadvisor/Terra, local partner feeds, or user-submitted details? Impact: Step 4 should begin with source profiles and stub adapters, then add real providers only after terms are verified.
- Open question: What exact confidence thresholds should determine accommodation match success, public page eligibility, and paid audit completeness? Impact: Step 5 should centralize thresholds in typed config and tests so they can change safely.
- Open question: Is authentication required for v1, or are secure email report links sufficient? Impact: Step 7 payment/report delivery should prefer minimal email-link delivery unless user accounts become a requirement.
- Open question: Which Siargao background image asset will ship in production? Impact: Step 2 may use `landing.png` as visual reference and add a licensed/generated `/public/images/siargao-sunset.jpg` asset or a documented placeholder.
- Open question: Which public pages belong in `llms.txt` versus sitemap-only? Impact: Step 10 should implement a configurable inclusion flag and default to indexes plus high-confidence public pages.
- Conflict: Earlier concept docs emphasize 14-60 day long-stay travelers, while `docs/PRD.md` and `docs/TECH.md` explicitly support any stay length. Resolution: follow the PRD/TECH as the current source of truth and keep long-stay constraints as optional modules.

## Quality Gates
- Setup status: No existing app, package manager, source tree, test config, formatter, linter, build script, or CI workflow exists. Setup is required in Step 1.
- Baseline command: `find . -maxdepth 3 -type f \( -name 'package.json' -o -name 'bun.lock' -o -name 'bun.lockb' -o -name 'tsconfig*.json' -o -name 'biome.json*' -o -name 'vite.config.*' -o -name 'vitest.config.*' -o -name 'playwright.config.*' -o -name 'next.config.*' -o -path './.github/workflows/*' \) -print`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run typecheck`, `bun run build`, `bun run test:e2e`
- Visual/design QA after UI steps: run `bun run dev`, inspect desktop and mobile with Playwright screenshots, and compare against `landing.png` plus the QA checklist in `docs/LANDING_STYLE_REQUIREMENTS.md`.
- Accessibility QA after UI steps: include automated checks in Playwright where practical and manually verify heading order, focus states, touch targets, contrast over images, risk labels, and form labels.

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step, validation results, commit reference if available, current status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Create `CHANGELOG.md` before any quality-gate setup or implementation work begins.
- Initial content: Include `# Changelog`, the standard preamble, and an `## [Unreleased]` section.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with human-readable notable changes under the appropriate `Unreleased` change-type headings before creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress and changelog files the user can consult while the plan is being executed.

Depends on:
- None

Changes:
- Create `PROGRESS.md` in the project root.
- Add the plan title/sources, a checklist for every step in this plan, current status, and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Create `CHANGELOG.md` in the project root before any quality-gate setup or implementation work begins.
- Add Keep a Changelog 1.0.0 structure: `# Changelog`, the standard preamble, `## [Unreleased]`, and empty change-type headings as needed.
- Document that `CHANGELOG.md` must be updated after each step is completed and validated, before that step is committed.

Acceptance criteria:
- `PROGRESS.md` exists and contains a complete step checklist.
- `CHANGELOG.md` exists and follows the required Keep a Changelog 1.0.0 structure.

Validation:
- Run `test -f PROGRESS.md && test -f CHANGELOG.md`
- Run `rg -n "Step 0|Step 1|Unreleased|Keep a Changelog" PROGRESS.md CHANGELOG.md`

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set current status to Step 1, and identify the next step.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing progress and changelog tracking.

Commit:
- `chore: add progress and changelog tracking`

### Step 1: Project Scaffold and Quality Gates Setup
Goal: Create the Next.js/TypeScript application scaffold and runnable quality gates before product implementation starts.

Depends on:
- Step 0

Changes:
- Initialize a Next.js App Router app in the project root using TypeScript and Bun.
- Add or configure `package.json`, `bun.lock`, `tsconfig.json`, `next.config.ts`, and app source directories.
- Add Panda CSS configuration and codegen setup: `panda.config.ts`, generated CSS output, `src/theme/tokens.ts`, `src/theme/recipes.ts`, and `src/theme/global.css`.
- Add Biome for formatting/linting: `biome.json`.
- Add test setup for unit/integration tests with Bun test or Vitest, choosing one and documenting why in `PROGRESS.md`.
- Add Playwright for end-to-end and visual smoke tests: `playwright.config.ts`, `tests/e2e/`.
- Add scripts:
  - `format`: format the project.
  - `lint`: lint the project.
  - `typecheck`: run `tsc --noEmit`.
  - `test`: run unit/integration tests.
  - `test:e2e`: run Playwright tests.
  - `build`: run Next production build.
  - `dev`: start the local development server.
- Add a minimal root page and smoke test so every gate has something concrete to run.
- Add `.env.example` with placeholders for database, Stripe, OpenAI, job runner, observability, and public app URL settings. Do not add secrets.
- Add `.gitignore` for dependencies, build outputs, env files, generated artifacts, Playwright reports, and coverage.

Acceptance criteria:
- `bun install` succeeds.
- All configured quality-gate scripts exist and run.
- The root page renders in development and production build.
- No secret values are committed.

Validation:
- Run `bun install`
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with scaffold decisions, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with notable project scaffold and quality-gate setup changes after validation and before committing.

Commit:
- `chore: scaffold app and quality gates`

### Step 2: Landing Page Visual System and Static First Screen
Goal: Implement the required landing page design from `landing.png` as a polished, responsive, static first screen that lets users start an audit.

Depends on:
- Step 0
- Step 1

Changes:
- Add licensed/generated beach background asset under `public/images/` or document a temporary local placeholder.
- Implement Panda tokens from `docs/LANDING_STYLE_REQUIREMENTS.md`: navy, violet, lavender, surface, text, risk colors, gradients, typography, spacing, radii, shadows, and motion tokens.
- Implement shared Panda recipes: `pageShell`, `header`, `button`, `sectionPanel`, `miniFeatureCard`, `processCard`, `trustCard`, `riskPreviewCard`, `riskGauge`, `reportPreview`, `testimonialCard`, `pricingCard`, `faqAccordion`, and `footer`.
- Add local UI primitives under `src/ui/components`, using shadcn-derived Button, Badge, Card, Accordion, Input, Sheet, Tooltip, Separator, and Table patterns where useful, restyled with Panda instead of Tailwind.
- Implement the landing page sections:
  - Header with logo lockup, nav links, and CTA.
  - Hero with badge, two-line headline, supporting copy, CTA, price, guarantee notes, and trip risk preview card.
  - "What we check" panel with six cards.
  - "How it works" panel with four process cards and media card.
  - Trust band with image strip and four trust cards.
  - Sample report section with feature list and report preview.
  - Testimonials.
  - Pricing and FAQ.
  - Footer with newsletter form.
- Use lucide icons matching the style spec.
- Ensure the first screen starts the real product experience, not a generic marketing splash.
- Add tests for rendered key sections, accessible button labels, FAQ keyboard behavior, and absence of obvious mobile overflow.

Acceptance criteria:
- Desktop and mobile screenshots materially match `landing.png` structure, tone, spacing, and color system.
- Text remains readable over the background image.
- CTA buttons, FAQ rows, and newsletter form have accessible labels/focus states.
- Risk states include text labels and do not rely on color alone.
- No text overlaps or awkward button wrapping at `<480px`, `768px`, `1024px`, and desktop widths.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`
- Run `bun run dev` and capture Playwright screenshots for desktop and mobile comparison against `landing.png`.

Progress:
- Update `PROGRESS.md` with landing implementation notes, visual QA results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with the landing page and design-system changes after validation and before committing.

Commit:
- `feat: build landing page visual system`

### Step 3: Domain Model, Database Schema, and Seed Taxonomy
Goal: Establish the typed domain foundation for audits, source governance, facts, evidence, public pages, and job state transitions.

Depends on:
- Step 0
- Step 1

Changes:
- Add database adapter and ORM setup under `src/server/db/`.
- Add migrations for core tables from `docs/TECH.md` and `docs/DATA_STRATEGY.md`: `users`, `audit_requests`, `audit_inputs`, `audit_runs`, `audit_completeness_checks`, `audit_reports`, `payments`, `entities`, `accommodations`, `areas`, `routes`, `providers`, `source_profiles`, `source_permissions`, `source_records`, `raw_snapshots`, `candidate_entities`, `entity_matches`, `facts`, `evidence`, `reviews`, `fact_confidence_scores`, `source_credibility_scores`, `fact_conflicts`, `refresh_jobs`, `public_pages`, `public_evidence_bundles`, `agent_readable_snapshots`, `llm_runs`, `llm_tool_calls`, `reviewer_results`, and provider/public-page health tables if needed.
- Add typed enums for audit job states, risk levels, source types, allowed-use states, match states, public visibility states, confidence labels, and risk categories.
- Add seed data for Siargao geography, common areas, arrival routes, risk categories, provider categories, service categories, and optional modules.
- Add schema validation types for intake input, completeness check result, risk item, evidence reference, and report output.
- Keep destination-specific rules isolated under `src/server/audit/destinations/siargao/`.

Acceptance criteria:
- Migrations produce a schema that can represent source policy, facts, evidence, audit state, reports, payments, public pages, and LLM/reviewer logs.
- Seed taxonomy supports the mandatory risk categories and optional modules.
- Job state transitions are represented as typed values and cannot use arbitrary strings.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run database migration and seed commands against a local/test database.
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with schema decisions, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with domain model, database, and taxonomy changes after validation and before committing.

Commit:
- `feat: add audit domain schema and taxonomy`

### Step 4: Source Registry, Provider Policy, and Fact Graph Foundations
Goal: Implement the source governance layer that prevents disallowed or weak data from entering paid audits or public pages unchecked.

Depends on:
- Step 0
- Step 1
- Step 3

Changes:
- Implement `src/server/providers/source-registry.ts` for machine-readable source profiles with access method, allowed use, authority level, rate limits, freshness windows, storage permissions, republication permissions, and known stale/SEO risk.
- Implement provider adapter contracts for official pages/APIs, weather, maps/geocoding, accommodation APIs, review/POI APIs, user-submitted evidence, and local partner records.
- Add initial stub or permitted low-risk adapters, prioritizing official/provincial/public-sector and Open-Meteo-style weather data before commercial provider integrations.
- Add fact extraction and normalization types for source records, atomic facts, evidence records, raw snapshot references, and allowed-use metadata.
- Implement separate source credibility and fact confidence scoring utilities.
- Implement conflict detection primitives for area/location mismatch, stale policy conflicts, route/schedule conflicts, and contradictory accommodation facts.
- Add unit tests proving disallowed sources are rejected before fact cache insertion and public publication.

Acceptance criteria:
- No provider data can enter the fact graph without an explicit source profile.
- Source credibility and fact confidence are computed and stored separately.
- Disallowed, internal-only, citation-only, and public-republish facts behave differently in tests.
- Official-source precedence is enforced for policy, fees, accreditation, routes, and public-sector facts.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with source-governance coverage, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with provider policy and fact graph foundation changes after validation and before committing.

Commit:
- `feat: add source registry and fact governance`

### Step 5: Audit Intake, Accommodation Resolution, and Completeness Gate
Goal: Build the intake workflow through one preview risk and a deterministic payment eligibility decision.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Add `src/features/intake/` UI for required fields: travel dates or month, arrival route or origin, planned stay area or accommodation name, top user constraint, and risk tolerance.
- Add optional intake fields for accommodation link/platform, traveler type, group size, children, remote work, surfing, quiet sleep, budget, transport comfort, medical access, food/accessibility constraints, and other PRD modules.
- Implement server actions/API routes to create `audit_requests`, store `audit_inputs`, and start resolving.
- Implement accommodation resolution using permitted provider/local/user-submitted sources and confidence thresholds.
- If resolution fails, return follow-up prompts for listing link, listing text, screenshots, exact address, or host-provided details.
- Implement `audit_completeness_checks` with result shape: `can_complete`, `blocking_reasons`, `preview_risk`, `required_user_followups`, and `evidence_summary`.
- Implement freshness checks and targeted refresh orchestration hooks before payment.
- Display one free preview risk only when evidence is sufficient.
- Block payment when critical inputs, critical facts, or accommodation match confidence are insufficient.
- Add integration tests for incomplete audits, below-threshold accommodation matches, preview risk visibility, optional module activation, and risk tolerance changes.

Acceptance criteria:
- Users can submit the minimum viable intake and see either clear blocking reasons or one preview risk.
- The system never exposes Stripe checkout eligibility unless the completeness gate passes.
- Named accommodation resolution below threshold blocks payment and asks for actionable follow-up evidence.
- The first user-facing flow remains consistent with the landing page CTA and design system.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with intake/completeness behavior, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with intake, resolver, preview, and completeness-gate changes after validation and before committing.

Commit:
- `feat: add audit intake and completeness gate`

### Step 6: Risk Engine, Evidence Bundles, and Report Schema Validation
Goal: Implement deterministic risk structures and validation so generated reports cannot publish unsupported or malformed claims.

Depends on:
- Step 0
- Step 1
- Step 3
- Step 4
- Step 5

Changes:
- Add risk evaluation contracts for mandatory categories: arrival/departure logistics, weather/seasonality, area fit, internet/power, on-island transport, cash/SIM/basic services, and health/safety/admin.
- Add optional module contracts for remote work, family/kids, surfing, quiet sleep, budget, arrival timing, transport comfort, medical access, accessibility, nightlife, food restrictions, sustainability, local fees, live events, closures, and operator trust signals.
- Implement risk ranking by impact, likelihood, fixability, and traveler relevance.
- Define report schema for overall rating, confidence summary, source quality summary, top three risks, full risk table, accommodation assessment, area fit, logistics, weather, internet/power, transport, cash/SIM/services, health/safety/admin, official/accreditation notes, event/closure/fee notes, fixes, host questions, evidence/freshness notes, and limitations.
- Implement evidence bundle creation with valid evidence IDs and public/private restrictions.
- Add deterministic validators for required sections, valid evidence IDs, cited accommodation claims, freshness requirements, payment unlock state, and unsupported public/provider data leakage.
- Add tests for stale critical facts, stale non-critical caveats, invalid evidence IDs, uncited accommodation claims, missing sections, and low-credibility sources supporting consequential claims.

Acceptance criteria:
- Every reportable risk has what might break, why it matters, evidence, freshness/confidence, and a recommended fix.
- Report validation fails on missing required sections, invalid evidence, uncited claims, and payment-state violations.
- Source credibility affects confidence independently from fact freshness.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with risk/report validation coverage, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with risk engine and report schema changes after validation and before committing.

Commit:
- `feat: validate risk reports and evidence`

### Step 7: Stripe Checkout, Webhook Unlock, and Audit Job States
Goal: Add payment gating and asynchronous audit lifecycle state transitions without weakening the no-charge-unless-complete promise.

Depends on:
- Step 0
- Step 1
- Step 3
- Step 5
- Step 6

Changes:
- Add Stripe Checkout session creation only for audits in `complete_for_payment` state.
- Set price to USD 9.99 per trip risk audit.
- Add Stripe webhook verification and persist verified payment events as the source of truth.
- Implement payment records and state transitions: `complete_for_payment`, `awaiting_payment`, `paid`, `generating`, `reviewing`, `published`, `blocked`, and `failed`.
- Add background job runner integration for audit generation, reviewer pass, report publication, retries, and failure preservation.
- Add processing/status page that shows current audit state after payment.
- Add tests that reports never unlock from client-side checkout return alone and only unlock after a verified webhook.
- Add tests preventing impossible states such as `published` without `paid` and `reviewed`.

Acceptance criteria:
- Checkout cannot start for incomplete, blocked, or below-threshold audits.
- Paid report generation starts only after verified Stripe webhook handling.
- Job failures retain diagnostic context for admin/operator review.
- Users see clear processing state after payment.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run Stripe webhook verification tests with fixture payloads.
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with payment/job state behavior, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with Stripe and audit lifecycle changes after validation and before committing.

Commit:
- `feat: add payment-gated audit lifecycle`

### Step 8: LLM Generator, Reviewer Pass, and Final Report UI
Goal: Generate and render evidence-backed paid reports through controlled retrieval tools, reviewer validation, and deterministic checks.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 6
- Step 7

Changes:
- Add server-side LLM adapter under `src/server/llm/` for OpenAI Responses API or Agents SDK.
- Implement controlled read-only retrieval tools: accommodation lookup, accommodation facts, reviews, weather, route risks, area profile, service facts, policy facts, user constraints, source credibility, official-source checks, event/closure signals, environmental/local fees, and operator trust signals.
- Enforce tool budgets, freshness policy, source policy, evidence IDs, confidence/caveats, and private/public restrictions.
- Store `llm_runs`, `llm_tool_calls`, and generated structured report output.
- Add reviewer LLM pass with separate context/prompt and structured corrections for citation support, overclaims, stale caveats, traveler relevance, missing critical risks, tone clarity, and rating rationale.
- Add revision/block behavior based on reviewer result plus deterministic validators.
- Build final report page UI using the sample report design language: overall rating, top risks, category breakdown, recommendations, evidence snapshot, limitations, host questions, and source/freshness notes.
- Add tests with mocked LLM responses, mocked tool calls, reviewer corrections, revision/block paths, and deterministic validator failures.

Acceptance criteria:
- Generator cannot access unsupported provider data or uncited facts.
- Reviewer results can block publication or force correction.
- Final reports expose uncertainty clearly and avoid generic itinerary filler.
- Every important user-visible factual claim cites a valid evidence ID.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with generator/reviewer/report behavior, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with LLM and report UI changes after validation and before committing.

Commit:
- `feat: generate reviewed audit reports`

### Step 9: Admin and Operator Diagnostics
Goal: Give operators enough visibility to inspect blocked audits, provider errors, stale facts, failed matches, reviewer rejections, and cost drivers without reading raw logs.

Depends on:
- Step 0
- Step 1
- Step 3
- Step 4
- Step 5
- Step 7
- Step 8

Changes:
- Add an admin/operator route protected by the chosen auth or environment-gated access model.
- Show blocked audits, failed accommodation matches, provider errors, source freshness issues, completeness fail reasons, reviewer rejections, LLM cost estimates, and job failures.
- Add drill-down views for audit request, evidence summary, source profiles, fact confidence, tool-call logs, and reviewer result.
- Redact sensitive trip/user data where possible and avoid displaying secrets or raw non-republishable provider payloads unless explicitly allowed and access-controlled.
- Add structured logging hooks for provider calls, audit runs, tool calls, reviewer results, and public page generation failures.

Acceptance criteria:
- Operators can diagnose why an audit did not become payable or publishable.
- Sensitive values are redacted from traces and admin UI.
- Admin views do not become a public data leak path.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with admin/diagnostics behavior, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with admin diagnostics changes after validation and before committing.

Commit:
- `feat: add audit diagnostics console`

### Step 10: Public Pages, Agent-Readable Surfaces, Sitemap, and llms.txt
Goal: Publish permitted, source-backed public knowledge surfaces for humans and AI answer engines without exposing private or restricted data.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 6

Changes:
- Implement public page families for accommodations, areas, routes, operators, and risks using only facts that pass public visibility gates.
- For each eligible public entity/topic, generate:
  - Human page.
  - LLM Markdown route such as `/accommodations/[slug]/llm.md`.
  - Structured JSON route such as `/api/public/accommodations/[slug].json`.
  - Public evidence bundle where provider permissions allow.
  - JSON-LD metadata.
  - Canonical URL.
  - Sitemap entry.
  - `llms.txt` index entry when configured.
- Implement public eligibility gate: public republication allowed, confidence above threshold, critical public evidence present, no private user data, no non-republishable raw provider content, and confident/probable canonical entity match.
- Add public read-only API endpoints for entity summaries, evidence bundles, and risk previews with allowed-use enforcement.
- Add `llms.txt` with core public pages and agent-readable indexes from `docs/TECH.md`.
- Add tests proving human pages, LLM Markdown, JSON, and JSON-LD are generated from the same fact records and do not cloak or diverge materially.
- Add tests preventing private paid reports, user inputs, raw provider data, unsupported claims, and low-confidence pages from public surfaces.

Acceptance criteria:
- Public pages make freshness, confidence, source type, canonical URL, and limitations visible.
- Agent-readable content contains the same factual claims as human pages in cleaner parsing format.
- `llms.txt`, sitemap, canonical URLs, and JSON-LD point only to approved public pages.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:
- Update `PROGRESS.md` with public/agent surface behavior, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with public pages, APIs, sitemap, and `llms.txt` changes after validation and before committing.

Commit:
- `feat: publish source-backed public knowledge surfaces`

### Step 11: Observability, Privacy, Rate Limiting, and Security Hardening
Goal: Add production controls for measuring product viability and protecting users, provider credentials, public surfaces, and paid reports.

Depends on:
- Step 0
- Step 1
- Step 3
- Step 4
- Step 5
- Step 7
- Step 8
- Step 9
- Step 10

Changes:
- Add Sentry, PostHog, and structured audit logs according to the final chosen providers.
- Track intake completion, accommodation resolution success, completeness pass/fail reasons, preview-to-payment conversion, payment success, generation latency, provider errors, LLM cost, reviewer rejection rate, report confidence distribution, public page generation failures, agent-readable snapshot freshness, public API usage, indexation/crawl coverage, AI-search referrals where detectable, and top cited public pages.
- Add server-side-only handling for provider credentials, Stripe secrets, OpenAI keys, and webhook secrets.
- Add rate limits for intake, resolution, provider calls, public APIs, and report access endpoints.
- Add privacy controls for user trip data, private paid reports, LLM logs, tool-call traces, raw snapshots, and evidence storage.
- Add noindex/crawl rules for private, duplicate, incomplete, or low-confidence pages.
- Add security tests for webhook validation, public/private data boundaries, public API allowed-use enforcement, rate limiting, and secrets not reaching client bundles.

Acceptance criteria:
- Product viability metrics are captured without leaking private trip details.
- Public pages and APIs cannot expose private paid audit data or restricted provider content.
- Provider credentials and secrets remain server-side.
- Rate limits protect intake, provider calls, and public endpoints.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`
- Run any configured dependency/security audit command added during Step 1 if available.

Progress:
- Update `PROGRESS.md` with observability/security behavior, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with observability, privacy, rate limiting, and security changes after validation and before committing.

Commit:
- `feat: add production observability and safeguards`

### Step 12: End-to-End Release Candidate QA and Documentation
Goal: Validate the complete product promise across landing, intake, completeness, payment, generation, reporting, public pages, and operator diagnostics.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6
- Step 7
- Step 8
- Step 9
- Step 10
- Step 11

Changes:
- Add or update README/developer docs with setup, environment variables, local database, provider policy, Stripe webhook testing, LLM mocking, job worker startup, quality gates, and deployment notes.
- Add a release QA checklist covering:
  - Landing page visual match to `landing.png`.
  - Mobile/responsive behavior.
  - Intake and preview risk flow.
  - Incomplete audit blocking.
  - Stripe webhook unlock.
  - Report generation and reviewer blocking/correction.
  - Evidence and freshness labels.
  - Public page generation and public data boundaries.
  - Admin diagnostics.
  - Observability events.
- Add seed/demo data for local QA that uses only permitted or synthetic evidence.
- Run full end-to-end test suites and manual visual/accessibility checks.
- Document unresolved provider-access decisions and any features that must remain stubbed until API/terms approval.

Acceptance criteria:
- A new developer can run the app locally from README instructions.
- The release candidate demonstrates the no-charge-unless-complete audit lifecycle with mocked or approved providers.
- The landing page, report UI, and public pages pass visual/responsive/accessibility checks.
- Known limitations and open provider approvals are documented clearly.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`
- Run local manual QA with `bun run dev`, desktop/mobile screenshots, and the landing style QA checklist.

Progress:
- Update `PROGRESS.md` with release-candidate QA results, validation results, commit reference if available, current status, and any next recommended phase.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with documentation, demo data, QA, and release-candidate changes after validation and before committing.

Commit:
- `docs: prepare release candidate QA notes`

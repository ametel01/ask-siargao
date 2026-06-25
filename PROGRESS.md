# Google Places Persistence Implementation Progress

## Source Documents

- User prompt inline source document, 2026-06-25
- `docs/DATA_STRATEGY.md`
- `documentation/developer/reference/scripts.md`
- Google Places policies and Google Maps Platform service terms

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Google Places Schema And Migration
- [x] Step 2: Google Places Freshness, Retention, And Field Policy Module
- [x] Step 3: Google Places Capture Repository
- [x] Step 4: Google Provider Adapter Refactor
- [x] Step 5: Answer Context Store DB-First Retrieval
- [x] Step 6: LLM Adapter Answer Context Contract
- [x] Step 7: `/api/chat` Integration
- [ ] Step 8: Retention Cleanup Job And Script
- [ ] Step 9: Documentation And Operator Guidance
- [ ] Step 10: End-To-End Verification Slice

## Current Status

Step 7 is implemented. Step 8 is next.

`PROGRESS.md` must be updated after every completed step with completion notes, validation
results, commit reference if available, current status, and the next step.

## Update Log

### 2026-06-25 - Step 0: Progress and Changelog Tracking Setup

- Created durable progress tracking for the Google Places persistence implementation plan.
- Confirmed `CHANGELOG.md` exists with a Keep a Changelog preamble and `## [Unreleased]`.
- Validation passed:
  - `test -f PROGRESS.md`
  - `test -f CHANGELOG.md`
  - `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`
- Commit: `63dafe1 chore: track google places persistence plan progress`
- Next step: Step 1, Google Places Schema And Migration.

### 2026-06-25 - Step 1: Google Places Schema And Migration

- Added Drizzle and SQL migration tables for Google Places identities, snapshots, typed details,
  and reviews.
- Added foreign keys to source records and canonical entities while leaving the existing fact graph
  tables unchanged.
- Added lookup indexes for place IDs, stale timestamps, and retention-expiry timestamps.
- Updated the migration parity test to require the new table exports.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/db/migration.test.ts`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun test`
  - `bun run build`
  - `bun run test:e2e`
- Note: An initial parallel run of `bun test`, `bun run db:migrate:test`, and
  `bun run db:seed:test` failed because those commands share `.tmp/pglite-step3`; rerunning
  database-affecting checks sequentially passed.
- Commit: `597450b feat: add google places capture schema`
- Next step: Step 2, Google Places Freshness, Retention, And Field Policy Module.

### 2026-06-25 - Step 2: Google Places Freshness, Retention, And Field Policy Module

- Added a central Google Places policy module for explicit field-mask groups, request policies,
  freshness windows, retention windows, reuse states, storage policy labels, and attribution
  metadata.
- Wired existing chat search and details enrichment field masks through the policy module without
  changing provider parsing behavior.
- Added tests proving masks are explicit, stale and retention windows are separate, stale rows can
  still exist before deletion, expired and no-store rows are blocked, place IDs are durable, and
  Places latitude/longitude is limited to 30 days.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/providers/google-places-policy.test.ts`
  - `bun test`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`
- Commit: `9b3c062 feat: add google places freshness policy`
- Next step: Step 3, Google Places Capture Repository.

### 2026-06-25 - Step 3: Google Places Capture Repository

- Added a Google Places store module for DB-first fresh lookup, deterministic source/snapshot/detail
  upserts, review upserts, normalized facts/evidence, reuse checks, and expired content deletion.
- Added deterministic snapshot/fact/evidence identifiers derived from place IDs, request kind, field
  mask, and fetched window.
- Added PGlite-backed tests proving idempotent capture writes, fresh lookup behavior, expired-content
  hiding/deletion, review retention/attribution metadata, and durable `place_id` preservation.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/providers/google-places-store.test.ts`
  - `bun test src/server/providers/google-places-policy.test.ts`
  - `bun test`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`
- Commit: `c920bfb feat: persist google places captures`
- Next step: Step 4, Google Provider Adapter Refactor.

### 2026-06-25 - Step 4: Google Provider Adapter Refactor

- Added capture-ready Google Places chat parsing that preserves typed field data in `captureJson`
  while keeping the existing chat context shape compatible.
- Added a capture-ready Place Details enrichment path with injectable fetcher, timestamp, and
  explicit enterprise/atmosphere field masks.
- Added review-bearing details parsing for reviews, pricing, ratings, opening hours, contact
  fields, location, amenities, payment/parking options, and attributions.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/providers/google-places-chat.test.ts`
  - `bun test src/server/providers/google-places-enrichment.test.ts`
  - `bun test src/server/providers/google-places-store.test.ts`
  - `bun test`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`
- Commit: `ac1469c feat: make google places adapters capture ready`
- Next step: Step 5, Answer Context Store DB-First Retrieval.

### 2026-06-25 - Step 5: Answer Context Store DB-First Retrieval

- Added `AnswerContextStore` with deterministic Google Places requirement planning, fresh DB lookup,
  refresh-policy gating, injected Google adapter support, capture persistence, bounded answer facts,
  evidence summaries, freshness labels, live-refresh counts, and gap reporting.
- Added DB-backed tests proving fresh stored Google rating, review-count, price, and map facts avoid
  provider calls; stale rows refresh and persist replacement data; expired rows are not sent forward;
  and blocked live refreshes return gaps.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/answer-context-store.test.ts`
  - `bun test src/server/providers/google-places-store.test.ts`
  - `bun test`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`
- Commit: `86b915b feat: add db first answer context store`
- Next step: Step 6, LLM Adapter Answer Context Contract.

### 2026-06-25 - Step 6: LLM Adapter Answer Context Contract

- Updated the Ask Siargao chat adapter to accept bounded `answerContext` facts, evidence,
  source-freshness labels, refresh counts, cost estimates, and gaps.
- Added prompt constraints requiring live/provider-specific claims to come only from
  `answerContext`, requiring Google gaps to be stated, and forbidding direct Google bypasses.
- Added Google Maps fallback-link support for map-link facts in `answerContext`.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/llm/chat-adapter.test.ts`
  - `bun test src/server/chat/answer-context-store.test.ts`
  - `bun test`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`
- Commit: `a9bdcdf feat: constrain chat generation to answer context`
- Next step: Step 7, `/api/chat` Integration.

### 2026-06-25 - Step 7: `/api/chat` Integration

- Replaced direct Google Places chat lookup dependencies in `/api/chat` with injected
  `AnswerContextStore.getOrRefresh` retrieval.
- Added request-scoped user message IDs for answer-context calls while preserving existing weather
  context behavior.
- Updated chat route tests to prove restaurant recommendation questions receive DB-first bounded
  answer context and ordinary chat does not request Google context.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/app/api/chat/route.test.ts`
  - `bun test src/server/chat/answer-context-store.test.ts`
  - `bun test`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`
- Commit: pending.
- Next step: Step 8, Retention Cleanup Job And Script.

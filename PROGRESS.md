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
- [ ] Step 3: Google Places Capture Repository
- [ ] Step 4: Google Provider Adapter Refactor
- [ ] Step 5: Answer Context Store DB-First Retrieval
- [ ] Step 6: LLM Adapter Answer Context Contract
- [ ] Step 7: `/api/chat` Integration
- [ ] Step 8: Retention Cleanup Job And Script
- [ ] Step 9: Documentation And Operator Guidance
- [ ] Step 10: End-To-End Verification Slice

## Current Status

Step 2 is implemented. Step 3 is next.

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
- Commit: pending.
- Next step: Step 3, Google Places Capture Repository.

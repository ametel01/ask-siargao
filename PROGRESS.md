# Priority 6 Safe Database And Local Knowledge Tools Progress

## Source Documents

- `/Users/alexmetelli/source/ask-siargao/PLAN.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`

## Tracking Rules

- Update this file after every completed implementation step.
- Record validation commands and results for each completed step.
- Record commit references when they are available.
- Keep `CHANGELOG.md` updated after validation and before each step commit.

## Current Status

- Current step: Step 3, display-safe source evidence lookup.
- Next step: Implement source evidence lookup for fact IDs without exposing restricted
  provider payloads or private records.

## Step Checklist

- [x] Step 0: Progress and changelog tracking setup.
- [x] Step 1: Safe local data contracts and schema dictionary.
- [x] Step 2: Structured local fact query engine.
- [ ] Step 3: Display-safe source evidence lookup.
- [ ] Step 4: Register safe database tools in the agent runtime.
- [ ] Step 5: Align agent memory and tool-use documentation.
- [ ] Step 6: Final integration, regression gates, and release notes.

## Update Log

### 2026-06-27 - Step 0 Complete

- Created `PROGRESS.md` with source documents, tracking rules, current status, step
  checklist, and update log.
- Updated `CHANGELOG.md` with the Priority 6 progress/changelog tracking entry.
- Validation:
  - Passed: `test -f PROGRESS.md`.
  - Passed: `test -f CHANGELOG.md`.
  - Passed: manual inspection for required structure.
- Commit: pending.

### 2026-06-27 - Step 1 Complete

- Added `src/server/chat/local-data-tools.ts` with the safe tool-facing schema
  dictionary, local fact result contracts, display-safe evidence result contracts, and
  zod argument schemas for `describe_database_schema`, `query_local_facts`, and
  `get_source_evidence`.
- Added `src/server/chat/local-data-tools.test.ts` coverage for approved surfaces,
  field descriptions, query rules, restricted-name exclusion, and local fact query limit
  capping.
- Validation:
  - Passed: `bun run format`.
  - Passed: `bun run lint`.
  - Passed: `bun run typecheck --incremental false`.
  - Passed: `bun test src/server/chat/local-data-tools.test.ts`.
  - Passed: `bun test`.
- Commit: pending.

### 2026-06-27 - Step 2 Complete

- Added `queryLocalFacts` with strict structured query parsing, capped limits,
  curated beach fact mapping, optional injected database access, approved SQL shapes
  for areas/routes/governed facts, and allowlisted serializers.
- Extended local-data tests for General Luna beach filtering, sandy/swimming/rain-fit/sunset
  tags, entity-type filtering, text filtering, limit capping, injected route/fact rows,
  and raw/private field leakage guards.
- Validation:
  - Passed: `bun run format`.
  - Passed: `bun run lint`.
  - Passed: `bun run typecheck --incremental false`.
  - Passed: `bun test src/server/chat/local-data-tools.test.ts`.
  - Passed: `bun run db:migrate:test && bun run db:seed:test`.
  - Passed: `bun test`.
- Commit: pending.

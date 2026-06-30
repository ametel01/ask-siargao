# Web Research Layer Progress

Source plan: `PLAN.md`
Source design doc: `documentation/developer/explanation/web-research-layer.md`

## Current Status

- Status: Step 2 complete
- Current step: Implement Deterministic Research Scoring Without Network Calls
- Next step: Step 3 - Implement Deterministic Research Scoring Without Network Calls

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Baseline Quality Gates
- [x] Step 2: Add Web Research Types And Source Labels
- [ ] Step 3: Implement Deterministic Research Scoring Without Network Calls
- [ ] Step 4: Register `research_web` As A Chat Tool
- [ ] Step 5: Enforce Web Research Source Consistency
- [ ] Step 6: Add General Research Intent And Required Evidence Planning
- [ ] Step 7: Enforce Research-Before-Enrichment Runtime Ordering
- [ ] Step 8: Convert Places To Entity-Specific Enrichment
- [ ] Step 9: Reject Legacy Final Answers For Research-Required Prompts
- [ ] Step 10: Wire The Production Web Search Provider
- [ ] Step 11: Add Optional Short-Lived Research Persistence
- [ ] Step 12: Update Agent Memory And Developer Documentation
- [ ] Step 13: Cross-Domain Regression And Release Gates

## Update Rule

Update this file after every completed step with:

- completed step and summary;
- validation commands and results;
- commit reference if available;
- current status;
- next step.

## Update Log

### 2026-07-01 - Step 0 Started

- Created progress tracking for the web research layer implementation goal.
- Next action: validate `PROGRESS.md` and `CHANGELOG.md`, then mark Step 0 complete.

### 2026-07-01 - Step 0 Completed

- Validation passed:
  - `test -f PROGRESS.md`
  - `test -f CHANGELOG.md`
  - `rg -n "Web Research Layer|Step 0|Step 1" PROGRESS.md`
  - `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Track web research implementation progress`).
- Next step: Step 1 - Baseline Quality Gates.

### 2026-07-01 - Step 1 Completed

- Baseline validation passed:
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test` - 656 tests passed
  - `bun run db:migrate:test` - migrated 47 tables
  - `bun run db:seed:test` - seeded 5 areas, 3 routes, and 6 source profiles
  - `bun run build`
  - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= CLERK_SECRET_KEY= CLERK_WEBHOOK_SIGNING_SECRET= bun run test:e2e` - 36 tests passed
- Local caveat: default `bun run test:e2e` timed out waiting for Playwright's web server readiness
  because the workstation `.env` enables Clerk middleware and `/robots.txt` readiness requests hit
  Clerk proxy socket errors. The sanitized e2e command above passed.
- Changelog: no entry required for baseline-only validation.
- Commit reference: this commit (`Record web research baseline gates`).
- Next step: Step 2 - Add Web Research Types And Source Labels.

### 2026-07-01 - Step 2 Completed

- Added the typed `research_web` contract, public web-research source labels, schema mirrors, and
  source-policy descriptions.
- Preserved the prerequisite chat-source cleanup already in the worktree for current nightlife
  prompts: no-current-event-facts is not treated as checked event evidence, and loaded
  `NIGHTLIFE.md` baseline guidance is kept separate from current public evidence.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/answer-source-summary.test.ts src/server/chat/agent-tools.test.ts src/server/trips/shared-trip-types.test.ts src/server/chat/condition-tools.test.ts` - 98 tests passed
  - `bun test` - 657 tests passed
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Add web research source contracts`).
- Next step: Step 3 - Implement Deterministic Research Scoring Without Network Calls.

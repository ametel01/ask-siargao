# Web Research Layer Progress

Source plan: `PLAN.md`
Source design doc: `documentation/developer/explanation/web-research-layer.md`

## Current Status

- Status: Step 10 complete
- Current step: Add Optional Short-Lived Research Persistence
- Next step: Step 11 - Add Optional Short-Lived Research Persistence

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Baseline Quality Gates
- [x] Step 2: Add Web Research Types And Source Labels
- [x] Step 3: Implement Deterministic Research Scoring Without Network Calls
- [x] Step 4: Register `research_web` As A Chat Tool
- [x] Step 5: Enforce Web Research Source Consistency
- [x] Step 6: Add General Research Intent And Required Evidence Planning
- [x] Step 7: Enforce Research-Before-Enrichment Runtime Ordering
- [x] Step 8: Convert Places To Entity-Specific Enrichment
- [x] Step 9: Reject Legacy Final Answers For Research-Required Prompts
- [x] Step 10: Wire The Production Web Search Provider
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

### 2026-07-01 - Step 3 Completed

- Implemented deterministic no-network web research query expansion, source classification,
  source scoring, bounded finding extraction, entity extraction hints, insufficient-evidence
  handling, and provider-unavailable shaping.
- Added regression coverage for nightlife/event, restaurant, ferry/transport, tour price,
  safety/disruption, official-vs-guide ranking, negative evidence, stale weak sources, non-nightlife
  current recommendations, and restricted payload exclusion.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/web-research.test.ts` - 12 tests passed
  - `bun test` - 669 tests passed
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Add deterministic web research scoring`).
- Next step: Step 4 - Register `research_web` As A Chat Tool.

### 2026-07-01 - Step 4 Completed

- Registered `research_web` as a strict backend chat tool with nullable provider-valid arguments,
  Zod validation, dependency-injected public web research provider slots, bounded model-facing
  text/data, and source summaries for available, insufficient, and provider-unavailable states.
- Added tests for strict schema shape, nullable arguments, successful research output,
  insufficient web evidence, provider-unavailable behavior, and restricted payload exclusion.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/agent-tools.test.ts src/server/chat/web-research.test.ts` - 79 tests passed
  - `bun test` - 672 tests passed
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Register web research chat tool`).
- Next step: Step 5 - Enforce Web Research Source Consistency.

### 2026-07-01 - Step 5 Completed

- Enforced source consistency for `web_researched`, `official_checked`, `directory_checked`, and
  `insufficient_web_evidence`.
- Public web labels now require successful `research_web` tool evidence; memory retrieval, generic
  reasoning, wrong-tool output, and community-to-official upgrades are rejected.
- `insufficient_web_evidence` is accepted only as a terminal not-checked research state and cannot
  render as checked positive evidence.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/source-consistency.test.ts src/app/api/chat/route.test.ts` - 114 tests passed
  - `bun test` - 677 tests passed
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Validate web research source labels`).
- Next step: Step 6 - Add General Research Intent And Required Evidence Planning.

### 2026-07-01 - Step 6 Completed

- Added deterministic `researchIntent` signals for current recommendations, schedules,
  availability/closures, prices/current rates, safety/disruptions/advisories, and current
  comparisons.
- Extended required-evidence planning with `research_web`, accepted/terminal web source labels, and
  dependency metadata for downstream Places/weather/nightlife enrichment.
- Added focused `required-evidence` tests and route-boundary tests for nightlife, restaurant,
  ferry/transport schedule, tour price, safety/disruption, and stable beach recommendations that do
  not require public web research.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/app/api/chat/route.test.ts src/server/chat/ask-siargao-agent.test.ts src/server/chat/required-evidence.test.ts` - 160 tests passed
  - `bun test` - 685 tests passed
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Plan required web research for current prompts`).
- Next step: Step 7 - Enforce Research-Before-Enrichment Runtime Ordering.

### 2026-07-01 - Step 7 Completed

- Staged missing required evidence by dependency so downstream Places/weather/nightlife enrichment
  waits for satisfying `research_web` evidence.
- Updated runtime preflight and batch execution so model-requested early Places calls run after
  `research_web`, and dependent enrichment is skipped when research returns insufficient or
  provider-unavailable evidence.
- Added runtime regressions for research-before-Places ordering and skipped dependent Places after
  insufficient web research.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/ask-siargao-agent.test.ts src/server/chat/required-evidence.test.ts` - 87 tests passed
  - `bun test` - 687 tests passed
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Enforce research before enrichment`).
- Next step: Step 8 - Convert Places To Entity-Specific Enrichment.

### 2026-07-01 - Step 8 Completed

- Converted Google Places calls for research-covered recommendation prompts into entity-specific
  enrichment based on `research_web` selected entities.
- Skipped Places enrichment when successful public web research produced no enrichable entities,
  instead of allowing broad Places candidates as fallback cards.
- Filtered required Places artifacts so mixed selected/unrelated card IDs expose only cards matching
  research-selected entities.
- Preserved broad Places behavior for prompts that do not require `research_web`.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/ask-siargao-agent.test.ts src/server/chat/agent-runtime.test.ts src/server/chat/required-evidence.test.ts` - 121 tests passed
  - `bun test` - 689 tests passed
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Use Places as research entity enrichment`).
- Next step: Step 9 - Reject Legacy Final Answers For Research-Required Prompts.

### 2026-07-01 - Step 9 Completed

- Added final-payload validation so successful `research_web` evidence must be cited by tool call
  and reflected in the traveler-facing answer.
- Required insufficient or unavailable public web research to produce transparent caveats with no
  place cards, preventing weather-only, memory-only, or broad Places fallback answer shapes.
- Extended repair guidance so models recover by leading with researched findings when available, or
  by saying current public evidence could not be verified when research is insufficient.
- Added required-evidence and runtime regressions for omitted research findings, weather-only
  fallback prose after insufficient research, and card-free terminal research failure answers.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/ask-siargao-agent.test.ts src/server/chat/required-evidence.test.ts src/app/api/chat/route.test.ts` - 168 tests passed
  - `bun test` - 693 tests passed
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Reject legacy fallbacks for researched prompts`).
- Next step: Step 10 - Wire The Production Web Search Provider.

### 2026-07-01 - Step 10 Completed

- Added `src/server/providers/web-search.ts`, a repo-owned web research provider adapter for
  OpenAI Responses hosted `web_search`.
- Kept public web research explicitly opt-in with `WEB_RESEARCH_PROVIDER=openai`; unconfigured
  environments continue returning `provider_unavailable` from `research_web`.
- Wired the default chat agent runtime to use the configured provider when present, while preserving
  injected fake providers for deterministic tests.
- Added provider tests for opt-in behavior, hosted tool request shape, structured source parsing,
  malformed output handling, and restricted payload exclusion.
- Documented `WEB_RESEARCH_PROVIDER` and `OPENAI_WEB_SEARCH_MODEL` in the environment reference.
- Validation passed:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test src/server/chat/agent-tools.test.ts src/server/chat/web-research.test.ts src/server/providers/web-search.test.ts` - 82 tests passed
  - `bun test` - 696 tests passed
  - `bun run build`
- Changelog updated under `## [Unreleased]`.
- Commit reference: this commit (`Wire configurable web search provider`).
- Next step: Step 11 - Add Optional Short-Lived Research Persistence.

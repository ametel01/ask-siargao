# Priority 9: Weather, Tide, And Surf Fusion Progress

This file tracks execution of `PLAN.md` for the Priority 9 implementation slice.

## Source Documents

- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`

## Tracking Rules

- Update this file after each completed plan step.
- Record validation commands and results before committing a completed step.
- Record the commit reference after each step commit when available.
- Preserve unrelated user-owned working-tree changes.

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Baseline Characterization And Contracts
- [x] Step 2: Condition Judgment Builder
- [x] Step 3: Agent Tool Schema And Execution
- [ ] Step 4: Agent Tool-Use Policy And Route Signals
- [ ] Step 5: Route, Runtime, And Source Consistency Integration
- [ ] Step 6: Chat UI Rendering For Condition Evidence
- [ ] Step 7: Final Verification And Handoff

## Current Status

- Active step: Step 4
- Next step: Step 4 agent tool-use policy and route signals
- Notes: `docs/ASK_SIARGAO_ROADMAP.md` has an unrelated Priority 8 completion marker and should not
  be included in Priority 9 commits unless explicitly requested or updated at final verification.

## Update Log

### Step 0: Progress and Changelog Tracking Setup

- Status: Complete
- Changes:
  - Restored Priority 9 progress tracking in `PROGRESS.md`.
  - Added an `Unreleased` changelog entry for Priority 9 tracking.
  - Corrected the current workspace note in `PLAN.md`.
- Validation:
  - Passed: `test -f PROGRESS.md`
  - Passed: `test -f CHANGELOG.md`
  - Passed: `rg -n "Priority 9|Weather, Tide, And Surf Fusion" PROGRESS.md CHANGELOG.md`
  - Passed: `bun run format`
  - Passed: `bun run lint`
  - Passed: `bun run typecheck --incremental false`
  - Passed: `bun test` with 370 tests passing
- Commit: `Track weather tide surf fusion plan`

### Step 1: Baseline Characterization And Contracts

- Status: Complete
- Changes:
  - Added `src/server/chat/condition-tools.ts` with condition signal, condition judgment, request,
    source summary, and future tool-parameter contracts.
  - Added characterization tests for complete judgment shape, supported activities and
    recommendations, nullable strict-schema arguments, and explicitly unchecked tide/surf signals.
  - Added a strict-schema audit test for the future `get_condition_judgment` parameters without
    exposing the tool to the agent yet.
  - Added source-consistency coverage for not-verified condition caveats and TODO tests for later
    tool-backed weather and marine-provider enforcement.
- Validation:
  - Passed: `bun run format`
  - Passed: `bun run lint`
  - Passed: `bun run typecheck --incremental false`
  - Passed:
    `bun test src/server/chat/condition-tools.test.ts src/server/chat/source-consistency.test.ts src/server/chat/agent-tools.test.ts`
  - Passed: `bun test` with 376 tests passing and 2 TODO tests
  - Passed: `bun run build`
- Commit: `Characterize condition judgment contracts`

### Step 2: Condition Judgment Builder

- Status: Complete
- Changes:
  - Implemented `buildConditionJudgment` with governed weather, tide, surf, road, and curated local
    caveat signals.
  - Added Open-Meteo threshold helpers for precipitation probability, rain amount, wind speed, and
    wind gust.
  - Kept tide, surf, swell, currents, roads, lifeguards, and official warnings explicitly unchecked
    unless a provider exists.
  - Added activity-specific recommendation logic and alternatives for swimming, surfing, scooter,
    rain-plan, sunset, and boat-trip judgments.
  - Added provider-unavailable handling that returns conservative local-confirmation judgments.
- Validation:
  - Passed: `bun run format`
  - Passed: `bun run lint`
  - Passed: `bun run typecheck --incremental false`
  - Passed: `bun test src/server/chat/condition-tools.test.ts src/server/providers/open-meteo.test.ts`
  - Passed: `bun test` with 382 tests passing and 2 TODO tests
  - Passed: `bun run build`
- Commit: `Add condition judgment builder`

### Step 3: Agent Tool Schema And Execution

- Status: Complete
- Changes:
  - Added `get_condition_judgment` to the agent tool union, strict Responses tool registry, default
    model-callable tool list, and available-tool descriptions.
  - Executed the tool through existing Open-Meteo weather snapshots and curated local guide caveats.
  - Returned model-facing condition evidence in `data.judgment`, source summaries, and concise tool
    text without rendering final traveler prose.
  - Added provider-operation audit mapping for condition judgment tool calls.
  - Updated source-consistency validation so weather claims can be backed by the condition tool while
    tide, surf, swell, and current claims remain uncheckable until provider-backed tools exist.
- Validation:
  - Passed: `bun run format`
  - Passed: `bun run lint`
  - Passed: `bun run typecheck --incremental false`
  - Passed:
    `bun test src/server/chat/agent-tools.test.ts src/server/chat/ask-siargao-agent.test.ts src/server/chat/source-consistency.test.ts`
  - Passed: `bun test` with 387 tests passing
  - Passed: `bun run build`
- Commit: `Expose condition judgment tool`

# Model-Owned Chat Routing Progress

Source plan: `PLAN.md`
Source brief: inline prompt supplied in this chat on 2026-07-01.

## Current Status

- Status: Step 3 complete
- Current step: Step 4 - Remove Route-Derived Required Evidence Planning
- Next step: Step 4 - Remove Route-Derived Required Evidence Planning

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Fix Web Research Structured Output Schema
- [x] Step 2: Add Behavioral Regression Tests for Model-Owned Routing
- [x] Step 3: Trim Route-Level Deterministic Signals
- [ ] Step 4: Remove Route-Derived Required Evidence Planning
- [ ] Step 5: Remove Auto-Injected Required Evidence Repairs From Route Classifiers
- [ ] Step 6: Make Provider Failures Non-Terminal
- [ ] Step 7: Strengthen Model Tool-Choice Instructions
- [ ] Step 8: Preserve and Extend Source Validation
- [ ] Step 9: Remove or Quarantine Brittle Classifier Tests and Dead Routing Helpers
- [ ] Step 10: Documentation, Final Gates, and Handoff

## Update Rule

Update this file after every completed step with:

- completed step and summary;
- validation commands and results;
- commit reference if available;
- current status;
- next step.

## Update Log

### 2026-07-01 - Step 0 Started

- Replaced the previous completed web-research implementation progress tracker with the active
  model-owned chat routing plan checklist from `PLAN.md`.
- Preserved the required update rule so progress, validation, and commit references are recorded
  after every completed step.
- Next action: validate `PROGRESS.md` and `CHANGELOG.md`, run Step 0 gates, update this entry with
  results, and commit Step 0.

### 2026-07-01 - Step 0 Completed

- Created current progress tracking for the model-owned chat routing implementation plan and kept
  `CHANGELOG.md` under `## [Unreleased]` updated for the tracking setup.
- Validation passed:
  - `test -f PROGRESS.md`
  - `test -f CHANGELOG.md`
  - `rg -n "Model-Owned Chat Routing|Step 0|Step 1" PROGRESS.md`
  - `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test` - 702 tests passed
- Commit reference: this commit (`Track model-owned chat routing plan progress`).
- Next step: Step 1 - Fix Web Research Structured Output Schema.

### 2026-07-01 - Step 1 Completed

- Updated the OpenAI web research provider JSON schema so result objects and nested entity objects
  list every property in `required`, with optional values represented as nullable strict-schema
  properties.
- Added provider regression coverage that inspects the outgoing schema shape and verifies nullable
  optional values still parse without surfacing `null` fields in normalized provider results.
- Validation passed:
  - `bun test src/server/providers/web-search.test.ts` - 6 tests passed
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test` - 704 tests passed
- Commit reference: this commit (`Fix web research strict schema`).
- Next step: Step 2 - Add Behavioral Regression Tests for Model-Owned Routing.

### 2026-07-01 - Step 2 Completed

- Added behavior-level scooter rental regressions covering route-boundary intent, model-selected
  `research_web` and `search_places` calls, provider-failure recovery, web-only fallback after
  Places failure, and source validation for unsupported `live_checked` labels.
- Expected focused failures recorded for later implementation steps:
  - `bun test src/app/api/chat/route.test.ts` fails because `where can I rent a scooter in General Luna?`
    still reaches the agent with `conditionActivity: "scooter"`.
  - `bun test src/server/chat/ask-siargao-agent.test.ts` fails because failed model-selected
    `research_web` still triggers the terminal generic web-evidence fallback even when
    `search_places` succeeds.
- Validation passed:
  - `bun test src/server/chat/source-consistency.test.ts` - 43 tests passed
  - `bun test src/server/chat/required-evidence.test.ts` - 10 tests passed
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
- Changelog: no entry because this step is regression coverage only under the current changelog
  policy.
- Commit reference: this commit (`Add model-owned routing regressions`).
- Next step: Step 3 - Trim Route-Level Deterministic Signals.

### 2026-07-01 - Step 3 Completed

- Changed `/api/chat` agent input so route interpretation is logged internally but model-facing
  `deterministicSignals` now contains safe `clientContext`, safe `context`, and `scope` fields
  instead of a route-derived `intent` object.
- Removed model-facing tool-routing hints including `conditionActivity`, `placeIntent`,
  `researchIntent`, `weatherSensitive`, `roadCondition`, `marineCondition`, `activityPlan`, and
  related classifier fields from the route-to-agent payload.
- Validation passed:
  - `bun test src/app/api/chat/route.test.ts` - 76 tests passed
  - `bun run lint`
  - `bun run typecheck --incremental false`
- Validation with known remaining failure:
  - `bun test` - 708 passed, 1 failed:
    `Ask Siargao Responses tool-loop runtime > keeps successful Places evidence when model-selected web research fails`.
  - Status: expected failure from Step 2 provider-failure regression; planned for Step 6.
- Changelog: updated under `Changed` for the functional route signal behavior change.
- Commit reference: this commit (`Stop passing deterministic chat routing intent`).
- Next step: Step 4 - Remove Route-Derived Required Evidence Planning.

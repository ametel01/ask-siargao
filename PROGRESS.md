# Model-Owned Chat Routing Progress

Source plan: `PLAN.md`
Source brief: inline prompt supplied in this chat on 2026-07-01.

## Current Status

- Status: Step 10 complete
- Current step: Done
- Next step: Handoff

## Step Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Fix Web Research Structured Output Schema
- [x] Step 2: Add Behavioral Regression Tests for Model-Owned Routing
- [x] Step 3: Trim Route-Level Deterministic Signals
- [x] Step 4: Remove Route-Derived Required Evidence Planning
- [x] Step 5: Remove Auto-Injected Required Evidence Repairs From Route Classifiers
- [x] Step 6: Make Provider Failures Non-Terminal
- [x] Step 7: Strengthen Model Tool-Choice Instructions
- [x] Step 8: Preserve and Extend Source Validation
- [x] Step 9: Remove or Quarantine Brittle Classifier Tests and Dead Routing Helpers
- [x] Step 10: Documentation, Final Gates, and Handoff

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

### 2026-07-01 - Step 4 Completed

- Removed route-derived required-evidence planning from `buildRequiredEvidencePlan()`, including
  helpers that converted deterministic `placeIntent`, `researchIntent`, weather, and nightlife
  signals into mandatory tool calls.
- Reworked required-evidence tests so plan construction verifies that route classifier signals do
  not manufacture tool requirements, while validation and card filtering are covered through
  explicit plan fixtures.
- Updated the nightlife event test that previously derived party lookup arguments from required
  evidence planning so it now exercises the event lookup directly.
- Validation passed:
  - `bun test src/server/chat/required-evidence.test.ts` - 8 tests passed
  - `bun test src/server/chat/nightlife-events.test.ts` - 6 tests passed
  - `bun run lint`
  - `bun run typecheck --incremental false`
- Validation with expected remaining failures:
  - `bun test src/server/chat/ask-siargao-agent.test.ts` - 74 passed, 15 failed.
  - `bun test` - 692 passed, 15 failed.
  - Status: failures are legacy route-derived automatic required-evidence repair expectations
    queued for Step 5, plus the existing model-selected web research provider-failure regression
    queued for Step 6.
- Changelog: updated under `Removed` for the functional required-evidence planning removal.
- Commit reference: this commit (`Remove route-derived required evidence planning`).
- Next step: Step 5 - Remove Auto-Injected Required Evidence Repairs From Route Classifiers.

### 2026-07-01 - Step 5 Completed

- Removed the agent runtime path that auto-executed `missingRequiredEvidenceToolCalls()` after a
  final answer attempt.
- Removed required-evidence preflight injection that prepended classifier-derived `research_web` or
  `search_nightlife_events` calls before model-selected tool calls.
- Added an active runtime regression proving deterministic dinner/research signals no longer
  synthesize automatic required-evidence tool calls.
- Marked legacy route-derived automatic evidence tests inactive pending the later brittle
  classifier-test cleanup step.
- Validation passed:
  - `bun test src/server/chat/required-evidence.test.ts` - 8 tests passed
  - `bun run lint`
  - `bun run typecheck --incremental false`
- Validation with expected remaining failure:
  - `bun test src/server/chat/ask-siargao-agent.test.ts` - 75 passed, 14 skipped, 1 failed:
    `Ask Siargao Responses tool-loop runtime > keeps successful Places evidence when model-selected web research fails`.
  - `bun test` - 693 passed, 14 skipped, 1 failed with the same known provider-failure
    regression.
  - Status: remaining failure is queued for Step 6.
- Changelog: updated under `Removed` for the functional automatic required-evidence repair removal.
- Commit reference: this commit (`Remove automatic classifier evidence repairs`).
- Next step: Step 6 - Make Provider Failures Non-Terminal.

### 2026-07-01 - Step 6 Completed

- Removed the terminal web-research fallback short-circuit so provider-unavailable `research_web`
  results remain model-visible tool outputs.
- Preserved model-selected provider-failure recovery: successful Places evidence can answer when
  web research fails, and successful web research can answer when Places fails.
- Removed private fallback helpers that generated fixed generic public-web failure prose before the
  model could write the final answer.
- Validation passed:
  - `bun test src/server/chat/ask-siargao-agent.test.ts --test-name-pattern "keeps successful Places evidence|keeps successful web research|provider failures"` -
    3 passed, 2 skipped
  - `bun test src/server/chat/ask-siargao-agent.test.ts` - 76 passed, 14 skipped
  - `bun test src/app/api/chat/route.test.ts` - 76 tests passed
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test` - 694 passed, 14 skipped
- Changelog: updated under `Changed` for non-terminal provider-failure handling.
- Commit reference: this commit (`Let model handle provider failures`).
- Next step: Step 7 - Strengthen Model Tool-Choice Instructions.

### 2026-07-01 - Step 7 Completed

- Updated agent instructions so deterministic signals are safe context and scope flags only, while
  the model owns tool choice, query wording, and whether a prompt needs web, Places, weather,
  condition, memory, or no tools.
- Added model-facing guidance for local service lookups such as scooter rental in General Luna and
  for using successful provider evidence when another provider fails.
- Updated `research_web` and `search_places` tool descriptions to emphasize model-owned
  natural-language query formulation and non-terminal provider-failure handling.
- Validation passed:
  - `bun test src/server/chat/ask-siargao-agent.test.ts --test-name-pattern "structured final payload|scooter rental"` -
    3 tests passed
  - `bun test src/server/chat/ask-siargao-agent.test.ts` - 76 passed, 14 skipped
  - `bun test src/server/chat/agent-tools.test.ts` - 67 tests passed
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test` - 694 passed, 14 skipped
- Changelog: updated under `Changed` for model-owned tool-choice instructions.
- Commit reference: this commit (`Guide model-owned chat tool choice`).
- Next step: Step 8 - Preserve and Extend Source Validation.

### 2026-07-01 - Step 8 Completed

- Tightened source consistency so `provider_unavailable` source labels cannot carry checked facts.
- Kept failed `research_web` output from backing `official_checked`, `directory_checked`, or
  `web_researched` claims.
- Changed artifact selection so recommendation cards from failed provider outputs are not selectable
  while failure sources and unavailable decision summaries remain available for caveated answers.
- Validation passed:
  - `bun test src/server/chat/source-consistency.test.ts` - 45 tests passed
  - `bun test src/server/chat/agent-runtime.test.ts --test-name-pattern "failed provider|unknown selected artifact"` -
    3 tests passed
  - `bun test src/server/chat/ask-siargao-agent.test.ts --test-name-pattern "cross-request answer-quality"` -
    1 test passed
  - `bun test src/app/api/chat/route.test.ts` - 76 tests passed
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test` - 697 passed, 14 skipped
- Changelog: updated under `Changed` for the functional source-governance behavior change.
- Commit reference: this commit (`Preserve source validation for model routing`).
- Next step: Step 9 - Remove or Quarantine Brittle Classifier Tests and Dead Routing Helpers.

### 2026-07-01 - Step 9 Completed

- Removed stale skipped agent scenarios that encoded automatic route-derived evidence preflight and
  repair behavior.
- Removed the agent runtime's reads of old `deterministicSignals.intent` tool-routing fields for
  condition and itinerary repair paths.
- Replaced those repair inputs with prompt-text and safe-context inference, including guards for
  scooter rental, itinerary review, surf memory, and provider-unavailable condition checks.
- Simplified required-evidence plan construction coverage to use safe deterministic request
  context instead of classifier-shaped intent fixtures.
- Validation passed:
  - `rg -n "test\\.skip|auto_preflight_required_evidence|automaticRequiredEvidenceChecks" src/server/chat src/app/api/chat` -
    no matches
  - `rg -n "conditionActivity|placeIntent|researchIntent|weatherSensitive" src/app/api/chat src/server/chat` -
    remaining matches are route-internal interpretation/logging and route-boundary assertions that
    those fields are not model-facing
  - `bun test src/server/chat/ask-siargao-agent.test.ts` - 76 tests passed
  - `bun test src/server/chat/required-evidence.test.ts` - 8 tests passed
  - `bun test src/app/api/chat/route.test.ts` - 76 tests passed
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test` - 697 tests passed
- Changelog: updated under `Removed` for stale deterministic route-intent handling.
- Commit reference: this commit (`Remove stale deterministic routing helpers`).
- Next step: Step 10 - Documentation, Final Gates, and Handoff.

### 2026-07-01 - Step 10 Completed

- Added developer documentation for model-owned chat tool choice, safe deterministic signal
  boundaries, provider-failure behavior, source-label validation, artifact selection, and ownership
  modules.
- Updated the developer documentation index to link the new routing/source-governance explanation
  and align the web-research description with model-owned tool choice.
- Fixed public document route middleware matching so `robots.txt`, `sitemap.xml`, and `llm.md`
  surfaces bypass Clerk middleware while API routes remain covered.
- Made the Playwright web server command clear Clerk keys so local e2e runs stay deterministic when
  `.env` contains Clerk credentials.
- Validation passed:
  - `bun run format`
  - `bun run test:e2e` - 37 tests passed
  - `bun run verify:ci` - passed, including:
    - `bun run verify`
    - `bun run db:migrate:test`
    - `bun run db:seed:test`
    - `bun run build`
    - `bun run test:e2e` - 37 tests passed
  - `bun test` within `verify:ci` - 697 tests passed
- Changelog: updated only for the functional public-route middleware fix. No changelog entry was
  added for the docs, progress, test, or validation-only work under the current changelog policy.
- Commit reference: this commit (`Document model-owned chat routing`).
- Next step: Handoff.

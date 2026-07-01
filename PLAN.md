# Implementation Plan

## Source Documents

- Path: Inline prompt supplied in this chat on 2026-07-01
  - Role: Primary implementation brief.
  - Summary: Move Ask Siargao chat behavior toward ChatGPT-like model-owned routing and query
    formulation. Deterministic code should no longer pre-classify prompts into rigid tool routes or
    terminal fallback paths. Keep deterministic safety, privacy, schema, and source-honesty
    validation after tool/model output. Fix the OpenAI web research structured-output schema so web
    research can run.

## Goals

- Let the model decide whether a user request is a local service lookup, weather/condition
  question, place search, web research task, or mixed request from the natural-language prompt.
- Remove deterministic route-level intent fields as execution hints for the agent, especially
  `conditionActivity`, `placeIntent`, `researchIntent`, `weatherSensitive`, and related
  classifier-derived tool-routing signals.
- Stop generating required pre-answer evidence calls from deterministic place/research intent.
- Stop auto-executing route-derived required evidence checks after the model attempts a final
  answer.
- Remove or narrow terminal web-research provider failure behavior so provider failures become tool
  outputs the model can use when writing a caveated answer.
- Preserve deterministic validation that verifies source labels, tool-call references, schemas,
  privacy rules, and public artifact selection.
- Fix the strict JSON schema used by the OpenAI web research provider.
- Update tests so they assert tool/model behavior and source-honesty guarantees instead of brittle
  regex classifier outcomes.

## Non-Goals

- Do not remove all deterministic code from chat. Scope guards, geolocation privacy, request
  validation, source consistency, final payload parsing, and artifact filtering remain in scope as
  validation or safety layers.
- Do not remove the existing tool implementations for Places, web research, weather, marine/tide,
  local guide, itinerary, memory, or source policy.
- Do not weaken source labels. The model may choose tools, but it may not claim `live_checked`,
  `official_checked`, `directory_checked`, `weather_checked`, or similar labels without matching
  current-turn tool evidence.
- Do not implement a new web-search provider or broaden provider terms. Only fix the existing
  schema and runtime behavior around existing `research_web`.
- Do not redesign the chat UI except where response shape or tool-call display needs test updates.
- Do not change database schema or migrations.

## Definition of Done

- `/api/chat` no longer passes route-derived deterministic intent as an agent execution plan.
  Model-facing deterministic signals are reduced to safe context: client/geolocation privacy,
  minimal trip context if still needed, and scope flags that do not prescribe tools.
- Regex classifiers such as `interpretChatRequestIntent`, `interpretPlaceIntent`, and
  `inferConditionActivity` are removed from model-routing data flow or retained only for logging,
  analytics, or non-routing compatibility where they cannot force tool calls.
- `buildRequiredEvidencePlan()` no longer creates required `research_web`, `search_places`,
  `get_weather_forecast`, or `search_nightlife_events` calls from route-level `placeIntent` or
  `researchIntent`.
- The agent runtime no longer auto-injects required evidence calls based on route-derived
  classifiers after the model tries to answer.
- `terminalWebResearchFallbackPayload()` no longer short-circuits all required-web-research
  provider failures into the generic refusal-like answer. Provider failures are returned to the
  model as ordinary tool outputs, with validation preventing checked-source overclaims.
- The system prompt/tool descriptions clearly instruct the model to choose tools directly from the
  prompt. Example: for "where can I rent a scooter in General Luna?", call `research_web` and/or
  `search_places` with a query like "scooter rental General Luna Siargao"; if one provider fails,
  use evidence from the other if available and caveat the missing check.
- Source consistency remains enforced through `src/server/chat/source-consistency.ts` and related
  route validation. Failed provider outputs cannot produce checked source labels or place cards that
  imply successful provider evidence.
- `src/server/providers/web-search.ts` uses a strict JSON schema acceptable to the OpenAI Responses
  API. Nested object properties such as `role`, `area`, and `needsPlacesEnrichment` are handled in a
  schema-valid way.
- Tests cover:
  - scooter-rental prompts can be handled by model-chosen `research_web` and/or `search_places`;
  - failed `research_web` does not trigger the terminal generic refusal path;
  - failed `search_places` can still produce a useful answer from successful web research;
  - source labels cannot claim `live_checked` unless Places succeeded;
  - source labels cannot claim web-checked labels unless `research_web` succeeded;
  - weather/condition prompts still work when the model chooses condition/weather tools;
  - geolocation privacy behavior remains intact.
- `PROGRESS.md` is current, `CHANGELOG.md` follows Keep a Changelog 1.0.0 and records each
  completed step under `## [Unreleased]`, and each incremental step is committed separately.
- Required quality gates pass or any pre-existing failures are documented before proceeding:
  `bun run lint`, `bun run typecheck --incremental false`, `bun test`, and focused route/runtime
  tests. Before final completion, run the broader build/e2e gates listed below unless blocked by
  environment constraints.

## Assumptions and Open Questions

- Assumption: "Remove deterministic routing" means remove deterministic pre-classification as a
  tool-selection authority, not remove validation, source policy, privacy, or output-contract code.
  - Impact: The implementation should preserve source-governance behavior and only weaken the
    brittle pre-answer routing layer.
- Assumption: Existing deterministic trip context may still be useful if it is presented as
  contextual memory rather than a tool plan.
  - Impact: If a retained field can force a tool or repair call, remove or rename it so the model
    treats it as context only.
- Assumption: It is acceptable to delete or deprecate tests whose only assertion is a classifier
  result, replacing them with behavioral tests at the route/runtime level.
  - Impact: The test diff will be large because current tests inspect `deterministicSignals`.
- Assumption: Current source consistency is the correct deterministic validation boundary.
  - Impact: Do not remove `src/server/chat/source-consistency.ts`; add tests there if needed.
- Open question: Should old classifier functions be removed immediately or kept temporarily for log
  metadata?
  - Conservative choice: keep only what is needed for scope/logging during the first pass, but
    ensure none of it drives required tool calls or validation repairs.
- Open question: Should itinerary and condition repair paths remain if they are triggered by model
  tool outputs rather than route classifiers?
  - Conservative choice: keep repair paths that depend on explicit tool artifacts, but remove repair
    paths that infer mandatory tools from `deterministicSignals.intent`.

## Implementation Approach

Implement this as a controlled runtime refactor with tests first around the failure mode that
started the work: "where can I rent a scooter in General Luna?" The new architecture should have
three layers:

1. Request validation and safe context assembly in `src/app/api/chat/chat-route.ts`.
   - Validate schema, persist chat history, summarize browser geolocation, and pass minimal context.
   - Do not pass classifier-derived intent as an execution plan.

2. Model-owned tool choice in `src/server/chat/ask-siargao-agent.ts`.
   - The model sees the conversation, safe context, memory index, tools, and response contract.
   - The model chooses `research_web`, `search_places`, weather/condition tools, memory, or no tool.
   - Tool failures are returned to the model for caveated final prose rather than terminal runtime
     prose.

3. Deterministic postconditions.
   - Strict schemas validate tool arguments and final payload shape.
   - Source consistency validates labels against current-turn tool outputs.
   - Artifact selection filters cards/actions/itineraries to what matching evidence supports.
   - Provider failures and unchecked claims cannot masquerade as checked evidence.

Avoid a broad rewrite of all tools. The work should be a series of vertical slices:

- First fix the web research schema and lock the scooter-rental regression in tests.
- Then trim model-facing deterministic signals and remove required-evidence auto-routing.
- Then update prompts and tests so the model directly decides tool calls.
- Then delete or narrow terminal fallback behavior.
- Finally update docs/memory references and run full quality gates.

## Quality Gates

- Setup status: Existing Bun, Biome, TypeScript, Bun test, build, and Playwright gates are already
  configured in `package.json`; no new quality-gate setup step is required.
- Baseline command: `bun run verify`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates:
  - `bun run typecheck --incremental false`
  - `bun run db:migrate:test`
  - `bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`
  - Full CI-equivalent command when practical: `bun run verify:ci`

## Progress Tracking

- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step,
  validation results, commit reference if available, current status, and next step.

## Changelog Tracking

- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Create `CHANGELOG.md` before any quality-gate setup or implementation work begins.
- Initial content: Include `# Changelog`, the standard preamble, and an `## [Unreleased]` section.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with
  human-readable notable changes under the appropriate `Unreleased` change-type headings before
  creating that step's commit.

## Goal Handoff

- Readiness: This plan is ready to be used as a `/goal` payload.
- Scope: The `/goal` should execute only the work described in this plan unless the user explicitly
  expands it.
- Done: The `/goal` is complete only when every item in `## Definition of Done` is satisfied, all
  incremental steps are complete, required quality gates pass or documented pre-existing failures
  are handled, `PROGRESS.md` and `CHANGELOG.md` are current, and the final state is summarized for
  the user.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup

Goal: Create durable progress and changelog files the user can consult while the plan is being
executed.

Depends on:

- Nothing.

Changes:

- Create `PROGRESS.md` in the project root.
- Add the plan title, inline source brief, a step checklist, current status, and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Create `CHANGELOG.md` in the project root before any implementation work begins, or preserve and
  normalize the existing file if it already exists.
- Add Keep a Changelog 1.0.0 structure: `# Changelog`, the standard preamble, and
  `## [Unreleased]`.
- Document that `CHANGELOG.md` must be updated after each step is completed and validated, before
  that step is committed.

Acceptance criteria:

- `PROGRESS.md` exists and lists every step in this plan.
- `CHANGELOG.md` exists and has a valid Keep a Changelog 1.0.0 `## [Unreleased]` section.

Validation:

- Run `test -f PROGRESS.md`.
- Run `test -f CHANGELOG.md`.
- Run `rg -n "Model-Owned Chat Routing|Step 0|Step 1" PROGRESS.md`.
- Run `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status, and
  identify the next step.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for establishing progress and changelog tracking.

Commit:

- `Track model-owned chat routing plan progress`

### Step 1: Fix Web Research Structured Output Schema

Goal: Remove the concrete provider failure that prevented `research_web` from running.

Depends on:

- Step 0.

Changes:

- Update `src/server/providers/web-search.ts`.
- Make `webResearchSourcesJsonSchema()` valid for strict OpenAI Responses JSON schema validation.
  The observed failure was caused by nested `entities` item properties defining fields such as
  `role` without including every property in `required`.
- Use a schema-valid representation for optional values. Acceptable approaches include requiring
  all properties with nullable types, or removing optional fields from the strict schema and
  post-processing only the fields returned.
- Add or update tests in `src/server/providers/web-search.test.ts` to inspect the outgoing schema
  shape and verify nested entity schemas satisfy strict requirements.
- Preserve existing parsing behavior so missing optional data does not crash result parsing.

Acceptance criteria:

- The provider no longer constructs a strict schema that OpenAI rejects because a nested object has
  optional properties omitted from `required`.
- Existing web research parsing tests still pass.
- A regression test would fail if `entities.items.properties.role` exists but `role` is not listed
  in `entities.items.required`.

Validation:

- Run `bun test src/server/providers/web-search.test.ts`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Fixed` entry under `## [Unreleased]` for the web research strict schema fix.

Commit:

- `Fix web research strict schema`

### Step 2: Add Behavioral Regression Tests for Model-Owned Routing

Goal: Lock in the desired behavior before removing deterministic routing.

Depends on:

- Step 0.
- Step 1.

Changes:

- Update route/runtime tests in:
  - `src/app/api/chat/route.test.ts`
  - `src/server/chat/ask-siargao-agent.test.ts`
  - `src/server/chat/required-evidence.test.ts`
  - `src/server/chat/source-consistency.ts` tests if existing coverage is insufficient.
- Add a scooter-rental regression scenario for "where can I rent a scooter in General Luna?".
- Assert behavior instead of classifier internals:
  - the request can reach the agent without route-derived `conditionActivity: "scooter"`;
  - the model can call `research_web` with a natural-language scooter-rental query;
  - the model can call `search_places` with a natural-language scooter-rental query;
  - a failed `research_web` result does not trigger the generic terminal refusal if another useful
    tool result is available;
  - a failed `search_places` result does not erase successful web research;
  - source labels cannot claim `live_checked` without successful Places evidence.
- Identify tests that assert deterministic classifier outputs, such as scooter prompts expecting
  `conditionActivity: "scooter"`, and mark them for replacement in later steps.

Acceptance criteria:

- New tests describe the target runtime behavior and initially fail or require implementation
  changes in later steps.
- Tests do not depend on live network providers.
- Tests use existing dependency injection/mocked client patterns.

Validation:

- Run focused tests expected to fail before implementation and record the failure in
  `PROGRESS.md`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.

Progress:

- Update `PROGRESS.md` with completion notes, expected failing tests if any, validation results,
  commit reference if available, current status, and next step.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for model-owned routing regression coverage.

Commit:

- `Add model-owned routing regressions`

### Step 3: Trim Route-Level Deterministic Signals

Goal: Stop giving the agent a route-owned execution plan before the model reasons about the prompt.

Depends on:

- Step 0.
- Step 2.

Changes:

- Update `src/app/api/chat/chat-route.ts`.
- Change the object passed as `deterministicSignals` to include only:
  - `clientContext` geolocation/privacy summary;
  - scope flags needed for non-Siargao decline or unresolved context;
  - minimal trip context if needed for continuity, without tool-prescriptive fields.
- Remove model-facing fields such as:
  - `conditionActivity`;
  - `placeIntent`;
  - `researchIntent`;
  - `weatherSensitive`;
  - route-owned `roadCondition` or `marineCondition` as tool requirements.
- If `interpretChatRequestIntent()` is still needed for logging or persistence context, ensure its
  result is not passed to the agent as a routing/evidence contract.
- Update tests in `src/app/api/chat/route.test.ts` that inspect `deterministicSignals.intent`.
  Replace them with assertions on final behavior, tool calls, source labels, or safe context.

Acceptance criteria:

- Agent input no longer contains a route-derived `intent` object that can force tool selection.
- Existing chat persistence and logging still work.
- Browser geolocation privacy behavior remains tested and intact.

Validation:

- Run `bun test src/app/api/chat/route.test.ts`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for reducing model-facing deterministic routing
  signals.

Commit:

- `Stop passing deterministic chat routing intent`

### Step 4: Remove Route-Derived Required Evidence Planning

Goal: Prevent deterministic classifiers from creating mandatory tool calls before or after model
tool choice.

Depends on:

- Step 0.
- Step 3.

Changes:

- Update `src/server/chat/required-evidence.ts`.
- Refactor `buildRequiredEvidencePlan()` so it no longer reads route-level `placeIntent` or
  `researchIntent` from `request.deterministicSignals`.
- Keep any required-evidence logic that is derived from explicit tool artifacts, such as itinerary
  tool outputs that declare follow-up checks, only if it does not depend on route classifiers.
- Update or delete helper functions that only exist to convert deterministic `placeIntent` into
  required `search_places` arguments, including query synthesis through `buildPlaceSearchPlan()`,
  unless another non-routing caller still needs them.
- Update `src/server/chat/required-evidence.test.ts` so it verifies validation behavior and
  artifact filtering instead of route-derived required-call planning.

Acceptance criteria:

- A plain chat request with no model tool calls does not cause `buildRequiredEvidencePlan()` to
  manufacture `research_web`, `search_places`, or weather calls from route classifiers.
- Required checks can still be enforced when they originate from explicit tool output contracts
  rather than route pre-classification.
- Tests that expected "web research before current restaurant recommendation Places enrichment"
  from deterministic `researchIntent` are removed or rewritten.

Validation:

- Run `bun test src/server/chat/required-evidence.test.ts`.
- Run `bun test src/server/chat/ask-siargao-agent.test.ts`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Removed` or `Changed` entry under `## [Unreleased]` for removing route-derived required
  evidence planning.

Commit:

- `Remove route-derived required evidence planning`

### Step 5: Remove Auto-Injected Required Evidence Repairs From Route Classifiers

Goal: Ensure the runtime does not override the model with classifier-derived automatic tool calls.

Depends on:

- Step 0.
- Step 4.

Changes:

- Update `src/server/chat/ask-siargao-agent.ts`.
- Remove or narrow the block that calls `missingRequiredEvidenceToolCalls()` and auto-executes
  required evidence checks after a final answer attempt.
- Remove or narrow `requiredEvidencePreflightFunctionCalls()` behavior that prepends
  `research_web` or `search_nightlife_events` because of a deterministic plan.
- Review repair helpers that read `request.deterministicSignals.intent`, including condition,
  surf, itinerary, weather, and open-now repairs. Remove classifier-derived mandatory behavior.
- Keep validation repairs that are based on explicit tool output artifacts and final payload
  consistency, not route classifiers.
- Update `src/server/chat/ask-siargao-agent.test.ts` so tests assert model-selected tool calls and
  final payload validation instead of automatic route-derived calls.

Acceptance criteria:

- The agent runtime does not synthesize `auto_required_evidence_*` calls from route-level
  deterministic intent.
- The model can choose `research_web` or `search_places` directly and receive tool outputs as normal
  conversation state.
- Final payload validation still rejects source/artifact overclaims.

Validation:

- Run `bun test src/server/chat/ask-siargao-agent.test.ts`.
- Run `bun test src/server/chat/required-evidence.test.ts`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Removed` entry under `## [Unreleased]` for automatic classifier-derived required evidence
  repairs.

Commit:

- `Remove automatic classifier evidence repairs`

### Step 6: Make Provider Failures Non-Terminal

Goal: Let the model recover from one failed provider by using other successful evidence or writing a
useful caveated answer.

Depends on:

- Step 0.
- Step 5.

Changes:

- Update `src/server/chat/ask-siargao-agent.ts`.
- Delete or narrow `terminalWebResearchFallbackPayload()`.
- Ensure `research_web` provider failures remain `AgentToolResult` values with
  `provider_unavailable` source labels and are returned to the model for final-answer generation.
- Ensure failed web research cannot unlock checked claims. Keep final payload/source consistency
  validation that prevents `official_checked`, `directory_checked`, or `web_researched` labels
  without successful `research_web`.
- Add/adjust tests where:
  - `research_web` fails and `search_places` succeeds;
  - `search_places` fails and `research_web` succeeds;
  - both fail and the model writes a practical but explicitly caveated answer with no checked
    source overclaims and no unsupported cards.

Acceptance criteria:

- The generic answer "I could not verify current public web evidence..." is not returned by the
  runtime before the model gets a chance to write final prose, except for any intentionally retained
  narrow case documented in tests.
- Successful evidence from one provider can still shape the answer when another provider fails.

Validation:

- Run `bun test src/server/chat/ask-siargao-agent.test.ts`.
- Run `bun test src/app/api/chat/route.test.ts`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for non-terminal provider failure handling.

Commit:

- `Let model handle provider failures`

### Step 7: Strengthen Model Tool-Choice Instructions

Goal: Teach the model the intended ChatGPT-like routing pattern without hard-coding it in the route.

Depends on:

- Step 0.
- Step 6.

Changes:

- Update `src/server/chat/ask-siargao-agent.ts` instructions and `responseContract`.
- Update tool descriptions in `src/server/chat/agent-tools.ts` if needed.
- Add prompt guidance that:
  - the model owns tool choice and query formulation;
  - local service requests should use natural-language web/place queries;
  - scooter rental in General Luna is a service lookup, not a road-condition question unless the
    user asks about riding safety, roads, rain, or conditions;
  - failed providers should be mentioned practically and only when relevant;
  - successful evidence from one provider should be used when another provider fails;
  - source labels must match actual tool outputs.
- Avoid brittle one-off prompt hacks. Include examples as patterns, not mandatory exact workflows.

Acceptance criteria:

- A mocked model turn for scooter rental can call `research_web` and/or `search_places` without any
  deterministic route hints.
- Weather/condition prompts remain tool-eligible because the tool descriptions and model
  instructions make the need clear.
- Tests verify instructions include the model-owned routing principle.

Validation:

- Run `bun test src/server/chat/ask-siargao-agent.test.ts`.
- Run `bun test src/server/chat/agent-tools.test.ts`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for model-owned tool-choice instructions.

Commit:

- `Guide model-owned chat tool choice`

### Step 8: Preserve and Extend Source Validation

Goal: Ensure removing deterministic routing does not weaken source governance.

Depends on:

- Step 0.
- Step 7.

Changes:

- Review `src/server/chat/source-consistency.ts`.
- Add or update tests to ensure:
  - `live_checked` requires successful Places or place details evidence;
  - `official_checked`, `directory_checked`, and `web_researched` require successful
    `research_web` evidence;
  - `provider_unavailable` is allowed only as a transparent terminal/failure label, not positive
    evidence;
  - selected recommendation cards are filtered out when their backing provider failed.
- Review `src/features/chat/ChatWorkspace.tsx` and shared source-display helpers only if public UI
  source rendering needs updates for provider failure labels.

Acceptance criteria:

- Source consistency tests pass and would fail if the model overclaimed checked evidence after a
  provider failure.
- Removing route-derived evidence plans does not allow unsupported checked source labels through
  `/api/chat`.

Validation:

- Run focused source consistency tests.
- Run `bun test src/app/api/chat/route.test.ts`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Fixed` or `Changed` entry under `## [Unreleased]` for preserving source validation after
  routing changes.

Commit:

- `Preserve source validation for model routing`

### Step 9: Remove or Quarantine Brittle Classifier Tests and Dead Routing Helpers

Goal: Finish the refactor by removing stale tests/helpers that encode the old routing model.

Depends on:

- Step 0.
- Step 8.

Changes:

- Remove or quarantine route classifier tests in `src/app/api/chat/route.test.ts` that assert
  internal `deterministicSignals.intent` categories instead of behavior.
- Remove unused helpers from:
  - `src/app/api/chat/chat-route.ts`;
  - `src/server/chat/place-intent.ts`;
  - `src/server/chat/place-search-plan.ts`;
  - `src/server/chat/required-evidence.ts`;
  - `src/server/chat/ask-siargao-agent.ts`.
- Keep helpers that are still used for non-routing purposes, such as safe trip-context summaries or
  UI/persistence context.
- Use `rg` and TypeScript to verify no stale imports or dead exported functions remain.

Acceptance criteria:

- Tests no longer assert that scooter/service prompts become specific deterministic routing
  categories.
- No unused imports/types remain after removing deterministic routing helpers.
- The scooter-rental regression passes through behavior-level assertions.

Validation:

- Run `rg -n "conditionActivity|placeIntent|researchIntent|weatherSensitive" src/app/api/chat src/server/chat`.
- Inspect remaining matches and confirm they are not route-owned tool-routing signals.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Removed` entry under `## [Unreleased]` for brittle deterministic routing tests/helpers.

Commit:

- `Remove stale deterministic routing helpers`

### Step 10: Documentation, Final Gates, and Handoff

Goal: Document the new chat routing architecture and complete full validation.

Depends on:

- Step 0.
- Step 9.

Changes:

- Update relevant developer docs, likely under `documentation/developer/`, to describe:
  - model-owned tool choice;
  - deterministic validation boundaries;
  - provider failure behavior;
  - source-label requirements.
- Update agent memory/policy files only if the chat agent uses them to reason about tool choice or
  source policy. Keep memory changes concise and consistent with existing file organization.
- Ensure `PROGRESS.md` has every step marked complete with validation results.
- Ensure `CHANGELOG.md` has human-readable entries under `## [Unreleased]`.
- Summarize any intentionally deferred cleanup or pre-existing failures.

Acceptance criteria:

- Documentation matches the implemented architecture.
- Full final validation has run or any environmental blocker is documented with exact command and
  failure reason.
- The user can inspect `PROGRESS.md` and `CHANGELOG.md` to understand the completed work.

Validation:

- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.
- When practical, run `bun run verify:ci`.

Progress:

- Update `PROGRESS.md` with completion notes, final validation results, commit reference if
  available, current status, and any follow-up work.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` with documentation/finalization notes.

Commit:

- `Document model-owned chat routing`

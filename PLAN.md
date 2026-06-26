# Implementation Plan

## Source Documents

- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
  - Role: Primary roadmap source.
  - Summary: Only `Priority 2: Contextual Follow-Up And Trip Memory` is in scope. It requires
    request-scoped `TripContext` derivation, stable trip context across follow-ups, temporary
    modifier precedence, shared intent logic, and route/unit regression coverage for rainy,
    open-now, beach-goal, budget, kids, and generic prompt guardrail scenarios.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/TECH.md`
  - Role: Supporting architecture context referenced by the roadmap.
  - Summary: Chat requests should flow through trip context extraction, intent/retrieval planning,
    bounded answer context, and LLM generation. Persistence belongs to trip/chat tables later, while
    deterministic code should gate provider usage and source policy.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/DATA_STRATEGY.md`
  - Role: Supporting data and retention context referenced by the roadmap.
  - Summary: Trip and chat memory stores user-owned context such as travel window, accommodation,
    route origin, traveler type, group/family context, constraints, and chat history. The first
    Priority 2 implementation should stay request-scoped and avoid new migrations unless persistence
    is explicitly selected later.

## Goals

- Add a request-scoped `TripContext` layer derived from the submitted chat message window.
- Preserve stable context across follow-ups: area, origin/current location, ride-time limit,
  transport mode, traveler profile, and durable constraints.
- Treat temporary modifiers as latest-turn overrides for goal-specific behavior: open now, covered,
  cheaper, rainy day, swimming, sunset, beach suitability, and itinerary-style plan changes.
- Let explicit new goals clear incompatible stale modifiers, especially switching from swimming to
  sunset or rainy-day planning.
- Move duplicated chat intent and regex parsing out of `src/app/api/chat/chat-route.ts` and
  `src/server/chat/recommendation-agent.ts` into shared `src/server/chat/intent.ts` and focused
  helpers/tests.
- Route weather, beach, local-plan, and Google Places recommendation decisions through the same
  derived context.
- Ask clarifying questions only when the request genuinely lacks the location/category/context
  required to answer.

## Non-Goals

- Do not add Postgres persistence for `trips`, `chat_messages`, `chat_requests`, or
  `trip_context_snapshots` in the first implementation.
- Do not change paid trip-pass, Stripe, usage-meter, or provider-budget behavior.
- Do not build Priority 4 recommendation cards or any new frontend trip-memory panel.
- Do not expand beyond Siargao or weaken the existing Siargao scope guardrails.
- Do not store browser geolocation, private chat memory, or raw provider payloads as part of this
  request-scoped slice.

## Assumptions and Open Questions

- Assumption: Priority 2 should be implemented as request-scoped context first, matching the roadmap
  statement that persistence can come later. Impact: no migration is required for this plan.
- Assumption: `TripContext.currentLocation.source` can start with `"user"` and `"gazetteer"` for
  derived chat context, while `"browser_geolocation"` and `"google_places"` remain supported type
  values for later integration. Impact: the type is persistence-ready without requiring those sources
  to be populated immediately.
- Assumption: "nearby" without any prior location may continue to default to General Luna only for
  existing broad local-place behavior, but "there" should ask for clarification if no place/location
  exists. Impact: avoids pretending a referent exists when context is missing.
- Assumption: budget values map to `"cheap"`, `"mid"`, and `"premium"` from simple natural-language
  signals such as "cheap", "cheaper", "budget", "midrange", "premium", and "nice". Impact: exact
  pricing thresholds can be refined later.
- Open question: Should `tripId` be accepted in the `/api/chat` request schema now, or reserved for
  the persistence phase? Impact: adding it now creates an API surface that needs compatibility
  support; this plan keeps it optional in types but out of the request schema unless execution
  discovers an existing client source for it.
- Open question: Should "no scooter" map to `transportMode: "walk"` or a separate avoidance flag?
  Impact: this plan treats it as `transportMode: "walk"` plus a stable constraint in tests unless a
  better existing domain pattern is found during implementation.

## Quality Gates

- Setup status: Existing gates are configured in `package.json`, `biome.json`, `tsconfig.json`,
  `playwright.config.ts`, and `.github/workflows/ci.yml`; no quality-gates setup step is required.
- Baseline command:
  `bun run lint && bun run typecheck --incremental false && bun test && bun run db:migrate:test && bun run db:seed:test && bun run build && bun run test:e2e`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates:
  `bun run typecheck --incremental false`
  `bun run db:migrate:test`
  `bun run db:seed:test`
  `bun run build`
  `bun run test:e2e`

## Progress Tracking

- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step,
  validation results, commit reference if available, current status, and next step.

## Changelog Tracking

- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Verify the existing `CHANGELOG.md` before implementation work begins; if it is
  missing in a future branch, create it before implementation.
- Initial content: Ensure `# Changelog`, the standard preamble, and `## [Unreleased]` are present.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with
  human-readable notable changes under the appropriate `Unreleased` change-type headings before
  creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup

Goal: Create durable progress tracking and verify changelog tracking for the Priority 2 execution.

Depends on:

- None

Changes:

- Create `PROGRESS.md` in the project root if it does not already exist.
- Add the plan title, source document paths, step checklist, current status, and short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Verify the existing `CHANGELOG.md` follows Keep a Changelog 1.0.0 structure with `# Changelog`,
  the standard preamble, and `## [Unreleased]`.
- If `CHANGELOG.md` is missing in the execution branch, create it with the required Keep a
  Changelog structure before implementation starts.
- Record that this implementation is scoped to Priority 2 only.

Acceptance Criteria:

- `PROGRESS.md` exists and lists every step in this plan.
- `CHANGELOG.md` exists and has `# Changelog`, the Keep a Changelog preamble, and an
  `## [Unreleased]` section.
- No feature behavior has changed yet.

Validation:

- Run `test -f PROGRESS.md`
- Run `test -f CHANGELOG.md`
- Run `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`

Progress:

- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status, and
  identify Step 1 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for establishing Priority 2 progress tracking, or
  update the existing tracking entry if the branch already has one.

Commit:

- `Track Priority 2 trip memory progress`

Final step checklist:

1. Run all quality gates required for this step.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
   current status, and next step.
4. Update `CHANGELOG.md` under `## [Unreleased]` with notable completed work.
5. Create the suggested commit for this completed step.

### Step 1: Shared Trip Context And Intent Module

Goal: Add the pure request-scoped context and intent layer without changing route behavior.

Depends on:

- Step 0

Changes:

- Add `src/server/chat/intent.ts`.
- Define and export `TripContext`, `TripContextLocation`, `TravelerProfile`,
  `TripContextActiveGoal`, `TemporaryModifier`, and a unified chat intent result type.
- Implement a pure `deriveTripContext(messages)` function that inspects the bounded submitted
  message window and returns stable context plus latest-turn temporary modifiers.
- Move shared regex helpers from `src/app/api/chat/chat-route.ts` and
  `src/server/chat/place-intent.ts` where practical, including:
  - user-turn extraction
  - recent user context construction
  - Siargao location label inference
  - ride-time limit extraction
  - transport mode extraction for walk, scooter, tricycle, van, and unknown
  - traveler profile extraction for kids, budget, rain avoidance, and rocky beach avoidance
  - active-goal extraction for food, beach swimming, sunset, rain plan, and itinerary
  - temporary modifier extraction for open-now, covered, cheaper, rainy-day, swimming, sunset,
    beach-suitability, kids, budget, and ride-time constraints
- Keep `src/server/chat/place-intent.ts` behavior-compatible by importing shared helpers only where
  it reduces duplication safely.
- Add `src/server/chat/intent.test.ts` covering:
  - Cloud 9 context followed by "what if it rains?"
  - sandy swimming beaches followed by "what about sunset?"
  - "no scooter" and "with kids" as stable context
  - "cheaper" as a latest-turn budget modifier
  - "there" and "nearby" resolution when prior location exists
  - missing context for "there" when no prior location exists
  - unrelated generic prompts not creating Siargao trip context accidentally

Acceptance Criteria:

- `deriveTripContext` is deterministic, side-effect free, and independent of provider calls.
- Stable context and temporary modifiers are represented separately in the returned object.
- New goal extraction clears incompatible latest-turn modifiers in tests, especially swimming to
  sunset.
- Existing `interpretPlaceIntent` tests still pass.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/intent.test.ts src/server/chat/place-intent.test.ts`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 2 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for the shared request-scoped trip context and intent
  module.

Commit:

- `Add request-scoped trip context derivation`

Final step checklist:

1. Run all quality gates: format, lint, tests, and project-specific checks listed for the step.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit reference if available,
   current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`, using the appropriate
   Keep a Changelog change-type heading.
5. Create a commit for that completed step.

### Step 2: Route Chat Decisions Through TripContext

Goal: Make `/api/chat` use the shared context layer for weather, beach, and local-plan routing.

Depends on:

- Step 0
- Step 1

Changes:

- Update `src/app/api/chat/chat-route.ts` so `interpretChatRequestIntent` is either replaced by or
  delegates to `deriveTripContext` and the shared intent helpers in `src/server/chat/intent.ts`.
- Keep the public `/api/chat` request/response shape unchanged.
- Use `TripContext.currentLocation` and `currentArea` for:
  - weather location detection
  - activity-plan location labels
  - beach recommendation origin labels
  - "there" and "nearby" follow-ups
- Use `TripContext.rideTimeLimitMinutes`, `transportMode`, and `travelerProfile` when building
  `BeachRecommendationRequest`.
- Ensure latest-turn active goal wins when incompatible with previous context:
  - swimming context followed by "what about sunset?" renders sunset beach logic
  - rainy-day follow-up uses weather/rain-plan logic without carrying stale swimming-only behavior
- Preserve existing local-plan and beach output caveats, including checked/not-checked lines.
- Add or update `src/app/api/chat/route.test.ts` cases for:
  - rainy follow-up inherits Cloud 9 location
  - beach-use switch from swimming to sunset
  - ride-time limit carries into beach follow-up
  - kids/no-scooter constraints do not disappear from route intent
  - missing context produces clarification instead of invented location when the latest turn says
    "there" with no referent

Acceptance Criteria:

- Existing weather, local-plan, beach, and generic LLM route tests pass.
- Follow-ups inherit location and ride-time constraints from recent user turns.
- New explicit goals override stale incompatible modifiers.
- Clarification happens only when context required by the latest follow-up is missing.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/intent.test.ts src/app/api/chat/route.test.ts`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 3 as next.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for routing chat follow-ups through request-scoped
  trip context.

Commit:

- `Route chat follow-ups through trip context`

Final step checklist:

1. Run all quality gates: format, lint, tests, and project-specific checks listed for the step.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit reference if available,
   current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`, using the appropriate
   Keep a Changelog change-type heading.
5. Create a commit for that completed step.

### Step 3: Align Place Intent And Recommendation Planning With TripContext

Goal: Make Google Places recommendation follow-ups use the same stable context and latest modifiers.

Depends on:

- Step 0
- Step 1
- Step 2

Changes:

- Update `src/server/chat/place-intent.ts` to consume shared message-window and location/context
  helpers from `src/server/chat/intent.ts`.
- Extend `PlaceIntent` only as needed to carry derived `TripContext` information into the
  recommendation path, such as current location, stable budget/kids constraints, open-now live
  need, and latest temporary modifiers.
- Update `src/server/chat/recommendation-agent.ts` to avoid reinterpreting the same message window
  with divergent rules where `PlaceIntent` already carries the needed context.
- Ensure "there" and "nearby" can resolve from prior user context and do not default incorrectly
  when a specific prior place is available.
- Ensure "cheaper" adjusts ranking/search terms as a temporary budget modifier without permanently
  overwriting prior category or location.
- Ensure "with kids" persists as a stable constraint into recommendation search/ranking terms.
- Ensure "open now" remains a live-status need on follow-up recommendations.
- Update `src/server/chat/place-intent.test.ts` and
  `src/server/chat/recommendation-agent.test.ts` for:
  - "there" after a named place/location
  - "nearby" after Cloud 9/General Luna context
  - "cheaper" after a restaurant recommendation
  - "with kids" after an earlier family-context turn
  - "open now" after a prior food/cafe request

Acceptance Criteria:

- Place and recommendation tests prove stable context persists while temporary modifiers affect only
  the latest recommendation need.
- Recommendation search queries and ranking terms reflect current location, budget, kids, and
  open-now context.
- No duplicate regex logic remains in `recommendation-agent.ts` when an exported shared helper or
  `PlaceIntent` field can supply the same value.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/intent.test.ts src/server/chat/place-intent.test.ts src/server/chat/recommendation-agent.test.ts`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 4 as next.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for aligning place recommendations with trip
  context and latest-turn modifiers.

Commit:

- `Align recommendations with trip context`

Final step checklist:

1. Run all quality gates: format, lint, tests, and project-specific checks listed for the step.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit reference if available,
   current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`, using the appropriate
   Keep a Changelog change-type heading.
5. Create a commit for that completed step.

### Step 4: End-To-End Route Regressions For Priority 2 Follow-Ups

Goal: Prove the full `/api/chat` behavior satisfies the Priority 2 acceptance criteria.

Depends on:

- Step 0
- Step 1
- Step 2
- Step 3

Changes:

- Expand `src/app/api/chat/route.test.ts` with route-level tests for:
  - rainy follow-up after "what should I do near Cloud 9 today?"
  - open-now follow-up after a prior local recommendation category
  - beach-use switching from swimming to sunset
  - "nearby" and "there" after a prior place/location
  - "cheaper" after a prior food/cafe recommendation
  - "with kids" and "no scooter" carried across a trip conversation
  - unrelated generic prompts still declining or falling through according to existing Siargao
    scope guardrails
- If browser behavior is affected by changed response text, update only the minimal assertions in
  `tests/e2e/chat.e2e.ts`.
- Keep external providers mocked or dependency-injected in tests; do not require live Google,
  OpenAI, or weather network calls.

Acceptance Criteria:

- Priority 2 acceptance criteria are represented in route-level tests.
- Tests demonstrate the assistant asks a clarifying question only when context is missing.
- Siargao scope guardrails remain covered for unrelated generic prompts.
- Existing e2e chat tests still pass or are updated for intentional text changes only.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun test`
- Run `bun run test:e2e`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and Step 5 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for Priority 2 route regression coverage.

Commit:

- `Cover contextual follow-up chat behavior`

Final step checklist:

1. Run all quality gates: format, lint, tests, and project-specific checks listed for the step.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit reference if available,
   current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`, using the appropriate
   Keep a Changelog change-type heading.
5. Create a commit for that completed step.

### Step 5: Persistence-Ready Documentation And Final Verification

Goal: Document the request-scoped boundary and verify the completed Priority 2 slice against the
repo's full gates.

Depends on:

- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:

- Update the most relevant developer documentation only if behavior or architecture changed in a way
  future maintainers need to know. Likely candidates:
  - `docs/DATA_STRATEGY.md` for the request-scoped `TripContext` boundary and persistence handoff
  - `docs/TECH.md` for the shared `src/server/chat/intent.ts` module if the implementation changes
    the request flow materially
  - `documentation/developer/reference/routes-and-surfaces.md` only if `/api/chat` behavior or
    contract changes are user-visible
- Do not add database schema docs for persistence unless the implementation actually adds schema.
- Run the full baseline/CI-quality gate set and fix failures.
- Update `PROGRESS.md` with the final validation matrix and current status.
- Update `CHANGELOG.md` with final notable Priority 2 behavior changes before committing.

Acceptance Criteria:

- Documentation matches the actual implemented boundary: request-scoped context now, persistence
  later.
- Full validation passes or any skipped gate has a concrete environment reason recorded in
  `PROGRESS.md`.
- `PROGRESS.md` shows every step complete with validation notes.
- `CHANGELOG.md` contains concise, human-readable Priority 2 entries under `## [Unreleased]`.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run db:migrate:test`
- Run `bun run db:seed:test`
- Run `bun run build`
- Run `bun run test:e2e`

Progress:

- Update `PROGRESS.md` with completion notes, full validation results, commit reference if
  available, current status, and "Priority 2 plan complete" as next status.

Changelog:

- Add or refine `Added` and `Changed` entries under `## [Unreleased]` for the completed contextual
  follow-up and trip-memory slice.

Commit:

- `Document Priority 2 trip context behavior`

Final step checklist:

1. Run all quality gates: format, lint, tests, and project-specific checks listed for the step.
2. Fix any failures before proceeding.
3. Update `PROGRESS.md` with the completed step, validation results, commit reference if available,
   current status, and next step.
4. Update `CHANGELOG.md` with notable completed work under `## [Unreleased]`, using the appropriate
   Keep a Changelog change-type heading.
5. Create a commit for that completed step.

# Local Itinerary Builder Progress

Plan: `PLAN.md`

Source documents:

- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
- `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`

Rule: update this file after every completed step with validation results, the
commit reference when available, current status, and the next step.

## Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Baseline Quality Gate Run
- [x] Step 2: Add Shared Itinerary Artifact Types
- [x] Step 3: Build Deterministic Itinerary Planning Tool Data
- [x] Step 4: Integrate Weather and Places Requirements Into Itinerary Flow
- [x] Step 5: Return Itinerary Artifacts From `/api/chat`
- [x] Step 6: Render Itinerary Plans in the Chat UI
- [x] Step 7: Add End-to-End Itinerary Behavior Coverage
- [x] Step 8: Update Developer and Agent Documentation
- [x] Step 9: Final Verification and Handoff

## Current Status

All Local Itinerary Builder implementation steps are complete.

## Update Log

### Step 0: Progress and Changelog Tracking Setup

Completed:

- Created `PROGRESS.md` for the Local Itinerary Builder plan.
- Confirmed `CHANGELOG.md` already exists with `# Changelog` and `## [Unreleased]`.
- Added an `Unreleased` changelog entry for itinerary progress tracking.

Validation:

- `test -f PROGRESS.md`: passed.
- `test -f CHANGELOG.md`: passed.
- `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`: passed.
- `rg -n "Local Itinerary Builder|Step 0|Step 1" PROGRESS.md`: passed.

Commit: `cdde360` (`Track itinerary builder execution progress`).

Next step: Step 1, baseline quality gate run.

### Step 1: Baseline Quality Gate Run

Completed:

- Ran the pre-implementation quality baseline without source behavior changes.
- Confirmed there are no pre-existing baseline failures to carry forward.

Validation:

- `bun run lint`: passed (`biome check .`, 193 files checked).
- `bun run typecheck --incremental false`: passed.
- `bun test`: passed (306 tests across 40 files).

Commit: `ffefdff` (`Record itinerary builder quality baseline`).

Next step: Step 2, shared itinerary artifact types.

### Step 2: Add Shared Itinerary Artifact Types

Completed:

- Added shared itinerary artifact types to the agent runtime contract.
- Extended tool results, artifact carriers, and turn results with optional itinerary artifacts.
- Added itinerary merge and stable title-plus-duration dedupe behavior.
- Added runtime tests for itinerary aggregation, dedupe, and existing card/action/source behavior.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed after applying Biome import ordering.
- `bun run typecheck --incremental false`: passed.
- `bun test src/server/chat/agent-runtime.test.ts`: passed (11 tests).
- `bun test`: passed (308 tests across 40 files).

Commit: `d6fb074` (`Add itinerary artifact contract`).

Next step: Step 3, deterministic itinerary planning tool data.

### Step 3: Build Deterministic Itinerary Planning Tool Data

Completed:

- Added the `plan_local_itinerary` agent tool with strict Zod arguments.
- Added deterministic itinerary artifact generation for rainy Cloud 9 afternoon, sunset plus
  dinner, sandy beach half-day, non-surfer half-day, and food crawl themes.
- Kept itinerary generation as data shaping only; final chat prose remains model-written.
- Wired itinerary artifacts into the tool registry, agent audit operation mapping, instructions,
  and source-consistency validation.
- Added unit and runtime coverage for itinerary artifact output, strict arguments, source caveats,
  and model tool-loop propagation.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed.
- `bun run typecheck --incremental false`: passed.
- `bun test src/server/chat/itinerary-tools.test.ts`: passed (5 tests).
- `bun test src/server/chat/agent-tools.test.ts`: passed (40 tests).
- `bun test`: passed (317 tests across 41 files).

Commit: `12a00b4` (`Add local itinerary planning tool`).

Next step: Step 4, weather and Places requirements in the itinerary flow.

### Step 4: Integrate Weather and Places Requirements Into Itinerary Flow

Completed:

- Added `requiredToolChecks` to itinerary planning output for weather-sensitive and
  meal/cafe/food-crawl itinerary stops.
- Added suggested weather locations/date ranges and Places queries, centers, radii, and
  open-now constraints.
- Updated agent instructions to require weather checks for rainy/weather-sensitive itineraries
  and Places checks for meal, cafe, dinner, drinks, and food-crawl stops when live status or maps
  identity matters.
- Added fake model/tool-loop coverage for rainy Cloud 9, sunset dinner, food crawl, and Places
  provider-failure itinerary flows.
- Added source-consistency coverage for itinerary not-verified caveats.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed.
- `bun run typecheck --incremental false`: passed.
- `bun test src/server/chat/ask-siargao-agent.test.ts`: passed (18 tests).
- `bun test src/server/chat/source-consistency.test.ts`: passed (12 tests).
- `bun test`: passed (322 tests across 41 files).

Commit: `dd1c240` (`Connect itinerary plans to weather and places tools`).

Next step: Step 5, return itinerary artifacts from `/api/chat`.

### Step 5: Return Itinerary Artifacts From `/api/chat`

Completed:

- Added `itineraries` to successful `/api/chat` JSON responses when the agent returns itinerary
  artifacts.
- Omitted `itineraries` when the artifact array is empty.
- Logged itinerary artifact counts without provider payloads.
- Preserved markdown, tool calls, sources, memory, cards, actions, and source-consistency error
  behavior.
- Updated local chat response/message types to accept itinerary artifacts for the upcoming UI
  renderer.
- Preserved itinerary-like deterministic signals, including activity-plan signals alongside
  place intent for dinner and food-crawl prompts.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed.
- `bun run typecheck --incremental false`: passed.
- `bun test src/app/api/chat/route.test.ts`: passed (22 tests).
- `bun test`: passed (328 tests across 41 files).

Commit: `Return itinerary artifacts from chat API`.

Next step: Step 6, render itinerary plans in the chat UI.

### Step 6: Render Itinerary Plans in the Chat UI

Completed:

- Added an `ItineraryPlans` renderer below assistant markdown and before cards/actions.
- Rendered itinerary title, duration, sequenced stops, travel-time estimates, map links,
  rationale, stop caveats, fallback stops, skip guidance, source labels, and not-checked source
  caveats.
- Kept the renderer inside the existing assistant bubble without adding nested card shells.
- Preserved recommendation card rendering and markdown-only fallback behavior.
- Added Playwright coverage for structured itinerary rendering, map links, fallbacks, skip
  guidance, source caveats, markdown fallback without itinerary artifacts, and mobile overflow
  containment.
- Fixed the React Doctor `js-tosorted-immutable` warning by using `toSorted` for stop ordering.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed (`biome check .`, 195 files checked).
- `bun run typecheck --incremental false`: passed.
- `bun test`: passed (328 tests across 41 files).
- `bun run test:e2e -- tests/e2e/chat.e2e.ts`: passed (11 tests).
- `npm_config_yes=true npx react-doctor@latest --verbose --scope changed`: passed with no issues
  found and score 100/100.

Commit: `Render itinerary plans in chat`.

Next step: Step 7, add end-to-end itinerary behavior coverage.

### Step 7: Add End-to-End Itinerary Behavior Coverage

Completed:

- Added a fake Responses tool-loop regression proving sandy beach/non-surfer itinerary prompts
  keep structured itinerary artifacts and avoid surf-only brainstorms.
- Expanded browser coverage with deterministic sunset plus dinner, sandy beach, and food-crawl
  itinerary fixtures.
- Asserted route-aware dinner sequencing, itinerary stop map links, sandy beach fallback/skip
  guidance, no surf-lesson main stop, food-crawl sequencing, and live-open-status caveats.
- Kept all new tests deterministic with mocked Responses/tool outputs and mocked `/api/chat`
  responses; no live OpenAI, Open-Meteo, or Google Places calls are required.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed (`biome check .`, 195 files checked).
- `bun run typecheck --incremental false`: passed.
- `bun test src/server/chat/ask-siargao-agent.test.ts`: passed (19 tests).
- `bun run test:e2e -- tests/e2e/chat.e2e.ts`: passed (12 tests).
- `bun test`: passed (329 tests across 41 files).
- `bun run test:e2e`: passed (22 tests).

Commit: `Cover itinerary builder scenarios`.

Next step: Step 8, update developer and agent documentation.

### Step 8: Update Developer and Agent Documentation

Completed:

- Documented `plan_local_itinerary` in the chat agent runtime reference as a planning-evidence
  tool that returns structured artifacts, required follow-up checks, source summaries, and actions
  while leaving final prose to the model.
- Documented the supported initial itinerary themes and the current unchecked boundaries for surf,
  swell, tides, road flooding, closures, lifeguards, and provider-independent safety conditions.
- Updated agent memory tool-use policy so itinerary requests call `plan_local_itinerary` first,
  weather-sensitive plans call `get_weather_forecast`, and meal/cafe/dinner/drinks/food-crawl stops
  call `search_places` when live status, map identity, or open-now confidence matters.
- Preserved source-caveat rules for provider failures and unchecked itinerary signals.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed (`biome check .`, 195 files checked).
- `bun run typecheck --incremental false`: passed.
- `bun test src/server/chat/agent-memory.test.ts`: passed (5 tests).
- `bun run agent-memory:sync -- --dry-run`: passed; reported dry-run uploads for 3 reference
  files and no real upload.
- `bun test`: passed (329 tests across 41 files).

Commit: `Document itinerary tool behavior`.

Next step: Step 9, final verification and handoff.

### Step 9: Final Verification and Handoff

Completed:

- Ran the full broad verification suite for the completed Local Itinerary Builder slice.
- Reviewed `CHANGELOG.md` under `## [Unreleased]`; existing Added and Changed entries cover the
  itinerary artifact contract, planning tool, weather/Places requirements, API response, UI
  renderer, behavior coverage, and documentation updates.
- Confirmed no introduced failures remained.
- Kept `PLAN.md` tracked as the committed implementation plan input for this slice.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed (`biome check .`, 195 files checked).
- `bun run typecheck --incremental false`: passed.
- `bun test`: passed (329 tests across 41 files).
- `bun run build`: passed.
- `bun run test:e2e`: passed (22 tests).
- `bun run db:migrate:test && bun run db:seed:test`: not run; no database-backed tests or
  database behavior were added or changed in the final verification step.

Commit: `Verify local itinerary builder`.

Next step: post-verification chat runtime hardening remained in the working tree and was completed
in the follow-up section below.

### Follow-up: Itinerary Repair Classification and Evidence Matching

Completed:

- Tightened deterministic itinerary repair so non-itinerary logistics, transfer, broad trip-planning,
  critique, and not-surfing food/place prompts do not force `plan_local_itinerary`.
- Preserved itinerary enforcement for scoped local plans that mention airport/ferry timing, including
  food crawls, half-day non-surfer routes, and transport-mode constraints such as van.
- Matched structured itinerary weather and Places mutations to successful required tool-call
  arguments, and normalized production tool results with their Responses function-call IDs.
- Updated route and agent regressions for duration-bearing airport transfers, not-surfing food
  prompts, ferry-timed food crawls, airport-timed half-day routes, production Places hydration, and
  unrelated weather/Places evidence.
- Added a matching `CHANGELOG.md` entry under `## [Unreleased]`.

Validation:

- `bun run format`: passed.
- `bun run lint`: passed (`biome check .`, 195 files checked).
- `bun run typecheck --incremental false`: passed.
- `bun test src/server/chat/ask-siargao-agent.test.ts src/app/api/chat/route.test.ts`: passed.
- `bun test`: passed (370 tests across 41 files).
- `bun run build`: passed.

Commit: not committed; changes remain in the working tree.

Next step: commit the follow-up hardening when ready.

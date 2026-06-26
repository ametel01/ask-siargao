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
- [ ] Step 5: Return Itinerary Artifacts From `/api/chat`
- [ ] Step 6: Render Itinerary Plans in the Chat UI
- [ ] Step 7: Add End-to-End Itinerary Behavior Coverage
- [ ] Step 8: Update Developer and Agent Documentation
- [ ] Step 9: Final Verification and Handoff

## Current Status

Step 4 is complete. Step 5 is next.

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

Commit: `Connect itinerary plans to weather and places tools`.

Next step: Step 5, return itinerary artifacts from `/api/chat`.

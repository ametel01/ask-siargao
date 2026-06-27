# Implementation Plan

## Source Documents

- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
  - Role: Primary roadmap and feature specification.
  - Summary: Only `Priority 8: Local Itinerary Builder` is in scope. Ask Siargao
    should produce 2-4 hour practical plans, not generic lists. Itinerary answers
    must be AI-written after the agent retrieves local guide data, weather data,
    and live place data when needed. The structured output shape is
    `ItineraryPlan` with sequenced stops, fallback stops, skip guidance, and
    source summaries. Initial acceptance coverage must include rainy Cloud 9
    afternoon, sunset plus dinner, non-surfer or sandy beach half-day, food crawl,
    route-aware constraints, automatic weather use for rainy-day plans, and
    Places use for live dinner or cafe status.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
  - Role: Architecture constraints.
  - Summary: Ask Siargao is an AI travel agent backed by tools. Every chat
    request goes to the AI, the AI chooses tools, backend tools enforce provider
    policy and return structured results, and the AI writes the final answer. The
    backend must not replace final answers with deterministic templates. Tooling
    should stay read-only, source-governed, schema-validated, bounded, and
    observable.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`
  - Role: Product positioning and answer-quality constraints.
  - Summary: Ask Siargao should win as a Siargao trip copilot that uses AI plus
    live local tools to decide what is open, nearby, safe, weather-appropriate,
    and locally sensible right now. Local itineraries should be actionable and
    include sequence, travel time, fallback, what to skip, and source caveats.
    Generic model reasoning must not be labeled as live checked.

## Goals

- Add a Local Itinerary Builder that supports 2-4 hour Siargao plans from chat.
- Keep final itinerary prose AI-written through the existing Ask Siargao agent
  runtime.
- Provide structured itinerary artifacts alongside markdown so clients can render
  plans without parsing prose.
- Combine existing local guide, weather, Google Places, source policy, and trip
  context tools in a governed way.
- Cover the initial itinerary themes: rainy Cloud 9 afternoon, sunset plus
  dinner, sandy beach half-day or non-surfer half-day, and food crawl.
- Preserve source caveats, Google Places field-mask/retention constraints, and
  source-consistency validation.

## Non-Goals

- Do not build saved itineraries, sharing, or user accounts. Those belong to the
  later save/share roadmap priority.
- Do not add consent-based geolocation or near-me browser location capture.
- Do not implement tide, surf, swell, road flooding, or safety fusion beyond
  clearly marking those signals as not checked.
- Do not replace the agent runtime with deterministic route rendering.
- Do not introduce a new mapping, routing, or distance provider. Use available
  local guide estimates and clearly label travel time as an estimate.
- Do not broaden the work to all roadmap priorities.

## Assumptions and Open Questions

- Assumption: Prior roadmap foundations already present in this repo remain the
  base: `src/server/chat/ask-siargao-agent.ts`, `src/server/chat/agent-tools.ts`,
  `src/server/chat/agent-runtime.ts`, `src/app/api/chat/chat-route.ts`, and
  `src/features/chat/ChatWorkspace.tsx`.
  Impact: The itinerary builder should extend these contracts instead of adding
  a parallel route or runtime.
- Assumption: Itinerary travel times can be heuristic estimates from curated
  guide data and known area transitions, not live route calculations.
  Impact: Plans must phrase travel time as estimated and include road/weather
  caveats.
- Assumption: Weather checks are available through existing Open-Meteo snapshots
  for known Siargao locations only.
  Impact: The agent should choose the nearest supported forecast location and
  say what was not checked.
- Assumption: Live open-now checks for dinner, cafe, and food-crawl stops depend
  on Google Places availability and allowed field masks.
  Impact: Provider failures should produce bounded itinerary guidance with
  provider-unavailable source evidence, not fabricated live status.
- Assumption: The UI can render itinerary artifacts in the existing chat stream
  without redesigning the whole chat product.
  Impact: UI work should add a focused itinerary renderer and preserve markdown
  fallback.
- Open question: Should the agent request clarification when origin, time window,
  or transport mode is missing, or default to General Luna / Cloud 9 and 2-4
  hours?
  Impact: Use a conservative default in tests, but document missing context in
  caveats and ask follow-up only when the request is too ambiguous to produce a
  useful plan.

## Quality Gates

- Setup status: Existing gates are configured in `package.json`, `biome.json`,
  `tsconfig.json`, and `playwright.config.ts`. No quality-gate setup step is
  required before implementation.
- Baseline command:
  `bun run lint && bun run typecheck --incremental false && bun test`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates:
  - Typecheck: `bun run typecheck --incremental false`
  - Build: `bun run build`
  - Database test setup when database-backed tests are added or touched:
    `bun run db:migrate:test && bun run db:seed:test`
  - E2E: `bun run test:e2e`
  - Full broad verification before final handoff:
    `bun run format && bun run lint && bun run typecheck --incremental false && bun test && bun run build && bun run test:e2e`

## Progress Tracking

- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or
  implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the
  completed step, validation results, commit reference if available, current
  status, and next step.

## Changelog Tracking

- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Create `CHANGELOG.md` before any quality-gate setup or
  implementation work begins. If `CHANGELOG.md` already exists, preserve its
  history and validate that it follows the required structure before adding new
  entries.
- Initial content: Include `# Changelog`, the standard preamble, and an
  `## [Unreleased]` section.
- Update rule: After each step is completed and validated, update
  `CHANGELOG.md` with human-readable notable changes under the appropriate
  `Unreleased` change-type headings before creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup

Goal: Create durable progress and changelog files the user can consult while the
plan is being executed.

Depends on:

- None

Changes:

- Create `PROGRESS.md` in the project root.
- Add the plan title, source document paths, a step checklist, current status,
  and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Inspect existing `CHANGELOG.md`.
- If `CHANGELOG.md` exists, preserve existing entries and ensure it has
  `# Changelog`, the standard Keep a Changelog preamble, and
  `## [Unreleased]`.
- If `CHANGELOG.md` is missing, create it before any implementation work begins
  with Keep a Changelog 1.0.0 structure.
- Document that `CHANGELOG.md` must be updated after each step is completed and
  validated, before that step is committed.

Acceptance Criteria:

- `PROGRESS.md` exists and lists every planned step with status markers.
- `CHANGELOG.md` exists and has a Keep a Changelog 1.0.0-compatible
  `## [Unreleased]` section.
- No application behavior changes are made in this step.

Validation:

- Run `test -f PROGRESS.md`
- Run `test -f CHANGELOG.md`
- Run `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`
- Run `rg -n "Local Itinerary Builder|Step 0|Step 1" PROGRESS.md`

Progress:

- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the
  current status, and identify Step 1 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for establishing progress and
  changelog tracking for the Local Itinerary Builder plan.

Commit:

- `Track itinerary builder execution progress`

### Step 1: Baseline Quality Gate Run

Goal: Record the repository's pre-implementation quality baseline so later
failures can be distinguished from pre-existing failures.

Depends on:

- Step 0

Changes:

- Do not change source behavior.
- Run the baseline gates and record results in `PROGRESS.md`.
- If a gate fails for pre-existing reasons, record the command, failure summary,
  and whether it blocks itinerary implementation.
- If formatting changes are produced by `bun run format`, review the diff and
  include them only if they are required to establish the baseline.

Acceptance Criteria:

- Baseline results are visible in `PROGRESS.md`.
- Any pre-existing failures are documented with enough detail for a later agent
  to distinguish them from itinerary regressions.
- The repository remains in a working state.

Validation:

- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 2 as next.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` only if baseline work creates a
  notable repository change, such as documented gate behavior.

Commit:

- `Record itinerary builder quality baseline`

### Step 2: Add Shared Itinerary Artifact Types

Goal: Define the structured itinerary contract in the server runtime without
changing agent behavior yet.

Depends on:

- Step 0
- Step 1

Changes:

- Update `src/server/chat/agent-runtime.ts`:
  - Add `ItineraryPlan` matching the roadmap fields:
    `title`, `durationLabel`, `stops`, `fallbackStops`, `skip`, and `sources`.
  - Add `ItineraryStop` with `title`, `kind`, `sequence`, optional `area`,
    optional `travelTimeFromPreviousMinutes`, optional `mapsUrl`, `rationale`,
    and `caveats`.
  - Add `ItineraryStopKind` as
    `"place" | "beach" | "activity" | "meal" | "transfer"`.
  - Extend `AgentToolResult`, `AgentArtifactCarrier`, and `AgentTurnResult` to
    carry `itineraries?: readonly ItineraryPlan[]`.
  - Extend `createAgentTurnResult` to merge itinerary artifacts from tool
    results, dedupe by a stable key such as title plus duration, and preserve
    existing `cards` and `actions` behavior.
- Add or update `src/server/chat/agent-runtime.test.ts`:
  - Assert itinerary artifacts are merged from tool results.
  - Assert duplicate itinerary artifacts are not returned twice.
  - Assert existing `cards`, `actions`, and `sources` aggregation still works.

Acceptance Criteria:

- Runtime types support itinerary artifacts.
- Existing card/action source aggregation behavior is unchanged.
- Tests describe the new artifact aggregation behavior before itinerary tools
  depend on it.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/agent-runtime.test.ts`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 3 as next.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for the
  shared itinerary artifact contract.

Commit:

- `Add itinerary artifact contract`

### Step 3: Build Deterministic Itinerary Planning Tool Data

Goal: Add a backend itinerary planning tool that returns governed structured
evidence and artifacts while leaving final wording to the AI.

Depends on:

- Step 2

Changes:

- Add `src/server/chat/itinerary-tools.ts`:
  - Define a strict Zod schema for itinerary requests, with fields such as:
    `theme`, `origin`, `duration_hours`, `transport_mode`, `max_ride_minutes`,
    `needs_weather_check`, `needs_open_now`, `meal_preference`, and
    `constraints`.
  - Support initial themes:
    `"rainy_cloud_9_afternoon"`, `"sunset_plus_dinner"`,
    `"sandy_beach_half_day"`, `"non_surfer_half_day"`, and `"food_crawl"`.
  - Compose existing local guide data via `searchSiargaoLocalGuide`.
  - Return `ItineraryPlan` artifacts with sequenced stops, fallback stops, skip
    guidance, source summaries, and caveats.
  - Treat travel time as an estimate from local guide and area knowledge.
  - Include provider-unchecked caveats for surf, tide, road flooding, closures,
    and safety when no tool checked them.
  - Keep the tool deterministic only for data shaping and constraints; do not
    render final user-facing prose.
- Update `src/server/chat/agent-runtime.ts` tool-name union to include
  `plan_local_itinerary`.
- Update `src/server/chat/agent-tools.ts`:
  - Register `plan_local_itinerary` with a strict function schema.
  - Return `AgentToolResult` with `data`, `sources`, `itineraries`, and relevant
    `actions`.
  - Make the tool description clear that the AI must use the returned plan as
    evidence and write the final answer itself.
- Update `src/server/chat/ask-siargao-agent.ts`:
  - Add provider operation mapping for `plan_local_itinerary` if needed.
  - Add instruction text telling the model to call itinerary planning for 2-4
    hour plan requests and then write concise practical prose from the returned
    artifact.
  - Preserve existing source consistency instructions.
- Add `src/server/chat/itinerary-tools.test.ts`:
  - Rainy Cloud 9 afternoon includes weather-needed/source caveats, fallbacks,
    and skip guidance.
  - Sunset plus dinner includes route-aware sequence and a meal stop placeholder
    that requires Places when live status matters.
  - Sandy beach half-day excludes far north options under a 30-minute constraint.
  - Non-surfer half-day avoids surf-only stops.
  - Food crawl includes meal sequencing and clearly marks live open status as
    not checked unless Places is used by a later step.

Acceptance Criteria:

- `plan_local_itinerary` is available as an agent tool.
- The tool returns a valid `ItineraryPlan` artifact and source summaries.
- The tool does not produce deterministic final chat prose.
- Initial itinerary themes have focused unit coverage.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/itinerary-tools.test.ts`
- Run `bun test src/server/chat/agent-tools.test.ts`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 4 as next.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for the
  itinerary planning tool and initial theme support.

Commit:

- `Add local itinerary planning tool`

### Step 4: Integrate Weather and Places Requirements Into Itinerary Flow

Goal: Ensure itinerary prompts use the right live tools when weather or open-now
status materially affects the plan.

Depends on:

- Step 3

Changes:

- Update `src/server/chat/agent-tools.ts` and `src/server/chat/itinerary-tools.ts`:
  - Add fields to itinerary tool output that tell the agent which follow-up tool
    checks are required, such as `requiredToolChecks.weather` and
    `requiredToolChecks.places`.
  - Include suggested Places queries for dinner, cafe, and food-crawl stops with
    radius and known Siargao center guidance.
  - Include suggested weather location and date range for rainy-day or
    weather-sensitive plans.
  - Keep Google Places field-mask and retention constraints delegated to the
    existing `search_places` and `get_place_details` tools.
- Update `src/server/chat/ask-siargao-agent.ts` instructions:
  - Require `get_weather_forecast` for rainy-day, today, weather-sensitive, or
    outdoor-exposure itinerary prompts before final answer.
  - Require `search_places` when a meal, cafe, drinks, or food-crawl stop needs
    live existence, map URL, or open-now status.
  - Require the final answer to distinguish checked weather, live/fresh-cache
    Places, curated local guide, and not-checked caveats.
- Update `src/server/chat/source-consistency.ts` only if itinerary source labels
  require validation changes. Prefer reusing existing labels and source matching.
- Add or update `src/server/chat/ask-siargao-agent.test.ts` with fake model/tool
  loops:
  - Rainy Cloud 9 itinerary calls `plan_local_itinerary` and
    `get_weather_forecast` before final prose.
  - Sunset plus dinner calls `plan_local_itinerary` and `search_places`.
  - Food crawl calls `search_places` for live food options.
  - Provider failure from Places is surfaced as caveated guidance, not live
    checked status.
- Add or update `src/server/chat/source-consistency.test.ts`:
  - Itinerary answers with checked labels must have matching tool evidence.
  - Itinerary answers with generic planning only can use `not_verified` caveats
    without being rejected.

Acceptance Criteria:

- Rainy-day plans automatically use weather evidence.
- Dinner/cafe/food-crawl plans use Places evidence when live status matters.
- Source labels remain tool-backed and validated.
- Provider failures produce explicit caveats.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/ask-siargao-agent.test.ts`
- Run `bun test src/server/chat/source-consistency.test.ts`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 5 as next.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` or `Changed`
  entry for weather- and Places-aware itinerary orchestration.

Commit:

- `Connect itinerary plans to weather and places tools`

### Step 5: Return Itinerary Artifacts From `/api/chat`

Goal: Expose itinerary artifacts through the existing chat API response while
preserving markdown fallback and observability.

Depends on:

- Step 4

Changes:

- Update `src/app/api/chat/chat-route.ts`:
  - Include `itineraries` in the JSON response when the agent result has
    itinerary artifacts.
  - Include itinerary counts in structured logs without logging restricted
    provider payloads.
  - Keep deterministic signals for itinerary-like prompts, including
    `activityPlan`, `tripContext.activeGoal`, `weatherSensitive`, and
    `placeIntent` where relevant.
  - Do not add route-level deterministic itinerary prose.
- Update `src/app/api/chat/route.test.ts`:
  - Assert itinerary artifacts are returned with `message`, `toolCalls`,
    `sources`, and existing metadata.
  - Assert no `itineraries` field is emitted when empty.
  - Add route tests for rainy Cloud 9 afternoon, sunset plus dinner, sandy beach
    half-day, and food crawl using mocked agent results.
  - Assert source-consistency failures still return the controlled error shape.
- Update any shared client-facing response types in
  `src/features/chat/ChatWorkspace.tsx` or adjacent files if the current UI owns
  the response shape locally.

Acceptance Criteria:

- `/api/chat` can return `itineraries` without breaking existing `cards` and
  `actions`.
- Route tests cover initial itinerary scenarios at the API boundary.
- The markdown answer remains present for clients that ignore structured fields.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 6 as next.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for chat
  API itinerary artifacts.

Commit:

- `Return itinerary artifacts from chat API`

### Step 6: Render Itinerary Plans in the Chat UI

Goal: Show itinerary artifacts as accessible, scan-friendly plan cards in the
chat stream while keeping the markdown answer as fallback.

Depends on:

- Step 5

Changes:

- Update `src/features/chat/ChatWorkspace.tsx`:
  - Extend assistant message state to store `itineraries`.
  - Parse `itineraries` from `/api/chat` responses.
  - Add an `ItineraryPlans` renderer below markdown and above or near actions.
  - Render plan title, duration label, sequenced stops, estimated travel time,
    maps links, rationale, caveats, fallback stops, skip guidance, and source
    labels.
  - Use existing visual language and lucide icons; avoid nested card shells.
  - Ensure long stop titles, URLs, caveats, and source labels wrap inside the
    mobile chat column.
  - Keep recommendation cards working unchanged.
- Update `tests/e2e/chat.e2e.ts`:
  - Mock an itinerary response and assert sequence, fallback, skip guidance,
    source caveats, and map links render.
  - Add mobile-width coverage for itinerary layout containment.
  - Assert markdown-only fallback still renders when `itineraries` is absent.
- If a local component test setup exists later, add focused React tests for the
  itinerary renderer. If not, keep the coverage in Playwright to match existing
  chat UI tests.

Acceptance Criteria:

- Itinerary artifacts render in chat with sequence and fallbacks visible.
- Map links open in a new tab and use returned URLs when present.
- Source caveats remain visible.
- Mobile layout has no overflow or text overlap.
- Markdown-only clients and responses still work.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run test:e2e -- tests/e2e/chat.e2e.ts`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 7 as next.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for chat
  UI itinerary rendering.

Commit:

- `Render itinerary plans in chat`

### Step 7: Add End-to-End Itinerary Behavior Coverage

Goal: Verify the full Local Itinerary Builder behavior across agent runtime,
route response, and UI for the initial themes.

Depends on:

- Step 6

Changes:

- Expand `src/server/chat/agent-tools.test.ts`,
  `src/server/chat/itinerary-tools.test.ts`,
  `src/server/chat/ask-siargao-agent.test.ts`, and
  `src/app/api/chat/route.test.ts` as needed to cover acceptance gaps left by
  earlier steps.
- Expand `tests/e2e/chat.e2e.ts`:
  - Rainy Cloud 9 afternoon renders a short sequence, fallback, weather caveat,
    and skip guidance.
  - Sunset plus dinner renders route-aware stops with a dinner/cafe place card or
    itinerary stop map link when available.
  - Sandy beach half-day or non-surfer half-day avoids mismatched stops.
  - Food crawl shows sequenced meal stops and live-check caveats.
- Add test fixtures only where needed; keep mocked responses deterministic.
- Avoid live provider calls in unit and e2e tests.

Acceptance Criteria:

- Each roadmap test theme has automated coverage.
- High rain probability or rainy prompt coverage shows fallback substitution.
- Tests prove itinerary prompts do not degrade to generic brainstorms.
- Tests do not depend on live Google Places, Open-Meteo, or OpenAI calls.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run test:e2e`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 8 as next.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for
  itinerary behavior coverage.

Commit:

- `Cover itinerary builder scenarios`

### Step 8: Update Developer and Agent Documentation

Goal: Document how the Local Itinerary Builder works so future agents preserve
the AI-written, source-governed contract.

Depends on:

- Step 7

Changes:

- Update relevant docs, choosing the smallest set that matches existing
  structure:
  - `README.md` only if user-facing or developer setup behavior changed.
  - `documentation/developer/reference/environment.md` only if new environment
    variables are introduced. Prefer no new environment variables for this
    feature.
  - `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md` or equivalent agent
    memory files if present, documenting when itinerary prompts should call
    weather, Places, local guide, and source policy tools.
  - `docs/ASK_SIARGAO_ROADMAP.md` only if the team tracks completed roadmap
    state in the roadmap document.
- Document:
  - `plan_local_itinerary` is evidence/artifact generation, not final prose.
  - Weather-sensitive itineraries require weather checks.
  - Meal/cafe/food-crawl stops require Places checks when live status matters.
  - Surf, tide, road flooding, closures, and safety remain unchecked unless a
    future tool provides them.

Acceptance Criteria:

- Future maintainers can find the itinerary tool contract and source-caveat
  rules.
- Documentation does not claim tide/surf/road/safety checks exist.
- No secrets or provider payload fields are documented incorrectly.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit
  reference if available, current status, and Step 9 as next.

Changelog:

- Update `CHANGELOG.md` under `## [Unreleased]` with a `Changed` entry for
  itinerary builder documentation.

Commit:

- `Document itinerary tool behavior`

### Step 9: Final Verification and Handoff

Goal: Run broad quality gates, fix regressions, and leave a clear execution
record.

Depends on:

- Step 8

Changes:

- Run the full broad verification suite.
- Fix failures introduced by the itinerary work.
- Review final diffs for unrelated changes and remove only changes made by this
  implementation that are not required for the feature.
- Ensure `PROGRESS.md` and `CHANGELOG.md` reflect the final status.
- Prepare a concise handoff summary with validation results and any known
  residual risks.

Acceptance Criteria:

- All required gates pass, or any remaining failures are documented as
  pre-existing or externally blocked.
- `PROGRESS.md` shows every step complete with validation notes.
- `CHANGELOG.md` has human-readable `## [Unreleased]` entries for the itinerary
  feature.
- The final implementation is split into focused commits from prior steps.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run build`
- Run `bun run test:e2e`
- If database-backed tests were added or changed, run
  `bun run db:migrate:test && bun run db:seed:test`

Progress:

- Update `PROGRESS.md` with final validation results, commit references, current
  status, and no next implementation step.

Changelog:

- Review `CHANGELOG.md` under `## [Unreleased]` for complete, human-readable
  `Added`, `Changed`, and `Fixed` entries as applicable.

Commit:

- `Verify local itinerary builder`

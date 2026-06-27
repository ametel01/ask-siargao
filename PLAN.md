# Implementation Plan

## Source Documents

- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
  - Role: Primary roadmap/specification.
  - Summary: Implement only `Priority 9: Weather, Tide, And Surf Fusion`. Ask Siargao should turn
    weather, tide, surf, road, and caveat signals into a practical condition judgment for activities
    such as swimming, surfing, scooter trips, rain plans, sunset, and boat trips. Initial
    implementation must use existing Open-Meteo data and curated local caveats; tide and surf remain
    explicitly `not_checked` until approved providers are integrated. Weather-sensitive answers must
    include recommendation, reasons, alternatives, and caveats, with concise decision-oriented prose.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
  - Role: Architecture constraints.
  - Summary: Every chat request must go through the AI agent, the model decides whether to call
    tools, backend code executes tools and validates source governance, and final traveler-facing
    responses must be model-written. Deterministic code may classify, retrieve, validate, and enforce
    policy, but must not replace the AI answer with templates.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`
  - Role: Product positioning and quality bar.
  - Summary: Ask Siargao should win as a Siargao trip copilot that combines AI with live local tools
    to decide what is open, nearby, safe, weather-appropriate, and locally sensible. Weather, tide,
    and surf fusion should produce practical condition judgments, preserve explicit unchecked
    signals, and emphasize actionability, specificity, freshness, and trust.

## Goals

- Add a governed condition-judgment capability that combines existing Open-Meteo weather signals,
  curated local caveats, and explicit unchecked tide/surf/road/manual caveat signals.
- Expose the capability through the existing Responses tool loop so the model can request condition
  judgments and still write the final answer.
- Support user-visible decisions for swimming, surfing, scooter, rain-plan, sunset, and boat-trip
  prompts with recommendation, reasons, alternatives, source-backed signals, and caveats.
- Ensure weather-sensitive beach answers can merge curated beach suitability with condition
  judgments without implying tide, surf, road, lifeguard, or safety checks were performed.
- Preserve source-label consistency: `weather_checked` only for Open-Meteo-backed weather signals,
  `curated_local_guide` only for curated beach/local caveats, `not_verified` for explicitly
  unchecked tide/surf/road/manual caveats, and `provider_unavailable` when weather cannot be fetched.

## Non-Goals

- Do not integrate new tide, surf, swell, road-flooding, lifeguard, rescue, official warning, or
  marine providers in this slice.
- Do not claim real-time safety, swimming safety, current, tide, swell, or road conditions beyond
  the sources actually checked.
- Do not replace AI-written final responses with deterministic condition prose.
- Do not build a new UI surface that is unrelated to chat, itinerary cards, recommendation cards,
  or existing source/caveat rendering.
- Do not bulk-index new local datasets outside the narrow curated caveat support needed for the
  first condition judgments.
- Do not add unrestricted database or SQL access.

## Assumptions and Open Questions

- Assumption: The first implementation can model `ConditionSignal` and `ConditionJudgment` in
  `src/server/chat` without adding database migrations. Impact: the feature can ship as a tool
  result and optional chat artifact before any persistence work.
- Assumption: Existing Open-Meteo fields are enough for first-pass weather thresholds:
  precipitation probability, precipitation/rain amount, wind speed, and wind gust. Impact:
  recommendations will be conservative and caveated, not marine-safety authoritative.
- Assumption: Curated local beach notes in `src/server/local/siargao-beaches.ts` can supply initial
  suitability and manual caveats for swimming/sunset/rain-fit answers. Impact: beach-specific
  judgments can be useful without pretending live tide/surf checks exist.
- Assumption: Condition judgments should be a new agent tool rather than hidden route-level prose.
  Impact: this respects the AI-led architecture while making source-backed decision data available.
- Open question: Should condition judgments be returned as structured UI artifacts in addition to
  model-facing tool text? Conservative choice: start with tool data and source summaries, then add a
  small optional UI artifact only if route/UI tests show source/caveat readability needs it.
- Open question: What exact thresholds define `good`, `flexible`, `avoid`, and
  `needs_local_confirmation` per activity? Conservative choice: implement documented, tested
  thresholds and tune later from user feedback.
- Open question: Should boat-trip judgments include Del Carmen/Sugba-specific weather location
  selection? Conservative choice: map Del Carmen/Sugba prompts to the existing Del Carmen
  Open-Meteo location and caveat marine/tide/surf as not checked.
- Current workspace note: `docs/ASK_SIARGAO_ROADMAP.md` has an unrelated Priority 8 completion
  marker. Implementation should preserve unrelated user-owned changes and use Step 0 to
  recreate/restore tracking files before feature work.

## Quality Gates

- Setup status: Existing gates are configured in `package.json`, `biome.json`, `tsconfig.json`, and
  `playwright.config.ts`; no new quality-gate setup step is required.
- Baseline command: `bun run format && bun run lint && bun run typecheck --incremental false && bun test`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Focused test commands:
  - `bun test src/server/chat/agent-tools.test.ts src/server/chat/ask-siargao-agent.test.ts src/server/chat/agent-runtime.test.ts src/app/api/chat/route.test.ts`
  - `bun test src/server/providers/open-meteo.test.ts src/server/chat/local-recommendation.test.ts src/server/chat/itinerary-tools.test.ts`
- Additional gates:
  - Typecheck: `bun run typecheck --incremental false`
  - Production build: `bun run build`
  - E2E for changed chat rendering, if UI artifacts are added: `bun run test:e2e`
  - Agent memory dry run, if memory files change: `bun run agent-memory:sync -- --dry-run`
  - Database gates, only if DB-backed behavior is changed: `bun run db:migrate:test && bun run db:seed:test`

## Progress Tracking

- File: `PROGRESS.md`
- Requirement: Create or restore `PROGRESS.md` before any quality-gate setup or implementation work
  begins.
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

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup

Goal: Create durable progress and changelog files the user can consult while the Priority 9 plan is
being executed.

Changes:

- Create or restore `PROGRESS.md` in the project root.
- Add this plan title, source document paths, a step checklist, current status, and a short update
  log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Ensure `CHANGELOG.md` exists in the project root before implementation work begins.
- Ensure `CHANGELOG.md` follows Keep a Changelog 1.0.0 structure: `# Changelog`, the standard
  preamble, and `## [Unreleased]`.
- Preserve existing `CHANGELOG.md` entries and add only a new tracking entry for Priority 9.
- Do not revert unrelated current working-tree changes unless explicitly requested.

Acceptance Criteria:

- `PROGRESS.md` exists and lists all steps in this plan.
- `CHANGELOG.md` exists, keeps existing history, and has an `## [Unreleased]` section.
- The current status identifies Step 1 as the next step.

Validation:

- Run `test -f PROGRESS.md`
- Run `test -f CHANGELOG.md`
- Run `rg -n "Priority 9|Weather, Tide, And Surf Fusion" PROGRESS.md CHANGELOG.md`
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`

Progress:

- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status, and
  identify Step 1 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for establishing Priority 9 progress and changelog
  tracking.

Commit:

- `Track weather tide surf fusion plan`

### Step 1: Baseline Characterization And Contracts

Goal: Establish failing or skipped characterization coverage for condition judgment contracts before
implementation changes.

Depends on:

- Step 0

Changes:

- Add condition-domain type contracts and test fixtures without changing production behavior yet.
- Target likely files:
  - `src/server/chat/condition-tools.ts` for new exported TypeScript types and placeholder builder
    interfaces.
  - `src/server/chat/condition-tools.test.ts` for expected `ConditionSignal` and
    `ConditionJudgment` shape, threshold cases, and unchecked tide/surf behavior.
  - `src/server/chat/agent-tools.test.ts` for strict Responses schema expectations for a future
    `get_condition_judgment` tool.
  - `src/server/chat/source-consistency.test.ts` for source-label expectations around weather,
    curated caveats, and unchecked tide/surf signals.
- Do not expose the new tool to the agent until Step 2.

Acceptance Criteria:

- The planned `ConditionSignal` and `ConditionJudgment` shape is captured in tests.
- Tests document that tide and surf are `not_checked` until providers exist.
- Tests document that raw weather is not enough; the system must produce a recommendation,
  reasons, alternatives, and signals.
- Any intentionally failing tests are committed only if the repo convention allows it; otherwise
  write skipped/TODO tests with exact acceptance criteria and make them active in Step 2.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/condition-tools.test.ts src/server/chat/source-consistency.test.ts`
- Run `bun test`
- Run `bun run build`

Progress:

- Update `PROGRESS.md` with completed characterization work, validation results, commit reference if
  available, current status, and Step 2 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for condition judgment contract coverage.

Commit:

- `Characterize condition judgment contracts`

### Step 2: Condition Judgment Builder

Goal: Implement the deterministic, source-governed condition judgment builder used by the AI tool.

Depends on:

- Step 0
- Step 1

Changes:

- Implement `src/server/chat/condition-tools.ts` with:
  - `ConditionSignal` and `ConditionJudgment` exports matching the roadmap.
  - Activity enum: `swimming`, `surfing`, `scooter`, `rain_plan`, `sunset`, `boat_trip`.
  - Recommendation enum: `good`, `flexible`, `avoid`, `needs_local_confirmation`.
  - Threshold helpers for Open-Meteo precipitation probability, rain amount, wind speed, and wind
    gust.
  - Signal builders for `weather`, `tide`, `surf`, `road`, and `manual_caveat`.
  - `weather` signals with `status: "checked"` only when usable Open-Meteo data is present.
  - `tide` and `surf` signals with `status: "not_checked"` for all first-slice outputs.
  - `road` signals with `status: "not_checked"` unless only generic curated caveats are available.
  - Activity-specific alternatives such as covered cafe/rain plan, sunset with caveat, or beach
    fallback that requires local confirmation.
- Reuse existing `AnswerSourceSummary` and trust labels from
  `src/server/chat/answer-source-summary.ts`.
- Reuse `WeatherSnapshot` from `src/server/public-pages/weather-snapshot.ts` and Open-Meteo
  summary semantics from `src/server/providers/open-meteo.ts`.
- Add/activate tests in `src/server/chat/condition-tools.test.ts` for:
  - Low-risk weather yielding `good` or `flexible` depending on activity.
  - High rain/wind yielding `avoid` for scooter/boat/open beach activities.
  - Sunset handling that distinguishes cloud/rain risk from tide/surf uncertainty.
  - Swimming answers including weather, tide, surf, and manual caveat signals.
  - Provider-unavailable weather producing `needs_local_confirmation` or conservative alternatives.

Acceptance Criteria:

- All activity types produce a complete judgment with recommendation, reasons, alternatives, and
  signals.
- Tide and surf are always present as `not_checked` when relevant to swimming, surfing, or boat
  trips.
- Weather facts are concise, normalized, and traceable to `weather_checked` or
  `provider_unavailable`.
- The builder has no user-facing final prose templates; it returns structured evidence only.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/condition-tools.test.ts src/server/providers/open-meteo.test.ts`
- Run `bun test`
- Run `bun run build`

Progress:

- Update `PROGRESS.md` with completed builder work, validation results, commit reference if
  available, current status, and Step 3 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for the source-governed condition judgment builder.

Commit:

- `Add condition judgment builder`

### Step 3: Agent Tool Schema And Execution

Goal: Expose condition judgments as an AI-callable backend tool while preserving strict schema and
source governance.

Depends on:

- Step 0
- Step 1
- Step 2

Changes:

- Add `get_condition_judgment` to `AskSiargaoAgentToolName` in
  `src/server/chat/agent-runtime.ts`.
- Register the tool in `src/server/chat/agent-tools.ts` with a strict Responses schema:
  - Required nullable/required fields matching current strict-schema conventions.
  - Arguments such as `activity`, `location`, `date_range`, optional `beach_name`,
    `include_local_caveats`, and optional user constraints.
  - Location enum aligned with existing weather locations: `Siargao Island`, `Cloud 9`,
    `General Luna`, `Del Carmen`.
- Execute the tool by:
  - Calling existing `getLatestSiargaoWeatherSnapshot`.
  - Selecting General Luna/Cloud 9/Del Carmen weather context conservatively.
  - Querying curated local guide data only through existing safe local guide helpers when beach
    suitability or manual caveats matter.
  - Returning `AgentToolResult` with model-facing text, structured `data.judgment`, source
    summaries, and no final traveler prose.
- Update `providerOperationForTool` in `src/server/chat/ask-siargao-agent.ts`.
- Update source policy descriptions if needed so the model understands condition signal labels.
- Add tests in `src/server/chat/agent-tools.test.ts` for:
  - Strict schema validity.
  - Successful weather-backed judgment.
  - Provider-unavailable weather.
  - Tide/surf not checked.
  - Curated beach caveats included without pretending live safety checks occurred.

Acceptance Criteria:

- The model can call `get_condition_judgment` through the existing tool loop.
- The tool never returns raw provider payloads or unsupported safety claims.
- Source summaries correctly distinguish weather checked, curated guide, not verified, and provider
  unavailable.
- Existing strict-schema tests pass with the new tool.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/agent-tools.test.ts src/server/chat/ask-siargao-agent.test.ts`
- Run `bun test`
- Run `bun run build`

Progress:

- Update `PROGRESS.md` with completed tool work, validation results, commit reference if available,
  current status, and Step 4 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for the condition judgment agent tool.

Commit:

- `Expose condition judgment tool`

### Step 4: Agent Tool-Use Policy And Route Signals

Goal: Teach the agent when to call the condition tool without forcing deterministic final answers.

Depends on:

- Step 0
- Step 1
- Step 2
- Step 3

Changes:

- Update agent instructions/memory:
  - `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md`
  - `docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md`
  - Possibly `docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md`
- Add policy that weather-sensitive condition questions should call `get_condition_judgment`:
  - "is this beach good for swimming now"
  - "what should I avoid today"
  - "is sunset worth it"
  - "is it okay to scooter"
  - "surfing/boat trip today"
- Keep the AI-led rule: the route may pass deterministic signals, but the model chooses tools and
  writes the final answer.
- Update `src/app/api/chat/chat-route.ts` intent signals only as needed to preserve current weather,
  surf, tide, swimming, sunset, scooter, and boat-trip context for the agent.
- Add tests in:
  - `src/server/chat/ask-siargao-agent.test.ts` for tool-loop use of condition judgment before final
    prose when the model chooses it.
  - `src/app/api/chat/route.test.ts` for deterministic signals passed to the agent without preset
    route prose.
  - `src/server/chat/agent-memory.test.ts` for updated memory content.
- Run memory dry-run sync if memory documents change.

Acceptance Criteria:

- Weather-sensitive activity prompts can reach the agent with enough context to choose the condition
  tool.
- The backend does not auto-write the final answer.
- Updated memory files explicitly say tide/surf are not checked until providers exist.
- Existing weather and itinerary flows continue to work.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/ask-siargao-agent.test.ts src/app/api/chat/route.test.ts src/server/chat/agent-memory.test.ts`
- Run `bun run agent-memory:sync -- --dry-run`
- Run `bun test`
- Run `bun run build`

Progress:

- Update `PROGRESS.md` with completed route/memory work, validation results, commit reference if
  available, current status, and Step 5 as next.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for condition-aware agent tool-use policy.

Commit:

- `Teach agent condition judgment tool use`

### Step 5: Route, Runtime, And Source Consistency Integration

Goal: Ensure condition judgments pass through `/api/chat`, source validation, and final result
aggregation safely.

Depends on:

- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:

- Update `src/server/chat/agent-runtime.ts` only if condition judgments need a structured artifact
  carrier beyond `sources`, `cards`, `actions`, and `itineraries`.
- Prefer initially returning condition data in tool results and source summaries, with the final
  model answer explaining the judgment in markdown.
- If a UI artifact is needed, add a small `ConditionJudgmentArtifact` type to
  `AgentToolResult`/`AgentTurnResult` and route serialization in `src/app/api/chat/chat-route.ts`.
- Update `src/server/chat/source-consistency.ts` and tests so condition source labels must be backed
  by actual tool calls:
  - Weather checked claims require `get_condition_judgment` or `get_weather_forecast` with
    weather source.
  - Tide/surf checked claims are rejected until provider-backed tools exist.
  - Not-checked tide/surf lines are accepted when generated by condition judgment evidence.
- Add route tests for swimming, rainy-day avoid, scooter, sunset, and boat-trip prompts.
- Add regression tests that tide/surf cannot appear as checked without a provider-backed source.

Acceptance Criteria:

- `/api/chat` can return model-written answers backed by condition judgment tool evidence.
- Source validation rejects fabricated tide/surf checked labels.
- Provider-unavailable weather remains caveated instead of becoming generic advice.
- No deterministic route branch replaces final model prose.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/source-consistency.test.ts src/server/chat/agent-runtime.test.ts src/app/api/chat/route.test.ts`
- Run `bun test`
- Run `bun run build`

Progress:

- Update `PROGRESS.md` with completed integration work, validation results, commit reference if
  available, current status, and Step 6 as next.

Changelog:

- Add a `Fixed` or `Changed` entry under `## [Unreleased]` for condition source validation and route
  integration.

Commit:

- `Integrate condition judgments with chat runtime`

### Step 6: Chat UI Rendering For Condition Evidence

Goal: Make condition judgments readable in the chat UI without obscuring AI-written prose or source
caveats.

Depends on:

- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5

Changes:

- If Step 5 adds structured condition artifacts, update `src/features/chat/ChatWorkspace.tsx` to
  render:
  - Recommendation label: `good`, `flexible`, `avoid`, or `needs local confirmation`.
  - Activity label.
  - Short reasons and alternatives.
  - Signal chips or rows for weather, tide, surf, road, and manual caveat.
  - Source caveats and explicit `not checked` items.
- If no artifact is added, update markdown/source-line rendering tests only as needed to ensure
  condition answer source lines remain clear and accessible.
- Add or update Playwright tests in `tests/e2e/chat.e2e.ts` only if visible condition artifacts are
  introduced.
- Keep UI compact and practical; do not create a marketing/landing surface.

Acceptance Criteria:

- Users can distinguish checked weather from unchecked tide/surf/road caveats in the rendered chat.
- Text does not overflow on mobile.
- Existing recommendation cards and itinerary cards still render correctly.
- AI prose remains the primary answer; artifact UI supports rather than replaces it.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun test`
- Run `bun run build`
- If UI artifacts are added, run `bun run test:e2e`

Progress:

- Update `PROGRESS.md` with completed UI work, validation results, commit reference if available,
  current status, and Step 7 as next.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for condition evidence rendering if UI changes ship.
  If no UI changes are needed, record the no-op decision in `PROGRESS.md` only.

Commit:

- `Render condition judgment evidence`

### Step 7: Final Verification And Handoff

Goal: Complete broad verification, document remaining provider gaps, and leave the repository ready
for review.

Depends on:

- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6

Changes:

- Review all Priority 9 acceptance criteria against implementation and tests.
- Update `CHANGELOG.md` so the top `## [Unreleased]` entries accurately summarize shipped
  condition judgment behavior.
- Update `PROGRESS.md` with final status, validation results, commit references, and any remaining
  open questions.
- If implementation touched roadmap status, update only the relevant Priority 9 line in
  `docs/ASK_SIARGAO_ROADMAP.md` after the feature is actually complete.
- Confirm no unsupported claims were introduced around tide, surf, roads, lifeguards, marine safety,
  or official warnings.

Acceptance Criteria:

- All roadmap Priority 9 acceptance criteria are met or explicitly recorded as deferred with a clear
  reason.
- The final answer path remains model-written and tool-backed.
- Tide and surf are never labeled checked without provider evidence.
- Documentation, progress, and changelog match the implementation state.

Validation:

- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test`
- Run `bun run build`
- Run `bun run agent-memory:sync -- --dry-run` if memory files changed.
- Run `bun run test:e2e` if chat UI rendering changed.
- Run `bun run db:migrate:test && bun run db:seed:test` only if database behavior changed.

Progress:

- Update `PROGRESS.md` with final verification results, commit reference if available, current
  status, and no next implementation step unless follow-up work remains.

Changelog:

- Ensure `CHANGELOG.md` has human-readable entries under `## [Unreleased]` for every notable
  completed behavior in this slice.

Commit:

- `Verify weather tide surf fusion`

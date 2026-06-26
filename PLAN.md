# Implementation Plan

## Source Documents
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
  - Role: Primary roadmap source.
  - Summary: Only `Priority 4: AI Tool Runtime` is in scope. Ask Siargao must route
    `/api/chat` through one primary AI agent that receives every user message, decides
    which backend tools to call, executes a Responses API tool loop, and writes every
    final answer. Deterministic weather, beach, recommendation, and local-plan renderers
    become tools or validators instead of final prose writers. Initial tools are
    `get_weather_forecast`, `search_places`, `get_place_details`, `search_local_guide`,
    and `describe_source_policy`. Tool traces must be logged, provider failures must be
    returned to the model as tool output, and tests must prove common prompts invoke the
    model.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
  - Role: Supporting architecture constraints.
  - Summary: The backend is a tool runtime, not the conversational layer. It owns safety,
    source governance, provider credentials, field masks, freshness rules, rate limits,
    observability, database access boundaries, and validation. The model owns tool
    selection, synthesis, and final wording. No user-facing response should bypass the AI.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`
  - Role: Supporting product-positioning constraints.
  - Summary: Ask Siargao should win as a Siargao trip copilot with live local tools,
    curated knowledge, source caveats, and practical next-move recommendations. The AI
    must participate in every chat interaction and write final answers. Generic model
    reasoning must never be labeled as live checked data.

## Goals
- Replace the current `/api/chat` deterministic answer routing with one AI-led agent
  runtime that calls backend tools and returns AI-written final answers.
- Preserve existing request validation, Siargao scope policy, source-governance rules,
  provider field masks, rate limits, and observability as backend-owned controls.
- Expose initial backend capabilities as typed tools: weather forecast, Places search,
  Place details, curated local guide search, and source policy description.
- Return a structured `AgentTurnResult` containing `message`, local `requestId`, `model`,
  audited tool calls, source summaries, and optional future UI metadata fields.
- Ensure provider failures and missing live data are represented as tool outputs that the
  model can explain, not as preset final assistant prose.
- Add tests proving weather, Places, local guide, and general Siargao prompts go through
  the model, with regression coverage that deterministic branches cannot return final
  prose.

## Non-Goals
- Do not implement `Priority 5: Persistent Agent Memory` beyond a small inline instruction
  provider needed for the runtime.
- Do not implement `Priority 6: Safe Database And Local Knowledge Tools`; unrestricted
  database querying and SQL-like tools remain out of scope.
- Do not build map-first recommendation cards, itinerary mode, tide or surf fusion,
  geolocation, save/share flows, or UI redesigns.
- Do not expose raw restricted Google Places payloads, review text, booking availability,
  table availability, room availability, or private user data to the model.
- Do not remove existing provider modules or data-governance tests; reuse them behind tools.

## Assumptions and Open Questions
- Assumption: The implementation should use the existing `openai` dependency and Responses
  API wrapper style already present in `src/server/llm/chat-adapter.ts`, while adding the
  tool-loop behavior missing from the current adapter.
- Assumption: The local route should still reject malformed requests before any model call;
  the "no successful `/api/chat` response without an OpenAI model call" requirement applies
  to successful, valid chat requests, not `400` schema/JSON failures.
- Assumption: Out-of-scope Siargao safety is a backend validator or model instruction signal,
  but final decline wording for a valid chat request should be model-written.
- Assumption: The Priority 4 tool union mentions `describe_database_schema` and
  `query_local_facts`, but the Priority 4 initial tool list omits them and Priority 6 covers
  safe database/local-fact tools. This plan registers only the initial Priority 4 tools and
  leaves database fact querying for Priority 6.
- Open question: Whether `get_place_details` should prefer live details lookup, cached
  `google_place_details`, or a cache-first/live-fallback policy. Conservative default:
  cache-first when valid, live fallback through existing Google Places enrichment with the
  allowed identity/contact field mask only.
- Open question: Whether source caveats should be appended as rendered markdown lines or
  returned as structured metadata only. Conservative default: keep the existing source-line
  rendering behavior for chat UI compatibility and also return structured summaries.
- Open question: The current worktree has uncommitted changes in chat and docs files. The
  executor must inspect those changes before editing and must not revert unrelated work.

## Quality Gates
- Setup status: Existing gates are configured in `package.json`, `biome.json`,
  `tsconfig.json`, and `playwright.config.ts`. No quality-gate setup step is required.
- Baseline command: `bun run lint && bun run typecheck --incremental false && bun test && bun run build`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run typecheck --incremental false`; `bun run build`;
  `bun run db:migrate:test && bun run db:seed:test`; `bun run test:e2e`
- Full step gate list:
  - `bun run format`
  - `bun run lint`
  - `bun run typecheck --incremental false`
  - `bun test`
  - `bun run db:migrate:test && bun run db:seed:test`
  - `bun run build`
  - `bun run test:e2e`

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work
  begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step,
  validation results, commit reference if available, current status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Create `CHANGELOG.md` before any quality-gate setup or implementation work
  begins.
- Initial content: Include `# Changelog`, the standard preamble, and an `## [Unreleased]`
  section.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with
  human-readable notable changes under the appropriate `Unreleased` change-type headings
  before creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress and changelog files the user can consult while the plan is
being executed.

Depends on:
- None

Changes:
- Create `PROGRESS.md` in the project root.
- Add the plan title, source document list, a checklist for every step below, current
  status, and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Create `CHANGELOG.md` in the project root before any implementation work begins.
- Add Keep a Changelog 1.0.0 structure: `# Changelog`, the standard preamble, and
  `## [Unreleased]`.
- Document that `CHANGELOG.md` must be updated after each step is completed and validated,
  before that step is committed.

Acceptance Criteria:
- `PROGRESS.md` exists and includes all planned step names.
- `CHANGELOG.md` exists and contains the required Keep a Changelog structure.

Validation:
- Confirm `PROGRESS.md` exists and contains the step checklist.
- Confirm `CHANGELOG.md` exists and follows the required Keep a Changelog 1.0.0 structure.

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status,
  and identify Step 1 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing progress and changelog
  tracking.

Commit:
- `Add AI tool runtime tracking files`

### Step 1: Agent Runtime Contracts and Test Doubles
Goal: Establish the typed runtime boundary without changing `/api/chat` behavior yet.

Depends on:
- Step 0

Changes:
- Add `src/server/chat/agent-runtime.ts` for shared types:
  - `AskSiargaoAgentToolName`
  - `AgentToolCallAudit`
  - `AgentToolResult`
  - `AgentTurnResult`
  - `AgentRuntimeRequest`
  - `AgentRuntimeDependencies`
- Add `src/server/chat/agent-runtime.test.ts` covering contract helpers, audit shaping,
  request IDs, and source summary aggregation.
- Define `cards?: RecommendationCard[]` and `actions?: ChatAction[]` as optional fields
  for future roadmap compatibility, but do not implement card/action generation.
- Add a fake Responses client and fake tool executor test utility under the same test file
  or a colocated `src/server/chat/agent-test-utils.ts` if reuse is needed.

Acceptance Criteria:
- Runtime contracts are explicit and importable by route code, tool code, and tests.
- No route behavior changes in this step.
- Tests can simulate model output and tool calls without network access.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and Step 2 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for agent runtime
  contracts and test doubles.

Commit:
- `Define chat agent runtime contracts`

### Step 2: Tool Registry and Source Policy Tool
Goal: Add the backend-owned tool registry and the first safe tool before wiring model
execution.

Depends on:
- Step 0
- Step 1

Changes:
- Add `src/server/chat/agent-tools.ts` with:
  - typed tool definitions suitable for OpenAI Responses function tools;
  - Zod argument schemas;
  - one dispatcher that validates arguments and returns structured tool output;
  - `describe_source_policy()` implementation based on existing
    `AnswerSourceSummary` labels and provider caveats.
- Include a `describe_available_tools()` internal helper for logging/debugging, but do not
  expose it as a model-callable tool unless needed by the final Responses API schema.
- Add `src/server/chat/agent-tools.test.ts` for argument validation, unknown-tool errors,
  source-policy output, and audit records.
- Ensure tool output includes machine-readable `sources` and concise text that can be sent
  back to the model.

Acceptance Criteria:
- Invalid tool arguments never reach provider code.
- Tool execution returns success or failure records without throwing for expected provider
  failures.
- Source policy output explains checked, fresh cache, curated local guide, weather checked,
  not verified, and provider unavailable labels.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and Step 3 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for the agent tool
  registry and source-policy tool.

Commit:
- `Add chat agent tool registry`

### Step 3: Weather Forecast Tool
Goal: Convert weather context loading into a model-callable backend tool.

Depends on:
- Step 0
- Step 1
- Step 2

Changes:
- Extend `src/server/chat/agent-tools.ts` with `get_weather_forecast(location, date_range)`.
- Reuse `getLatestSiargaoWeatherSnapshot` from
  `src/server/public-pages/weather-snapshot.ts` and the existing Open-Meteo forecast
  locations from `src/server/providers/open-meteo.ts`.
- Support known labels such as `Siargao Island`, `Cloud 9`, `General Luna`, and
  `Del Carmen`; use the existing Del Carmen location override where appropriate.
- Return normalized weather snapshots, concise condition signals, freshness/confidence, and
  source summaries.
- Return provider-unavailable tool output for fallback or provider errors instead of
  rendering final prose.
- Add or update tests in `src/server/chat/agent-tools.test.ts` for live, fallback, location
  override, invalid date range, and provider failure cases.

Acceptance Criteria:
- The weather tool produces the same source-governed facts currently available to the chat
  route without writing final assistant prose.
- Provider failures are visible to the model as tool results with `provider_unavailable`
  source summaries.
- Existing `src/server/providers/open-meteo.test.ts` and weather snapshot tests still pass.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and Step 4 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for the weather
  forecast agent tool.

Commit:
- `Add weather forecast chat tool`

### Step 4: Google Places Search and Details Tools
Goal: Expose governed Google Places lookup through tools while preserving field-mask and
retention constraints.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3

Changes:
- Extend `src/server/chat/agent-tools.ts` with:
  - `search_places(query, center, radius_meters, constraints)`;
  - `get_place_details(place_id)`.
- Reuse `getGooglePlacesChatContext` and the cached adapter from
  `src/server/providers/google-places-chat.ts` and
  `src/server/providers/google-places-chat-cache.ts`.
- Use existing `googlePlacesChatSearchFieldMask` for search results.
- Implement `get_place_details` as cache-first when a valid cached details row exists, with
  live fallback through `enrichGooglePlacesDetails` using only the allowed identity/contact
  field mask. Do not expose enterprise, atmosphere, or review-bearing fields to chat.
- Preserve Google Places caveats: no review text, booking availability, table availability,
  room availability, or independent local quality checks.
- Add tests for argument validation, field-mask use, fresh cache output, live output,
  no-results output, and provider failure output.

Acceptance Criteria:
- Places tools return only allowed fields and source caveats.
- Search and detail failures are returned as tool outputs, not route-rendered prose.
- Existing Google Places policy, cache, chat, store, discovery, and enrichment tests still
  pass.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and Step 5 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for governed Google
  Places agent tools.

Commit:
- `Add governed Places chat tools`

### Step 5: Curated Local Guide Tool
Goal: Convert local guide and beach recommendation data into structured tool output.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Add a structured local guide search helper in `src/server/local/siargao-beaches.ts` or a
  new `src/server/local/local-guide.ts`.
- Refactor existing beach guide data so it can be returned as structured candidates and
  caveats without calling `renderSiargaoBeachRecommendation` for final prose.
- Extend `src/server/chat/agent-tools.ts` with `search_local_guide(query, filters)`.
- Support filters for beach surface, swimming, sunset, rain fit, origin, max ride minutes,
  transport constraints, and family/kids hints using existing `TripContext` concepts where
  possible.
- Return `curated_local_guide` source summaries with unchecked caveats for tide, currents,
  live road conditions, access changes, and lifeguard/safety status.
- Keep `renderSiargaoBeachRecommendation` temporarily for compatibility until the route is
  rewired in Step 8, but mark it as a legacy renderer in comments or tests if needed.
- Add tests for sand-only beach lookup, swimming follow-up lookup, strict 30-minute filters,
  north-island exclusion caveats, and source summaries.

Acceptance Criteria:
- The AI can retrieve local guide facts as structured evidence.
- Local guide data is no longer only available through a preset prose renderer.
- The tool never claims live tide, current, road, access, or safety checks.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and Step 6 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for the curated local
  guide agent tool.

Commit:
- `Add curated local guide chat tool`

### Step 6: Responses API Tool Loop Runtime
Goal: Implement the primary agent loop that lets the model choose tools and write the final
answer.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5

Changes:
- Add `src/server/chat/ask-siargao-agent.ts` or extend `src/server/llm/chat-adapter.ts`
  with a new runtime function, for example `runAskSiargaoAgentTurn`.
- Use the OpenAI Responses API with `store: false`, configured model
  `process.env.OPENAI_MODEL ?? "gpt-5.5"`, and typed function tools from
  `agent-tools.ts`.
- Build input from the last valid chat messages, request metadata, optional deterministic
  signals, and stable inline product instructions.
- Execute the Responses tool loop until either:
  - the model produces final text;
  - a max tool-call count is reached;
  - a max turn count is reached;
  - the provider/client fails.
- Feed each tool result back to the model in the Responses-compatible tool-result format.
- Produce `AgentTurnResult` with:
  - `message`;
  - local `requestId`;
  - upstream request IDs when available;
  - `model`;
  - `toolCalls`;
  - `sources`;
  - empty or omitted `cards` and `actions`.
- Log tool-call traces with `requestId`, tool name, duration, success/failure status,
  source profile IDs, and provider operation where available.
- Add tests for no-tool general Siargao prompts, weather tool calls, Places tool calls,
  local guide tool calls, multiple tool calls, provider failure loop continuation, max-loop
  protection, and missing `output_text`.

Acceptance Criteria:
- A valid successful agent turn always includes at least one OpenAI model call.
- The model, not deterministic route code, writes the final `message`.
- Tool call traces are captured in the result and logs.
- Provider failure tool outputs can still lead to a model-written final response.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and Step 7 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for the Responses API
  chat tool loop.

Commit:
- `Add Responses tool loop runtime`

### Step 7: Source Consistency Validator
Goal: Validate AI-written answers against actual tool evidence before returning them.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6

Changes:
- Add `src/server/chat/source-consistency.ts`.
- Validate that rendered source lines and structured `sources` are backed by actual tool
  outputs.
- Block or downgrade unsupported checked claims:
  - live checked requires live Places tool output;
  - fresh cache requires cached Places tool output;
  - weather checked requires weather tool output with live or usable snapshot;
  - curated local guide requires local guide tool output;
  - provider unavailable requires matching failed or fallback tool output.
- Keep generic model reasoning marked `not_verified` when no matching live/local tool was
  called.
- Add tests for valid checked weather, valid checked Places, valid curated guide, invalid
  checked claim without tool output, and provider-unavailable claims.
- Decide failure behavior conservatively: either request one repair pass from the model or
  return a controlled `502` if the model cannot produce source-consistent output.

Acceptance Criteria:
- Generic model reasoning is never labeled as a live check.
- Tool-backed labels cannot be fabricated by the model.
- The validator is independent from final wording and only enforces source consistency.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and Step 8 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for chat source
  consistency validation.

Commit:
- `Validate chat answer source consistency`

### Step 8: Rewire `/api/chat` to the Agent Runtime
Goal: Make the chat route use the primary AI tool runtime for every valid successful chat
response.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6
- Step 7

Changes:
- Update `src/app/api/chat/chat-route.ts`:
  - keep JSON and schema validation before runtime invocation;
  - keep rate-limit/safety hooks if present;
  - build optional deterministic signals from `interpretChatRequestIntent` and
    `deriveTripContext`;
  - call `runAskSiargaoAgentTurn` for all valid Siargao chat requests;
  - remove direct final-answer use of `renderGroundedBeachRecommendation`,
    `renderGroundedLocalPlan`, recommendation-agent final prose, and generic fallback prose;
  - return the runtime `message`, `requestId`, `model`, `toolCalls`, `sources`, and optional
    future fields.
- Convert non-Siargao valid requests from hardcoded decline prose to agent-handled decline
  instructions, unless the request is rejected at the safety layer.
- Convert missing-context responses from hardcoded route prose to agent-written
  clarification.
- Update route dependency injection to accept an agent runtime dependency for tests.
- Keep existing helper functions only when they serve as signals, validators, or tool
  internals; remove dead deterministic final renderers where no longer used.
- Update `src/app/api/chat/route.test.ts` so every valid success path asserts that the
  agent/model dependency was called.

Acceptance Criteria:
- No successful valid `/api/chat` response is produced without an agent/model call.
- Weather, beach, local guide, recommendation, scope-decline, and missing-context responses
  are AI-written.
- Provider failure does not bypass the agent with preset final prose.
- Route responses remain compatible with the chat frontend.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and Step 9 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with a `Changed` entry for routing valid
  chat responses through the AI tool runtime.

Commit:
- `Route chat through agent runtime`

### Step 9: Regression, Observability, and Documentation Pass
Goal: Close gaps from the runtime rewrite and document the new backend extension path.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6
- Step 7
- Step 8

Changes:
- Add or update route tests proving:
  - common chat prompts invoke the model;
  - weather prompts call the weather tool when the model requests it;
  - Places prompts call Places tools when the model requests them;
  - local guide prompts call `search_local_guide` when the model requests it;
  - no-tool general Siargao prompts still invoke the model;
  - deterministic branches cannot return final prose.
- Add or update source-consistency tests for model answers that mention checked data.
- Update `tests/e2e/chat.e2e.ts` only if response payload or rendering changed.
- Add a short developer reference section to an existing docs file or a new
  `docs/developer/reference/chat-agent-runtime.md` explaining:
  - how to add a backend chat tool;
  - how tool arguments are validated;
  - how provider failures should be returned;
  - how source summaries are generated;
  - which roadmap items remain out of scope.
- Verify log events include request ID, model, tool calls, provider failure status, and
  source labels without leaking secrets or raw restricted provider payloads.

Acceptance Criteria:
- Tests cover the roadmap acceptance criteria.
- Maintainers can add a backend capability as a tool without adding a hardcoded route branch.
- Documentation reflects the new agent-runtime extension path.
- Logs provide useful tool-loop observability without exposing secrets.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if
  available, current status, and final plan status.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with `Added` and `Changed` entries for
  regression coverage, observability, and developer documentation.

Commit:
- `Document and verify chat agent runtime`

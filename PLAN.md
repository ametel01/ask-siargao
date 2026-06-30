# Implementation Plan

## Source Documents

- Path: `/Users/alexmetelli/source/ask-siargao/documentation/developer/explanation/web-research-layer.md`
  - Role: Primary architecture/design specification.
  - Summary: Defines a general `research_web` layer for current and recommendation-heavy Ask
    Siargao answers. Requires public-web research before legacy Places/weather/memory fallback
    paths for current requests, source scoring by request type, entity-specific enrichment after
    research, source-label validation, tests, memory-policy updates, and explicit removal or
    gating of legacy bad behavior.

## Goals

- Add a general web-research capability that can support current, recommendation, schedule,
  availability, price, safety, disruption, and event-like Ask Siargao requests.
- Make current/recommendation answers research-first: web research selects and scores relevant
  public evidence before Places, weather, local memory, or other tools enrich the answer.
- Remove or make unreachable legacy bad behavior for covered request classes: broad Places-first
  answers, weather-first recommendation answers, memory-only baseline answers, and generic fallback
  cards after research failure.
- Preserve the existing chat-runtime principle that deterministic code classifies, fetches, ranks,
  validates, and normalizes evidence while the model writes final traveler-facing prose.
- Keep source labels auditable: every public web-research label must be backed by current-turn
  `research_web` tool output, not memory retrieval or generic model reasoning.

## Non-Goals

- Do not build booking, table, room, ticket, guest-list, or inventory availability checks.
- Do not store arbitrary raw web pages as durable product truth.
- Do not implement unrestricted model browsing or direct model scraping of arbitrary pages.
- Do not replace existing Google Places, weather, marine, tide, local guide, itinerary, or memory
  tools; reframe them as enrichment/support where appropriate.
- Do not migrate the legacy `src/server/llm/chat-adapter.ts`; valid `/api/chat` responses continue
  to use `runAskSiargaoAgentTurn`.
- Do not broaden user-facing claims beyond what source policy, provider terms, and source
  consistency validation can support.

## Definition of Done

- `research_web` is a registered backend chat tool with strict Responses schema, Zod argument
  validation, deterministic execution, safe `AgentToolResult` output, source summaries, and
  network/provider dependencies injectable for tests.
- A provider abstraction exists for public web search and bounded page/source extraction, with the
  first production provider behind explicit server-only configuration. The implementation must
  support OpenAI Responses hosted `web_search` if selected, or another configured web-search
  provider through the same repo-owned interface.
- Deterministic request intent includes a general research-need signal for current/recommendation
  prompts beyond nightlife, including schedules, availability, prices, closures, disruptions,
  safety, and event-like requests.
- `buildRequiredEvidencePlan` can require `research_web` and express ordering so research gates
  downstream tools when current public information is required.
- Broad Places category searches are removed, repaired, or skipped for request classes covered by
  required research. Places runs as entity-specific enrichment after research-selected entities, or
  remains primary only for stable place-discovery requests where Places is the right source, such as
  pharmacies, coffee open now, or nearby restaurants.
- Weather-only and memory-only final answers are rejected for non-weather current recommendation
  prompts unless research explicitly failed/was insufficient and the final answer transparently says
  current public evidence could not be verified.
- Source labels and source-consistency validation distinguish official web evidence, directory web
  evidence, general web research, insufficient web evidence, community signals, Places, weather,
  memory interpretation, and provider failure without overclaiming.
- Public source panels do not display weak terminal states as checked positive evidence.
- Agent memory files describe `research_web` policy, source priority, query planning, and answer
  shapes. They guide research and interpretation; they do not replace required web research.
- Tests cover tool behavior, runtime ordering, intent classification, source consistency, legacy
  behavior removal, and at least one cross-domain current request outside nightlife.
- Documentation is updated for the chat runtime and web research layer.
- `PROGRESS.md` is current, `CHANGELOG.md` follows Keep a Changelog 1.0.0 and records each
  completed step under `## [Unreleased]`, and each incremental step is committed separately.
- Required quality gates pass or any pre-existing failures are clearly documented before proceeding:
  lint, clean typecheck, focused tests, full Bun tests, test DB migrate/seed, build, and e2e.

## Assumptions and Open Questions

- Assumption: The first implementation should prefer a repo-owned provider interface and dependency
  injection over binding chat runtime code directly to one vendor API.
  - Impact: Production provider choice can change without rewriting source validation, scoring, or
    runtime ordering.
- Assumption: OpenAI Responses hosted `web_search` is the preferred first provider if available in
  the deployed model/account, because the project already uses the OpenAI Responses API and the
  `openai` SDK.
  - Impact: Implementation must verify current official API details and feature availability before
    wiring production calls. If unavailable, use a separate configured web-search provider behind
    the same interface.
- Assumption: Social pages should initially be searched by snippets or excluded unless source policy
  explicitly permits fetching/extracting them.
  - Impact: The first slice can still solve many failures with official pages, directories, guides,
    news, and community pages without direct social scraping.
- Assumption: Persistence for web research can start as optional/no-store with injected test data,
  then add caching in a later step if latency/cost requires it.
  - Impact: The first vertical slice can ship safer behavior without a migration, but the plan
    includes a dedicated persistence step if production cost/latency requires caching.
- Open question: Which provider-specific environment variables should production use?
  - Impact: The implementation step must add exact variable names to
    `documentation/developer/reference/environment.md` once the provider is chosen.
- Open question: Should `research_web` be one tool or split into `plan_web_research`,
  `search_web`, and `fetch_web_sources`?
  - Impact: This plan chooses one `research_web` tool for the first bounded implementation, with
    internal structured phases for auditability.
- Open question: How much web research budget should anonymous users get versus authenticated trip
  pass users?
  - Impact: The first implementation should include conservative max-source/time limits and log
    usage, but can defer billing integration.

## Implementation Approach

Implement this as a sequence of vertical slices, not a broad rewrite.

1. Establish tracking and confirm baseline gates.
2. Add core research types, source labels, source validation, and a deterministic in-memory research
   engine with mocked provider inputs.
3. Register `research_web` as a backend chat tool and make it return bounded structured findings,
   entities, and source summaries.
4. Add deterministic research-need intent and required-evidence planning that gates downstream tools
   for current/recommendation requests.
5. Convert Places behavior for research-covered request classes from primary ranking to
   entity-specific enrichment.
6. Add final-answer repair/validation so the model cannot silently fall back to broad Places,
   weather-only, or memory-only answers when research is required.
7. Wire the first production web-search provider behind server-only environment variables and keep
   tests injectable/no-network.
8. Optionally add short-lived persistence/caching after the tool behavior and safety gates work.
9. Update agent memory and developer documentation so future agents use the research-first policy.

The critical compatibility rule is: legacy behavior may remain only for request classes not yet
covered by `research_web`, or for stable place-discovery prompts where Places is intentionally the
primary source. Once a request class is covered by required research, the old broad Places,
weather-first, or memory-only answer paths must be removed, gated off, or rejected by validation.

## Quality Gates

- Setup status: Existing gates found in `package.json` and `.github/workflows/ci.yml`; no new gate
  setup is required before implementation.
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
- Note: `PROGRESS.md` is currently deleted in the working tree. Step 0 must recreate it unless the
  user explicitly restores a different version first.

## Changelog Tracking

- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Ensure `CHANGELOG.md` exists before any quality-gate setup or implementation work
  begins. The file already exists; preserve existing entries and update `## [Unreleased]`.
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

Goal: Create durable progress and changelog tracking the user can inspect while the plan is being
executed.

Depends on:

- Nothing.

Changes:

- Create `PROGRESS.md` in the project root.
- Add the plan title, source document path, a checklist for every step in this plan, current status,
  and a short update log.
- Document in `PROGRESS.md` that it must be updated after every completed step.
- Preserve the existing `CHANGELOG.md`; if it is missing at execution time, create it.
- Ensure `CHANGELOG.md` has Keep a Changelog 1.0.0 structure: `# Changelog`, the standard
  preamble, and `## [Unreleased]`.
- Add an `Added` entry under `## [Unreleased]` for establishing progress tracking for the web
  research layer work.

Acceptance criteria:

- `PROGRESS.md` exists and lists all steps from this plan.
- `CHANGELOG.md` exists, keeps existing entries, and has a valid `## [Unreleased]` section.

Validation:

- Run `test -f PROGRESS.md`.
- Run `test -f CHANGELOG.md`.
- Run `rg -n "Web Research Layer|Step 0|Step 1" PROGRESS.md`.
- Run `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md`.

Progress:

- Mark Step 0 complete in `PROGRESS.md`, record validation results, set current status to Step 1,
  and identify the next step.

Changelog:

- Add or keep an `Added` entry under `## [Unreleased]` for progress/changelog tracking setup.

Commit:

- `Track web research implementation progress`

### Step 1: Baseline Quality Gates

Goal: Establish the baseline state before implementation so later failures can be distinguished
from pre-existing failures.

Depends on:

- Step 0.

Changes:

- No feature code changes.
- Inspect `package.json`, `.github/workflows/ci.yml`, `biome.json`, and `tsconfig.json` only if
  gates fail unexpectedly.
- Record baseline results in `PROGRESS.md`.

Acceptance criteria:

- The executor knows which gates are passing before implementation starts.
- Any pre-existing failure is documented with command, failure summary, and whether implementation
  can safely proceed.

Validation:

- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.
- If time or environment prevents full e2e, run `bun run verify` and document the skipped CI gates
  with the reason.

Progress:

- Update `PROGRESS.md` with completion notes, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Update `CHANGELOG.md` only if this step changes gate configuration or documentation. Otherwise
  record "No changelog entry required for baseline-only validation" in `PROGRESS.md`.

Commit:

- `Record baseline quality gates` if files changed; otherwise no commit.

### Step 2: Add Web Research Types And Source Labels

Goal: Introduce the core typed contract for public web research evidence without changing runtime
behavior yet.

Depends on:

- Step 0.
- Step 1 unless baseline gates are explicitly documented as skipped.

Changes:

- Add `research_web` to `AskSiargaoAgentToolName` in `src/server/chat/agent-runtime.ts`.
- Add web research domain types in a new `src/server/chat/web-research.ts`, including:
  - `ResearchWebRequest`;
  - `ResearchWebResultData`;
  - `ResearchFinding`;
  - `ResearchEntity`;
  - `ResearchSourceScore`;
  - source classes and request intents listed in the source document.
- Add source labels in `src/server/chat/answer-source-summary.ts`:
  - `web_researched`;
  - `official_checked`;
  - `directory_checked`;
  - `insufficient_web_evidence`.
- Keep `live_checked` scoped to live provider APIs such as Google Places.
- Update Zod mirrors in `src/server/trips/shared-trip-types.ts` and
  `src/server/chat/condition-tools.ts` if these labels can appear in persisted or condition
  artifacts.
- Update `describe_source_policy` entries in `src/server/chat/agent-tools.ts`.
- Update source-label rendering tests in `src/server/chat/answer-source-summary.test.ts` and
  source-policy tests in `src/server/chat/agent-tools.test.ts`.

Acceptance criteria:

- New labels compile and render.
- No source-consistency path accepts the new labels yet unless backed by future `research_web`
  output.
- Existing labels continue to behave as before.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/answer-source-summary.test.ts src/server/chat/agent-tools.test.ts src/server/trips/shared-trip-types.test.ts src/server/chat/condition-tools.test.ts`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add an `Added` entry under `## [Unreleased]` describing web-research source labels and typed
  research contracts.

Commit:

- `Add web research source contracts`

### Step 3: Implement Deterministic Research Scoring Without Network Calls

Goal: Build the domain-neutral research planning and scoring engine with injected search results,
so behavior is testable before adding a live provider.

Depends on:

- Step 2.

Changes:

- Implement `src/server/chat/web-research.ts` functions for:
  - query expansion by request intent, location, date context, and source type;
  - source classification;
  - source scoring by authority, freshness, exactness, corroboration, negative evidence, and source
    fit;
  - finding extraction from normalized provider snippets/page summaries;
  - entity extraction and `needsPlacesEnrichment` hints;
  - status selection: `available`, `insufficient`, or `provider_unavailable`.
- Add `src/server/chat/web-research.test.ts` covering:
  - nightlife/event query expansion;
  - restaurant/current recommendation query expansion;
  - ferry/transport query expansion;
  - tour price query expansion;
  - safety/disruption query expansion;
  - official sources outranking guides/community for factual status;
  - negative evidence such as closed/cancelled/not-running being preserved;
  - insufficient evidence when only weak stale sources exist;
  - no raw fetched page text or restricted payloads returned.

Acceptance criteria:

- The research engine can produce ranked findings and selected entities from deterministic fixtures.
- At least one test covers a non-nightlife current request.
- No provider/network code is required for tests.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/web-research.test.ts`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for deterministic web research query planning and
  source scoring.

Commit:

- `Add deterministic web research scoring`

### Step 4: Register `research_web` As A Chat Tool

Goal: Expose web research to the agent runtime as a bounded backend tool with strict schema and
audited output.

Depends on:

- Step 3.

Changes:

- Add `researchWebSchema` and `research_web` to `registeredTools` in
  `src/server/chat/agent-tools.ts`.
- Add provider dependency slots to `AgentToolDependencies` for web search/fetch abstractions.
- Implement the handler so it calls the deterministic research engine with injected provider
  results and returns:
  - `status`;
  - safe model-facing `text`;
  - `data.findings`;
  - `data.entities`;
  - `data.sourceScores`;
  - `sources` with the new source labels;
  - `errorCode: "provider_unavailable"` only when the research provider fails.
- Do not return raw page bodies, unrestricted HTML, secrets, request headers, or provider payloads.
- Update `src/server/chat/agent-tools.test.ts` for:
  - strict Responses schema shape;
  - nullable/optional provider-valid arguments;
  - successful research output;
  - insufficient web evidence output;
  - provider-unavailable output;
  - source policy descriptions.

Acceptance criteria:

- The model can call `research_web` like any other chat tool.
- Tool output is bounded, structured, and source-backed.
- Provider failures return tool outputs, not thrown route-level failures.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/agent-tools.test.ts src/server/chat/web-research.test.ts`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for the `research_web` chat tool.

Commit:

- `Register web research chat tool`

### Step 5: Enforce Web Research Source Consistency

Goal: Ensure public web-research claims cannot be fabricated from memory, generic model reasoning,
or the wrong tool.

Depends on:

- Step 4.

Changes:

- Update `src/server/chat/source-consistency.ts` so:
  - `web_researched`, `official_checked`, and `directory_checked` require successful
    `research_web` tool evidence;
  - `insufficient_web_evidence` is allowed only as a terminal `research_web` result and is not
    rendered as checked positive evidence;
  - `community_signal` remains low-confidence support and cannot be upgraded into official or
    directory truth;
  - memory retrieval cannot back any web-research labels.
- Update `src/server/chat/source-consistency.test.ts` for structured and rendered source-line
  validation.
- Update route-boundary tests in `src/app/api/chat/route.test.ts` if new public labels need API
  validation coverage.

Acceptance criteria:

- Public web labels are accepted only with matching audited `research_web` output.
- Memory and generic model reasoning cannot back public web labels.
- Weak/insufficient evidence is displayed as not-checked/terminal caveat, not checked positive
  evidence.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/source-consistency.test.ts src/app/api/chat/route.test.ts`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Fixed` entry under `## [Unreleased]` for preventing fabricated or memory-backed web
  research labels.

Commit:

- `Validate web research source labels`

### Step 6: Add General Research Intent And Required Evidence Planning

Goal: Make current/recommendation requests require research across domains, not only nightlife.

Depends on:

- Step 5.

Changes:

- Add a `researchIntent` or equivalent deterministic signal to `ChatRequestIntent` in
  `src/app/api/chat/chat-route.ts`.
- Derive research need from latest user turn and trip context for:
  - current recommendations;
  - schedules and event-like requests;
  - availability/closure/running/cancelled prompts;
  - prices/current rates/tour prices;
  - safety/disruption/advisory prompts;
  - comparison prompts where current public reputation matters.
- Ensure stable local-guide prompts do not require web research unless the user asks for current
  status.
- Extend `RequiredEvidenceToolCall` in `src/server/chat/required-evidence.ts` with
  `research_web` and ordering/dependency metadata.
- Add required `research_web` calls before Places/weather/local memory enrichment for covered
  request classes.
- Add `src/server/chat/required-evidence.test.ts` if there is no focused test file for this module,
  or extend existing route/runtime tests.
- Update `src/app/api/chat/route.test.ts` for:
  - nightlife current recommendation;
  - restaurant current recommendation;
  - ferry/transport schedule;
  - tour price;
  - safety/disruption;
  - stable beach recommendation that does not require research.

Acceptance criteria:

- Current/recommendation prompts produce required `research_web` evidence plans.
- Stable non-current local guide prompts still use existing local guide paths.
- Research planning is visible in deterministic signals/log-safe metadata without exposing raw user
  private data.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/app/api/chat/route.test.ts src/server/chat/ask-siargao-agent.test.ts`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for general research intent and required evidence
  planning.

Commit:

- `Plan required web research for current prompts`

### Step 7: Enforce Research-Before-Enrichment Runtime Ordering

Goal: Make `ask-siargao-agent` execute required research before dependent tools and prevent legacy
fallbacks from bypassing the research gate.

Depends on:

- Step 6.

Changes:

- Update `src/server/chat/ask-siargao-agent.ts` required-evidence preflight so `research_web` runs
  before dependent `search_places`, `get_weather_forecast`, or domain tools.
- Extend the tool-loop execution planner to respect `dependsOn`/ordering metadata.
- If a model tries broad `search_places` before required research, repair or skip that call.
- If required research returns `insufficient` or `provider_unavailable`, prevent downstream broad
  Places calls from becoming the answer.
- Add runtime tests in `src/server/chat/ask-siargao-agent.test.ts`:
  - research runs before Places for current recommendation prompts;
  - Places calls are entity-specific after research-selected entities;
  - broad Places category searches are rejected/skipped after research failure;
  - weather does not run as the dominant answer path for recommendation prompts unless
    independently required by the user.

Acceptance criteria:

- A current recommendation cannot complete by calling broad Places before required research.
- Downstream tools run only after research succeeds or when independently required.
- Failed/insufficient research produces transparent caveats and no generic fallback cards.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/ask-siargao-agent.test.ts src/server/chat/required-evidence.test.ts`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for research-before-enrichment runtime ordering.
- Add a `Removed` or `Fixed` entry for removing legacy broad Places fallback where research is
  required.

Commit:

- `Enforce research before enrichment`

### Step 8: Convert Places To Entity-Specific Enrichment

Goal: Keep Google Places useful for maps/hours/identity while preventing it from ranking current
editorial recommendations.

Depends on:

- Step 7.

Changes:

- Add helpers in `src/server/chat/required-evidence.ts` or a new module to build Places enrichment
  calls from `research_web` selected entities with `needsPlacesEnrichment`.
- Update `src/server/chat/ask-siargao-agent.ts` so model-selected broad category Places calls are
  rewritten to entity-specific calls when research results exist.
- Update `requiredEvidencePlaceCardIds` and artifact filtering so public Places cards must match
  research-selected entities for covered request classes.
- Preserve broad Places primary behavior for stable place-discovery prompts where Places is the
  correct source, such as "pharmacy near me", "coffee open now", or "restaurants near Cloud 9."
- Add mixed-selection tests where `displayCardIds` includes both research-selected and unrelated
  Places cards; only allowed cards should survive.

Acceptance criteria:

- For covered current/recommendation prompts, Places cards correspond to research-selected entities.
- Generic Places candidates cannot appear as fallback cards.
- Existing service/nearby/open-now Places behavior remains intact where research is not required.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/ask-siargao-agent.test.ts src/server/chat/agent-runtime.test.ts src/server/chat/required-evidence.test.ts`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for converting Places to research-selected entity
  enrichment.

Commit:

- `Use Places as research entity enrichment`

### Step 9: Reject Legacy Final Answers For Research-Required Prompts

Goal: Ensure the model cannot answer current/recommendation prompts with weather-only,
memory-only, or generic fallback prose after research is required.

Depends on:

- Step 8.

Changes:

- Add final-payload validation/repair in `src/server/chat/ask-siargao-agent.ts` or
  `src/server/chat/required-evidence.ts` so final answers must:
  - mention primary research findings when research succeeded;
  - include research tool call IDs in `usedToolCallIds`;
  - avoid source claims not backed by `research_web`;
  - say current public evidence could not be verified when research was insufficient/unavailable;
  - avoid broad Places cards and weather-only answer shape after research failure.
- Add tests in `src/server/chat/ask-siargao-agent.test.ts` for:
  - successful research answer omitting primary findings gets repaired;
  - weather-only answer for non-weather recommendation is rejected;
  - memory-only baseline answer for current prompt is rejected unless transparently caveated after
    research failure;
  - insufficient research answer does not show generic Places cards.
- Add route tests if public source panels need extra filtering for weak terminal states.

Acceptance criteria:

- The old bad answer shapes are not kept as fallback for research-covered classes.
- Research failure degrades to transparent uncertainty, not a plausible Places/weather/memory
  answer.
- The answer leads with ranked findings when research succeeds.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/ask-siargao-agent.test.ts src/server/chat/required-evidence.test.ts src/app/api/chat/route.test.ts`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Fixed` entry under `## [Unreleased]` for removing weather-only, memory-only, and broad
  Places fallback answers from research-required prompts.

Commit:

- `Reject legacy fallbacks for researched prompts`

### Step 10: Wire The Production Web Search Provider

Goal: Enable real public-web research behind server-only configuration while keeping tests
deterministic and network-free.

Depends on:

- Step 9.

Changes:

- Add `src/server/providers/web-search.ts` with a repo-owned provider interface.
- Add the first concrete provider adapter:
  - Prefer OpenAI Responses hosted `web_search` if current official docs and account/model support
    it.
  - Otherwise use a configured search API behind the same interface.
- Add optional `src/server/providers/web-page-fetch.ts` only if the chosen provider requires
  separate page fetching. Enforce timeout, size limits, content-type checks, and safe extraction.
- Add server-only environment variables to `documentation/developer/reference/environment.md`.
- Update `AgentToolDependencies` and default dependency wiring so production uses the provider only
  when configured. If not configured, `research_web` returns `provider_unavailable`.
- Add tests with injected fake providers. Do not require live network in unit tests.
- Add observability fields for provider operation, source labels, durations, and failure status
  without logging raw provider payloads.

Acceptance criteria:

- In configured environments, `research_web` can perform real web discovery.
- In unconfigured environments, behavior is explicit `provider_unavailable`, not silent legacy
  fallback.
- Unit tests remain deterministic and do not call the network.
- Environment docs describe required keys and failure behavior.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/agent-tools.test.ts src/server/chat/web-research.test.ts`.
- Run `bun test`.
- Run `bun run build`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add an `Added` entry under `## [Unreleased]` for the configurable public web-search provider.

Commit:

- `Wire configurable web search provider`

### Step 11: Add Optional Short-Lived Research Persistence

Goal: Cache normalized web research evidence when needed for cost, latency, debugging, and
governed attribution without storing arbitrary pages as durable product truth.

Depends on:

- Step 10.

Changes:

- Decide whether persistence is necessary after Step 10. If not necessary, document the decision in
  `PROGRESS.md` and skip code changes for this step.
- If needed, add Drizzle schema and migrations for:
  - `web_research_runs`;
  - `web_research_sources`;
  - `web_research_findings`.
- Add store module `src/server/providers/web-research-store.ts`.
- Add retention/TTL behavior and pruning if fetched summaries or extracted content are stored.
- Add migration and store tests following existing PGlite patterns.
- Keep raw full page text out of durable storage unless explicitly allowed by source policy.

Acceptance criteria:

- Normalized findings and attribution can be cached and expired safely, or persistence is explicitly
  deferred with rationale.
- Database tests validate migration and typed schema if persistence is implemented.
- Provider/source retention rules are documented.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- If persistence is implemented, run `bun run db:migrate:test` and `bun run db:seed:test`.
- Run `bun test src/server/db/migration.test.ts src/server/providers`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add an `Added` entry under `## [Unreleased]` if persistence is implemented, or record the
  deferred decision in `PROGRESS.md` if no code changes are made.

Commit:

- `Cache normalized web research evidence` if implemented; otherwise no commit unless docs change.

### Step 12: Update Agent Memory And Developer Documentation

Goal: Teach the agent and maintainers the research-first policy so future changes do not re-create
the old fallback behavior.

Depends on:

- Step 10.
- Step 11 if persistence is implemented.

Changes:

- Update `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md`:
  - define when `research_web` is required;
  - explain composition with Places, weather, local guide, itinerary, and memory tools;
  - state that legacy fallback is not allowed for covered request classes.
- Update `docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md`:
  - add source classes;
  - add new source labels;
  - define overclaiming rules and weak-evidence display rules.
- Update `docs/agent-memory/ASK_SIARGAO_ANSWER_PATTERNS.md`:
  - add ranked research-backed answer shapes;
  - add failure shape for insufficient/unavailable current public evidence.
- Update domain memory files such as `docs/agent-memory/NIGHTLIFE.md` and
  `docs/agent-memory/SURF.md` with query templates and source-priority hints instead of hardcoded
  answer patches.
- Update `docs/agent-memory/INDEX.md` trigger terms for general web research.
- Run memory tests and dry-run sync.
- Update `docs/developer/reference/chat-agent-runtime.md` with the new tool, source labels,
  ordering behavior, and provider failure behavior.
- Update `documentation/developer/explanation/web-research-layer.md` if implementation details
  changed during execution.

Acceptance criteria:

- Agent memory clearly says research comes before Places/weather/memory for covered current
  requests.
- Developer reference documents how to add/validate web research tools and labels.
- Memory sync dry-run shows expected changes.

Validation:

- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test src/server/chat/agent-memory.test.ts src/server/chat/agent-tools.test.ts src/server/chat/source-consistency.test.ts`.
- Run `bun run agent-memory:sync -- --dry-run`.
- Run `bun test`.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  current status, and next step.

Changelog:

- Add a `Changed` entry under `## [Unreleased]` for research-first agent memory and developer
  documentation.

Commit:

- `Document research-first agent policy`

### Step 13: Cross-Domain Regression And Release Gates

Goal: Prove the feature works beyond nightlife and that legacy bad behavior is removed for covered
request classes.

Depends on:

- Steps 0 through 12.

Changes:

- Add or update regression tests covering at least:
  - General Luna nightlife tonight;
  - restaurant/current recommendation;
  - ferry/transport schedule;
  - tour price/current rate;
  - safety/disruption advisory;
  - stable beach recommendation that does not require research;
  - research provider unavailable;
  - research insufficient evidence;
  - mixed artifact selection with allowed and disallowed Places cards.
- Add e2e coverage only if the browser UI/source-panel behavior changes in a way unit/route tests
  do not cover.
- Ensure public source panel labels distinguish checked positive evidence from weak terminal states.

Acceptance criteria:

- For covered current/recommendation prompts, the first accepted answer is research-backed or
  transparently says current evidence could not be verified.
- Broad Places/weather/memory fallback answers are rejected in tests.
- Existing stable local guide, Places service, weather, and itinerary behaviors still pass tests.

Validation:

- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.
- Run `bun run verify:ci` if practical after individual failures are resolved.

Progress:

- Update `PROGRESS.md` with completed step, validation results, commit reference if available,
  final status, and any residual risk.

Changelog:

- Add final `Added`, `Changed`, `Removed`, and `Fixed` entries under `## [Unreleased]` as
  appropriate, including removal/gating of legacy fallback behavior.

Commit:

- `Validate web research regressions`

# Implementation Plan

## Source Documents

- Path: `/Users/alexmetelli/source/ask-siargao/docs/developer/reference/thin-agent-harness-spec.md`
  - Role: Primary implementation specification.
  - Summary: Reshape the chat runtime into a thin agent harness: only `INDEX.md` is loaded by default, memory files are loaded by model-directed tools, tool artifacts remain internal until selected by a structured final payload, source/privacy/provider validation stays deterministic, and regression tests prevent beach artifacts from surfacing in food answers.

## Goals

- Make `/api/chat` return model-written prose plus only model-selected cards, actions, and itineraries.
- Add and validate an `AgentFinalPayload` contract with `answer`, `usedMemoryFiles`, `usedToolCallIds`, `displayCardIds`, `displayActionIds`, and `displayItineraryIds`.
- Preserve legacy plain-text final answers temporarily, but expose no unselected tool-produced artifacts in legacy mode.
- Keep `docs/agent-memory/INDEX.md` as the only default full memory file and render compact reference-file metadata for progressive disclosure.
- Make `load_agent_memory_file` and `search_agent_memory` source-free, catalog-backed memory retrieval paths.
- Keep deterministic code focused on request validation, tool execution, source consistency, privacy, provider contracts, artifact validation, and observability.
- Cover the Dapa breakfast regression so a food answer cannot accidentally expose beach cards from an unrelated successful tool result.

## Non-Goals

- Do not add unrestricted database access, SQL tools, or new private data surfaces.
- Do not make memory retrieval a live evidence source.
- Do not remove governed provider tools, source consistency checks, privacy redaction, or existing validation-repair paths for itinerary/condition/surf-near-me evidence.
- Do not introduce multi-root user memory, plugin memory packs, or memory-file enable/disable configuration in this pass.
- Do not make `/api/chat` render deterministic final prose or replace the model-written answer.
- Do not implement optional explicit memory mention syntax (`$SURF`, `$SURF.md`, `memory://...`) unless the user explicitly expands scope.
- Do not perform broad UI redesign work.

## Definition of Done

- The default model instructions include durable base instructions, compact available-memory metadata, and full `INDEX.md`; they do not include full reference memory bodies such as `SURF.md` or `LOCAL_GUIDE_BEACHES.md`.
- The model can load up to three exact reference memory files per `load_agent_memory_file` call, and the tool returns full selected file bodies plus `loadedMemoryFileNames` without adding source labels.
- `search_agent_memory` returns excerpts only, is source-free, and is treated as weaker than exact file loading when `INDEX.md` names a relevant file.
- `AgentFinalPayload` is parsed, validated, and used as the only source of public artifact selection in structured mode.
- Legacy plain-text final answers remain accepted during compatibility mode, but tool-produced cards, actions, and itineraries are not automatically returned.
- Unknown selected artifact IDs fail in strict mode and are dropped with logging in compatibility mode.
- `usedMemoryFiles` and `usedToolCallIds` are validated against current-turn memory retrieval and tool-call observations.
- Source consistency still aggregates all audited tool-call sources for validation, while public artifacts are limited to selected IDs.
- Memory retrieval cannot justify `live_checked`, `fresh_cache`, `weather_checked`, `marine_checked`, `tide_forecast_checked`, `curated_local_guide`, or `provider_unavailable` labels.
- `/api/chat` returns `message: finalPayload.answer` for structured outputs, selected public artifacts only, redacted public memory metadata only, and model-written prose only.
- Logs include selected and unselected artifact counts without raw memory bodies, restricted provider payloads, secrets, exact browser coordinates, or vector-store IDs in public responses.
- Unit and route tests cover artifact selection, legacy compatibility, memory catalog rendering, memory tool behavior, source-label boundaries, and the Dapa breakfast regression.
- Documentation explains the index-only default memory model, compact memory rendering, structured final payload, and selected-artifact runtime contract.
- Required quality gates pass, or any pre-existing failures from the baseline run are documented in `PROGRESS.md` with evidence.

## Assumptions and Open Questions

- Assumption: The initial structured final output can be implemented by instructing the Responses model to return JSON in `output_text`, then parsing it locally. Impact: avoids a broader OpenAI SDK structured-output migration unless repository patterns show a safer existing path during implementation.
- Assumption: Compatibility mode remains the production default until tests prove strict structured final output can be enabled safely. Impact: strict mode is used in targeted tests and internal options first.
- Assumption: Hosted `file_search` memory results may be harder to map to exact filenames than local memory tools. Impact: validate exact `usedMemoryFiles` for `load_agent_memory_file` and `search_agent_memory`; treat hosted file-search validation conservatively unless the current output exposes enough file metadata.
- Assumption: The existing `CHANGELOG.md` is authoritative and must be preserved. Impact: Step 0 verifies or repairs its Keep a Changelog structure instead of replacing existing entries.
- Open question: Should structured final output eventually use OpenAI Responses native JSON schema formatting instead of prompt-level JSON? Impact: defer until after the thin-harness contract works behind tests.
- Open question: How strict should model-directed memory enforcement be for broad trip-advice prompts that mention several domains? Impact: first implementation should enforce only clear `INDEX.md` routing cases and avoid forcing food prompts to load beach or surf memory.
- Open question: Current working tree has pre-existing changes in `docs/README.md`, `docs/developer/reference/chat-agent-runtime.md`, and the source spec. Impact: executors must preserve unrelated user changes and only edit these files where the plan explicitly requires it.

## Implementation Approach

- Implement the artifact-selection backstop first because it directly fixes the Dapa breakfast failure and reduces public-response risk even before memory rendering changes.
- Add a small final-payload parsing and validation boundary, either in `src/server/chat/agent-runtime.ts` if it remains cohesive or in a new `src/server/chat/agent-final-payload.ts` module if parsing/validation would make runtime types noisy.
- Build an internal `AgentArtifactRegistry` from all current-turn tool results. Attach carrier sources to cards as the current merge path does, preserve itinerary source reconciliation/refresh behavior for selected itineraries, and compute selected/unselected counts for logging.
- Change `createAgentTurnResult` so tool results still feed source aggregation and itinerary evidence reconciliation, but no longer automatically expose public artifacts. Explicit caller-supplied artifacts may remain for route tests and trusted deterministic compatibility, but tool-result artifacts require final-payload selection.
- Update `runAskSiargaoAgentTurn` to request a structured final payload, parse it, validate current-turn IDs, pass it to `createAgentTurnResult`, and use `finalPayload.answer` as the returned message. Keep legacy plain text as a no-artifact compatibility fallback unless `requireStructuredFinalOutput` is enabled in dependencies.
- Deepen `agent-memory.ts` from a loaded snapshot into a catalog/load outcome with metadata descriptions and trigger terms. Keep `INDEX.md` as the only instruction-role memory file; render compact available-memory metadata next to full `INDEX.md`.
- Generate memory tool schemas from the current memory outcome/catalog where practical. If Zod enum construction requires a non-empty static tuple, centralize the tuple conversion behind a tested helper so the manifest remains the single allowlist.
- Keep memory retrieval source-free. Add `loadedMemoryFileNames` to `load_agent_memory_file` result data and make search results return excerpts only.
- Add minimal model-directed memory enforcement for clear `INDEX.md` cases after exact memory tools and prompt rendering exist. Use current-turn loaded memory observations, not persistent assumptions across turns.
- Update source-consistency validation so memory retrieval cannot back live/provider/source labels and selected artifacts cannot smuggle unsupported source claims.
- Update `docs/agent-memory/INDEX.md` only if needed to keep entries short and actionable; update `docs/developer/reference/chat-agent-runtime.md` to document the completed contract and keep a link to the spec as historical context.
- Keep commits small and vertical: each step should pass targeted tests and leave the repository working.

## Quality Gates

- Setup status: Existing gates are configured in `package.json`, `biome.json`, `tsconfig.json`, `playwright.config.ts`, and `.github/workflows/ci.yml`; no quality-gate setup step is required.
- Baseline command: `bun install --frozen-lockfile && bun run lint && bun run typecheck --incremental false && bun test`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run typecheck --incremental false`, `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, `bun run test:e2e`
- Targeted test commands expected during implementation:
  - `bun test src/server/chat/agent-runtime.test.ts`
  - `bun test src/server/chat/ask-siargao-agent.test.ts`
  - `bun test src/server/chat/agent-memory.test.ts`
  - `bun test src/server/chat/agent-tools.test.ts`
  - `bun test src/server/chat/source-consistency.test.ts`
  - `bun test src/app/api/chat/route.test.ts`

## Progress Tracking

- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step, validation results, commit reference if available, current status, and next step.

## Changelog Tracking

- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Ensure `CHANGELOG.md` exists before any quality-gate setup or implementation work begins. Preserve the existing file if present.
- Initial content: Include `# Changelog`, the standard preamble, and an `## [Unreleased]` section.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with human-readable notable changes under the appropriate `Unreleased` change-type headings before creating that step's commit.

## Goal Handoff

- Readiness: This plan is ready to be used as a `/goal` payload.
- Scope: The `/goal` should execute only the work described in this plan unless the user explicitly expands it.
- Done: The `/goal` is complete only when every item in `## Definition of Done` is satisfied, all incremental steps are complete, required quality gates pass or documented pre-existing failures are handled, `PROGRESS.md` and `CHANGELOG.md` are current, and the final state is summarized for the user.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup

Goal: Create durable progress and changelog tracking the user can inspect while the plan is executed.

Depends on:
- None.

Changes:
- Create `PROGRESS.md` in the project root.
- Add the plan title, source document path, current git status note, baseline quality-gate command, step checklist, current status, and update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Verify `CHANGELOG.md` exists in the project root. If missing, create it.
- Preserve existing changelog entries, and ensure the file contains `# Changelog`, the Keep a Changelog preamble, and an `## [Unreleased]` section.
- Document that `CHANGELOG.md` must be updated after each step is completed and validated, before that step is committed.

Acceptance Criteria:
- `PROGRESS.md` exists and lists every incremental step in this plan.
- `CHANGELOG.md` follows the required Keep a Changelog 1.0.0 structure without deleting existing entries.
- Pre-existing working-tree changes are recorded in `PROGRESS.md` so later commits do not accidentally claim unrelated work.

Advances Definition of Done:
- Establishes the required execution audit trail before implementation starts.

Validation:
- Run `test -f PROGRESS.md`
- Run `test -f CHANGELOG.md`
- Run `rg -n "^# Changelog|^## \\[Unreleased\\]|Keep a Changelog" CHANGELOG.md`
- Run `rg -n "Thin Agent Harness|Step 0|Step 1" PROGRESS.md`

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set current status to Step 1, and identify the next step.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing progress tracking for the thin agent harness implementation.

Commit:
- `Track thin harness implementation progress`

### Step 1: Agent Final Payload And Artifact Registry

Goal: Add the runtime data structures and tests needed to select public artifacts by final-payload IDs instead of automatically merging every tool-result artifact.

Depends on:
- Step 0.

Changes:
- Update `src/server/chat/agent-runtime.ts` or add `src/server/chat/agent-final-payload.ts` with:
  - `AgentFinalPayload`;
  - `AgentArtifactRegistry`;
  - artifact registry builders for cards, actions, and itineraries;
  - deterministic ID dedupe behavior;
  - selected/unselected artifact count helpers;
  - strict vs compatibility handling for unknown selected IDs.
- Change `createAgentTurnResult` so:
  - sources are still aggregated from all tool results;
  - itinerary source reconciliation/refresh logic can still run for selected itineraries;
  - tool-result cards/actions/itineraries are returned only when selected by `AgentFinalPayload`;
  - legacy plain-text mode does not expose tool-result artifacts automatically.
- Preserve explicit `cards`, `actions`, and `itineraries` arguments only for trusted deterministic callers/tests where appropriate.
- Update `src/server/chat/agent-runtime.test.ts`:
  - replace current automatic-merge expectations;
  - assert unselected cards/actions/itineraries are not returned;
  - assert selected IDs return the expected artifacts with carrier sources;
  - assert duplicate IDs are deterministic;
  - assert unknown selected IDs fail in strict mode and are dropped in compatibility mode;
  - assert source aggregation still includes all tool results.

Acceptance Criteria:
- Runtime tests prove public artifacts require explicit final-payload selection.
- Existing source aggregation and itinerary evidence behavior still work for selected itineraries.
- Empty selected artifacts are omitted from `AgentTurnResult`.

Advances Definition of Done:
- Implements the core public artifact backstop that prevents unrelated successful tool artifacts from leaking to clients.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/agent-runtime.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add an `Changed` or `Fixed` entry under `## [Unreleased]` describing selected-artifact runtime behavior.

Commit:
- `Select chat artifacts from final payload`

### Step 2: Structured Final Output Parsing In The Agent Loop

Goal: Make the Responses tool loop understand structured final payloads while keeping legacy plain-text compatibility.

Depends on:
- Step 1.

Changes:
- Update `src/server/chat/ask-siargao-agent.ts`:
  - add or import a parser for JSON/fenced-JSON `AgentFinalPayload` text;
  - add a dependency/internal option such as `requireStructuredFinalOutput?: boolean`;
  - update `responseContract` and instructions so final answers must return the structured payload;
  - when structured output is present, validate `usedToolCallIds`, pass the payload to `createAgentTurnResult`, and return `message: finalPayload.answer`;
  - when output is legacy plain text and strict mode is off, return the text with no tool-result artifacts;
  - when strict mode is on, fail or repair according to the new parser contract.
- Ensure `usedToolCallIds` can reference only tool call IDs from the current turn.
- Keep existing validation-repair loops for itinerary, condition, required checks, and surf-near-me evidence.
- Update `src/server/chat/ask-siargao-agent.test.ts`:
  - structured no-tool final output returns `answer`;
  - structured tool final output selects only named artifacts;
  - legacy plain text returns no unselected tool-result artifacts;
  - strict mode rejects legacy output;
  - invalid `usedToolCallIds` fails or is dropped according to mode.

Acceptance Criteria:
- Agent-loop tests cover structured and legacy final outputs.
- Existing tool-call execution and repair behavior continues to pass.
- The final response message comes from `AgentFinalPayload.answer` when structured output is present.

Advances Definition of Done:
- Connects the model-owned final-answer contract to runtime output.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/ask-siargao-agent.test.ts`
- Run `bun test src/server/chat/agent-runtime.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for structured final payload parsing and legacy compatibility.

Commit:
- `Parse structured agent final answers`

### Step 3: Dapa Breakfast Regression Coverage

Goal: Prove a food answer can use multiple tools internally without exposing unrelated beach artifacts.

Depends on:
- Step 2.

Changes:
- Add regression coverage in `src/server/chat/ask-siargao-agent.test.ts` or `src/app/api/chat/route.test.ts` with fake model/tool outputs:
  - user asks for breakfast in Dapa;
  - model calls `search_places` and `search_local_guide`;
  - `search_places` returns restaurant/place cards;
  - `search_local_guide` returns beach cards;
  - final payload selects only restaurant/place card IDs.
- Assert the public result contains the model-written breakfast answer and selected restaurant/place cards only.
- Add a companion legacy plain-text test showing the same tool outputs return no public cards when there is no structured selection.
- Avoid adding deterministic "food can only show place cards" routing as the primary fix.

Acceptance Criteria:
- The Dapa breakfast regression fails under the old automatic artifact merge and passes under selected artifacts.
- Beach cards from `search_local_guide` remain internal unless explicitly selected.
- Route response still includes appropriate tool-call and source metadata.

Advances Definition of Done:
- Covers the concrete failure named by the spec.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/ask-siargao-agent.test.ts`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Fixed` entry under `## [Unreleased]` for preventing irrelevant beach artifacts in food answers.

Commit:
- `Cover breakfast artifact selection regression`

### Step 4: Compact Agent Memory Catalog Rendering

Goal: Render Codex-style compact memory metadata while keeping `INDEX.md` as the only default full memory file.

Depends on:
- Step 3.

Changes:
- Update `src/server/chat/agent-memory.ts`:
  - add `AgentMemoryDocumentMetadata`;
  - add `AgentMemoryLoadOutcome` or a compatibility alias for `AgentMemorySnapshot`;
  - add descriptions and trigger terms to the manifest for every reference file;
  - preserve the manifest as the authoritative server allowlist;
  - keep `INDEX.md` as the only instruction-role file.
- Add `renderAvailableAgentMemory(outcome, options?)` in `agent-memory.ts` or a new `src/server/chat/agent-memory-render.ts`.
- Renderer requirements:
  - explain memory files are policy/reference context, not live evidence;
  - list filenames, titles, roles, descriptions, and compact trigger terms;
  - instruct the model to load the smallest relevant set with `load_agent_memory_file`;
  - explain memory files do not persist across turns unless reloaded or present in current context;
  - default to a small character budget such as 4,000 characters;
  - truncate descriptions before dropping filenames;
  - never truncate `INDEX.md` itself, because `INDEX.md` is handled separately as full instruction Markdown.
- Update `src/server/chat/agent-memory.test.ts`:
  - `INDEX.md` is the only instruction memory;
  - rendered metadata includes all reference filenames;
  - rendered metadata stays inside the configured budget;
  - missing files still produce clear errors;
  - version IDs still change when memory files change;
  - rendered metadata does not include full reference bodies or checksums.

Acceptance Criteria:
- Tests prove compact metadata is available by default and full reference bodies are not.
- Existing memory version/checksum behavior is preserved.

Advances Definition of Done:
- Establishes progressive-disclosure memory discovery.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/agent-memory.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for compact agent-memory metadata rendering.

Commit:
- `Render compact agent memory catalog`

### Step 5: Catalog-Backed Memory Tools

Goal: Make memory tools derive loadable documents from the current catalog outcome and return validation-friendly metadata without source labels.

Depends on:
- Step 4.

Changes:
- Update `src/server/chat/agent-tools.ts`:
  - build `load_agent_memory_file` and `search_agent_memory` schemas from the memory catalog/outcome where practical;
  - keep the TypeScript manifest as the only allowlist;
  - allow up to three exact files per `load_agent_memory_file` call;
  - return full loaded file bodies in `text` and `data.files`;
  - add `data.loadedMemoryFileNames`;
  - return no `sources` for memory retrieval;
  - make tool descriptions point the model back to `INDEX.md`;
  - ensure `search_agent_memory` returns excerpts only, not full file bodies.
- If dynamic Zod enum construction needs a fallback for empty lists, add a small tested helper rather than duplicating filename constants.
- Update `src/server/chat/agent-tools.test.ts`:
  - loadable document enum matches the catalog reference files;
  - exact loading returns up to three files and `loadedMemoryFileNames`;
  - unknown files fail cleanly;
  - memory retrieval has no source labels;
  - memory search returns excerpts only.

Acceptance Criteria:
- There is no separate hardcoded memory filename allowlist outside the catalog/manifest helper.
- Memory tool outputs contain enough metadata for final-payload validation.
- Memory retrieval remains source-free.

Advances Definition of Done:
- Makes memory loading model-directed and auditable without turning memory into evidence.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/agent-tools.test.ts`
- Run `bun test src/server/chat/agent-memory.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for catalog-backed memory tool schemas and outputs.

Commit:
- `Back memory tools with the catalog`

### Step 6: Prompt Construction Uses Available Memory Metadata

Goal: Inject compact memory discovery plus full `INDEX.md`, and remove detailed tool-routing knowledge from durable base instructions.

Depends on:
- Step 5.

Changes:
- Update `src/server/chat/ask-siargao-agent.ts`:
  - build instructions as `[askSiargaoBaseInstructions, renderAvailableAgentMemory(memoryOutcome), memoryOutcome.instructionMarkdown].join("\n\n")`;
  - shrink base instructions to durable product, scope, privacy, source, and final-output invariants;
  - keep tool-routing detail in memory files and tool descriptions where possible;
  - keep model-facing memory summary free of checksums, byte lengths, relative paths, vector-store IDs, and full reference bodies.
- Update `src/server/chat/ask-siargao-agent.test.ts`:
  - initial instructions contain compact available-memory metadata;
  - initial instructions contain full `INDEX.md`;
  - initial instructions do not contain full reference-file body phrases from `SURF.md`, `LOCAL_GUIDE_BEACHES.md`, or policy files;
  - response contract asks for structured final output and explicit artifact IDs.

Acceptance Criteria:
- Default prompt follows the target runtime contract.
- Existing memory redaction tests remain valid or are updated to the stricter contract.

Advances Definition of Done:
- Makes memory files behave like Codex skills: compact discovery first, full file load only when selected.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/ask-siargao-agent.test.ts`
- Run `bun test src/server/chat/agent-memory.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for index-only default memory prompt construction.

Commit:
- `Use compact memory metadata in prompts`

### Step 7: Final Payload Memory Validation And Clear-Case Repair

Goal: Validate memory usage in final payloads and add narrow repair behavior for clear `INDEX.md`-named memory requirements.

Depends on:
- Step 6.

Changes:
- Track current-turn memory observations from `load_agent_memory_file` and `search_agent_memory` tool results.
- Validate `usedMemoryFiles` in `AgentFinalPayload`:
  - allow only filenames loaded by current-turn memory tools or returned by memory search/file search when metadata is available;
  - drop/log invalid filenames in compatibility mode;
  - reject invalid filenames in strict mode.
- Add a narrow helper in `src/server/chat/ask-siargao-agent.ts` or a small module to detect clear latest-turn requirements named by `INDEX.md`, such as:
  - surf spot answers require `SURF.md`;
  - beach guide answers require `LOCAL_GUIDE_BEACHES.md`;
  - source-label/policy answers require `ASK_SIARGAO_SOURCE_POLICY.md`;
  - tool-use/data-boundary answers require the matching policy/data dictionary files.
- Continue the tool loop with a validation-repair instruction when the model tries a final answer for a clear memory-covered topic without loading the named file.
- Do not force beach/surf memory for ordinary food, breakfast, cafe, restaurant, or Google Places evidence prompts.
- Update tests in `src/server/chat/ask-siargao-agent.test.ts`:
  - surf request loads or is repaired to load `SURF.md` before final answer;
  - beach request loads `LOCAL_GUIDE_BEACHES.md`;
  - source-policy request loads `ASK_SIARGAO_SOURCE_POLICY.md`;
  - breakfast request is not forced to load beach/surf memory;
  - invalid `usedMemoryFiles` is rejected/dropped according to mode.

Acceptance Criteria:
- Clear memory-covered answers load the relevant memory file before final prose.
- Food/place answers are not over-routed into unrelated memory files.
- Memory file use is current-turn scoped.

Advances Definition of Done:
- Enforces progressive disclosure without making memory persistent or deterministic prose.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/ask-siargao-agent.test.ts`
- Run `bun test src/server/chat/agent-tools.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for current-turn memory validation and clear-case memory repair.

Commit:
- `Validate model-selected memory usage`

### Step 8: Memory-Aware Source Consistency Validation

Goal: Ensure memory retrieval cannot be used as live/provider/source evidence and selected artifacts cannot carry unsupported source labels.

Depends on:
- Step 7.

Changes:
- Update `src/server/chat/source-consistency.ts`:
  - explicitly treat `load_agent_memory_file`, `search_agent_memory`, and hosted memory retrieval as non-verifying evidence;
  - reject structured or rendered source claims where memory retrieval is the only backing for live/provider/curated labels;
  - preserve `not_verified` behavior for generic reasoning where appropriate.
- Update `src/server/chat/source-consistency.test.ts`:
  - memory retrieval cannot justify `live_checked`, `fresh_cache`, `weather_checked`, `marine_checked`, `tide_forecast_checked`, `curated_local_guide`, or `provider_unavailable`;
  - memory retrieval may coexist with governed tool evidence but does not add checked labels;
  - selected itinerary/card source labels still require matching governed tool evidence when labels are verifying.
- Update route/runtime validation if selected artifacts need an extra source-label check before public return.

Acceptance Criteria:
- Source-consistency tests cover memory retrieval boundaries.
- Existing provider/weather/marine/tide/source-policy validation remains intact.

Advances Definition of Done:
- Keeps deterministic validation focused on evidence and source contracts.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/source-consistency.test.ts`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Security` or `Fixed` entry under `## [Unreleased]` for preventing memory retrieval from backing checked source labels.

Commit:
- `Keep memory retrieval out of source evidence`

### Step 9: Chat Route Public Contract And Observability

Goal: Return only the structured final answer and selected artifacts through `/api/chat`, with useful artifact-selection logs and no public memory internals.

Depends on:
- Step 8.

Changes:
- Update `src/app/api/chat/chat-route.ts` if needed:
  - keep `message` sourced from `AgentTurnResult.message`, which is `finalPayload.answer` for structured outputs;
  - return only selected `cards`, `actions`, and `itineraries`;
  - log selected/unselected artifact counts from the runtime result or metadata;
  - keep public memory metadata limited to version ID, file IDs, filenames, and roles;
  - keep source consistency validation running against selected public itinerary sources plus aggregate tool sources.
- Update `src/app/api/chat/route.test.ts`:
  - public response never exposes unselected artifacts;
  - public response does not expose checksums, byte lengths, vector-store IDs, relative paths, raw memory internals, or exact browser coordinates;
  - route does not replace provider-failure or source-consistency failures with deterministic final prose;
  - structured selected cards/actions/itineraries still serialize as expected.

Acceptance Criteria:
- `/api/chat` contract is explicit and tested.
- Observability helps debug unselected artifacts without leaking restricted data.

Advances Definition of Done:
- Completes the public API side of selected artifact behavior and memory redaction.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/app/api/chat/route.test.ts`
- Run `bun test src/server/chat/agent-runtime.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for the `/api/chat` selected-artifact public contract.

Commit:
- `Expose only selected chat artifacts`

### Step 10: Documentation Alignment

Goal: Document the completed thin-harness runtime contract for future maintainers.

Depends on:
- Step 9.

Changes:
- Update `docs/developer/reference/chat-agent-runtime.md`:
  - describe structured final payload fields and validation;
  - describe selected public artifact behavior;
  - describe compact available-memory metadata plus full `INDEX.md`;
  - describe memory retrieval as source-free policy/reference context;
  - describe strict vs compatibility behavior;
  - keep a link to `thin-agent-harness-spec.md` as implementation background.
- Update `docs/agent-memory/INDEX.md` only if implementation uncovered missing routing boundaries:
  - keep it short;
  - include when to load each file;
  - include required live tools where relevant;
  - include boundaries where the file must not be used.
- Update `docs/README.md` only if the developer documentation index needs to link the runtime reference or spec. Preserve any pre-existing user edits.

Acceptance Criteria:
- Docs match implemented behavior and do not describe automatic artifact merging.
- Memory documentation remains concise and does not duplicate full reference-file contents.

Advances Definition of Done:
- Gives future agents and maintainers the operational contract without re-reading the spec.

Validation:
- Run `bun run format`
- Run `bun run lint`
- Run `bun run typecheck --incremental false`
- Run `bun test src/server/chat/agent-memory.test.ts`
- Run `bun test src/server/chat/ask-siargao-agent.test.ts`
- Run `bun test`

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Add a `Changed` entry under `## [Unreleased]` for documenting the thin agent harness contract.

Commit:
- `Document thin chat harness contract`

### Step 11: Full Quality Gates And Manual Chat Checks

Goal: Validate the complete implementation against repository gates and the manual scenarios from the spec.

Depends on:
- Step 10.

Changes:
- Fix any failures from full gate runs.
- If gate failures are pre-existing and unrelated, document them precisely in `PROGRESS.md` with command output summaries and continue only if the implementation itself is validated.
- Run or document manual chat checks using local/test-safe configuration:
  - `i want to go surfing today, what are the best spots closest to me?`
  - `can you tell me the best time to go to Pilar for the best waves?`
  - `i'll go to dapa later, tell me some good places for breakfast`
  - `plan a sandy beach half-day within 30 minutes from General Luna`
- Confirm the Dapa breakfast check returns no beach cards unless the final payload explicitly selected beach card IDs.

Acceptance Criteria:
- CI-equivalent commands pass or pre-existing failures are clearly documented.
- Manual checks confirm the main runtime contract.
- `PROGRESS.md` and `CHANGELOG.md` are current before the final commit.

Advances Definition of Done:
- Confirms the complete finished state and records final validation evidence.

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
- Update `PROGRESS.md` with final validation results, current status, commit reference if available, and any residual risks.

Changelog:
- Ensure `CHANGELOG.md` includes final notable entries under `## [Unreleased]` and no implementation step is missing from the human-readable change summary.

Commit:
- `Validate thin chat harness implementation`

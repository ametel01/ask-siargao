# Implementation Plan

## Source Documents
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_ROADMAP.md`
  - Role: Primary roadmap source.
  - Summary: Only `Priority 5: Persistent Agent Memory` is in scope. Ask Siargao
    must give the AI durable product memory through Markdown files, explicit
    instruction loading, OpenAI vector-store `file_search`, and schema/tool
    description memory. Required memory files are `ASK_SIARGAO_AGENT_SKILLS.md`,
    `ASK_SIARGAO_TOOL_USE_POLICY.md`, `ASK_SIARGAO_DATA_DICTIONARY.md`,
    `ASK_SIARGAO_SOURCE_POLICY.md`, and `ASK_SIARGAO_LOCAL_ASSUMPTIONS.md`.
    Tests must fail when required memory files are missing, verify chat adapter
    instruction injection, and verify source-policy or data-dictionary retrieval.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_AGENTIC_ARCHITECTURE.md`
  - Role: Supporting architecture constraints.
  - Summary: Local Markdown files are not model memory unless the app deliberately
    wires them into the agent. Persistent memory should use three layers: small
    instruction Markdown loaded into model instructions, larger Markdown indexed
    in file search/vector stores, and backend tools for dynamic knowledge. The
    backend remains the tool runtime and governance layer; the model owns tool
    selection, synthesis, and final wording.
- Path: `/Users/alexmetelli/source/ask-siargao/docs/ASK_SIARGAO_POSITIONING.md`
  - Role: Supporting product-positioning constraints.
  - Summary: Ask Siargao should win as a focused Siargao trip copilot with live
    local tools, curated knowledge, source caveats, and persistent product memory.
    Memory must teach the AI how Ask Siargao behaves, how data is structured, when
    to use backend tools, how to phrase source caveats, and which Siargao-specific
    assumptions matter. Generic model reasoning must never be labeled as a live
    check.

## Goals
- Create durable agent-memory Markdown files that a product owner can review and a
  maintainer can update without hiding product behavior in scattered code branches.
- Add a tested memory manifest and loader that validates required files, classifies
  instruction versus reference memory, and computes checksums/version IDs.
- Load small, stable policy files into the Responses `instructions` used by
  `runAskSiargaoAgentTurn`.
- Make agent memory version metadata visible to logs, route responses, and tests so
  deployments can tell which memory version a chat turn used.
- Add vector-store synchronization for larger reference files and register the
  Responses `file_search` hosted tool when `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID`
  is configured.
- Add a deterministic backend memory-search fallback/tool for local development and
  tests when the vector store is not configured.
- Preserve the existing Priority 4 agent runtime, function-tool loop, source
  consistency checks, provider-governance rules, and AI-written final-answer
  contract.

## Non-Goals
- Do not implement Priority 6 safe database querying, SQL-like tools, or production
  database schema introspection beyond static data-dictionary memory.
- Do not add long-term per-user chat memory, trip persistence, saved plans, or
  personalization.
- Do not change the user-facing chat UI except for already-supported structured
  response fields if memory metadata is returned.
- Do not upload files automatically during normal chat requests.
- Do not expose raw restricted provider payloads, secrets, private data, review
  text, bookings, table availability, or room availability through memory.
- Do not replace the existing backend tools for live weather, Google Places, local
  guide, or source policy.

## Assumptions and Open Questions
- Assumption: Priority 4 is complete in the current worktree; this plan builds on
  `src/server/chat/ask-siargao-agent.ts`, `src/server/chat/agent-runtime.ts`,
  `src/server/chat/agent-tools.ts`, and `/api/chat` route delegation rather than
  re-planning the tool runtime.
- Assumption: The current inline `askSiargaoAgentInstructions` should become a
  small immutable base plus loaded Markdown instructions, not be removed in one
  risky rewrite.
- Assumption: The installed `openai` SDK supports Responses `file_search` tools
  with `{ type: "file_search", vector_store_ids: [...] }` and exposes vector-store
  file APIs. The implementation should use these installed SDK types instead of
  hand-rolled request shapes.
- Assumption: `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` is a server-only environment
  variable. The sync script may print the value to set, but committed docs must not
  contain real vector-store IDs from private deployments.
- Assumption: The backend memory-search fallback is acceptable because the roadmap
  acceptance criteria allow larger Markdown references through `file_search` or a
  backend memory tool. Production should prefer `file_search` when configured.
- Assumption: Agent memory is policy/reference context, not direct live evidence.
  Memory retrieval should not create `live_checked`, `fresh_cache`, or
  `weather_checked` source summaries.
- Open question: Whether hosted `file_search` call details should be surfaced in
  `AgentToolCallAudit`. Conservative default: record configured vector-store IDs
  and memory version metadata locally; only add hosted call audit fields later if
  the Responses output shape provides stable file-search call records.
- Open question: Whether `src/server/llm/chat-adapter.ts` is still used outside
  legacy tests. Conservative default: update shared message types only if needed
  and keep legacy adapter behavior unchanged.
- Open question: The worktree currently has user-owned changes: `PLAN.md` and
  `PROGRESS.md` deleted, and `docs/ASK_SIARGAO_ROADMAP.md` modified to mark
  Priority 4 completed. Executors must not revert unrelated user changes.

## Quality Gates
- Setup status: Existing gates are configured in `package.json`, `biome.json`,
  `tsconfig.json`, `playwright.config.ts`, and `.github/workflows/ci.yml`. No
  quality-gate setup step is required.
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
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation
  work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the
  completed step, validation results, commit reference if available, current
  status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Create `CHANGELOG.md` before any quality-gate setup or
  implementation work begins.
- Initial content: Include `# Changelog`, the standard preamble, and an
  `## [Unreleased]` section.
- Update rule: After each step is completed and validated, update `CHANGELOG.md`
  with human-readable notable changes under the appropriate `Unreleased`
  change-type headings before creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress and changelog files the user can consult while the
plan is being executed.

Depends on:
- None

Changes:
- Create `PROGRESS.md` in the project root.
- Add the plan title, source document list, checklist for every step below,
  current status, and a short update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Create `CHANGELOG.md` in the project root before any implementation work begins.
- Add Keep a Changelog 1.0.0 structure: `# Changelog`, the standard preamble, and
  `## [Unreleased]`.
- Document that `CHANGELOG.md` must be updated after each step is completed and
  validated, before that step is committed.

Acceptance Criteria:
- `PROGRESS.md` exists and includes all planned step names.
- `CHANGELOG.md` exists and contains the required Keep a Changelog structure.

Validation:
- Confirm `PROGRESS.md` exists and contains the step checklist.
- Confirm `CHANGELOG.md` exists and follows the required Keep a Changelog 1.0.0
  structure.

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current
  status, and identify Step 1 as next.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing progress and
  changelog tracking.

Commit:
- `Add persistent memory tracking files`

### Step 1: Agent Memory Files, Manifest, and Validation
Goal: Establish reviewable Markdown memory and a tested loader that fails fast
when required memory is missing.

Depends on:
- Step 0

Changes:
- Create `docs/agent-memory/`.
- Add `docs/agent-memory/ASK_SIARGAO_AGENT_SKILLS.md` covering:
  - Ask Siargao role and scope;
  - AI-written final-answer requirement;
  - when to ask clarifying questions;
  - concise, actionable answer expectations.
- Add `docs/agent-memory/ASK_SIARGAO_TOOL_USE_POLICY.md` covering:
  - when weather, Places, local guide, source policy, and memory tools are
    required;
  - that live/local facts require tools;
  - provider failure handling and uncertainty wording.
- Add `docs/agent-memory/ASK_SIARGAO_DATA_DICTIONARY.md` covering:
  - existing safe domain surfaces in `src/server/chat`, `src/server/providers`,
    `src/server/local`, and governed database concepts;
  - explicit warning that unrestricted database access is out of scope.
- Add `docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md` covering:
  - source labels from `src/server/chat/answer-source-summary.ts`;
  - checked/not-checked wording;
  - Google Places, Open-Meteo, curated guide, and generic reasoning caveats.
- Add `docs/agent-memory/ASK_SIARGAO_LOCAL_ASSUMPTIONS.md` covering:
  - Siargao-specific stable assumptions from the positioning document;
  - distance/ride-time caveats, rainy-day limits, beach-surface caveats, and
    tourist assumption traps.
- Add `src/server/chat/agent-memory.ts` with:
  - a required-file manifest;
  - memory role classification, such as `instruction` versus `reference`;
  - `loadAgentMemorySnapshot({ rootDir? })`;
  - checksum generation per file;
  - one deterministic aggregate `versionId`;
  - a compact instruction Markdown string for instruction files;
  - reference file descriptors for vector-store sync and backend retrieval.
- Add `src/server/chat/agent-memory.test.ts` covering:
  - all required files load from the repo root;
  - missing required files fail with a clear error;
  - checksums and aggregate version IDs change when content changes;
  - instruction memory contains the AI-written-answer and live-tool requirements;
  - reference memory includes data dictionary and source policy descriptors.

Acceptance Criteria:
- Product behavior, tool-use rules, source policy, data dictionary, and local
  assumptions exist as reviewable Markdown under `docs/agent-memory/`.
- Tests fail if any required memory file is missing.
- The loader returns stable checksums and a version ID without network access.
- The memory content explicitly states that every final answer must be AI-written
  and that tools are required for live/local facts.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference
  if available, current status, and Step 2 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for
  reviewable agent-memory Markdown and required-file validation.

Commit:
- `Add agent memory files and validation`

### Step 2: Instruction Memory Injection and Version Metadata
Goal: Make the chat agent receive loaded Markdown instructions and expose which
memory version was used for each valid chat turn.

Depends on:
- Step 0
- Step 1

Changes:
- Update `src/server/chat/agent-runtime.ts`:
  - add an `AgentMemoryMetadata` type with `versionId`, `files`, and optional
    `vectorStoreId`;
  - add optional `memory?: AgentMemoryMetadata` to `AgentTurnResult`;
  - add optional dependency injection for a preloaded memory snapshot if needed by
    tests.
- Update `src/server/chat/ask-siargao-agent.ts`:
  - keep a small base instruction string in code;
  - load instruction memory from `loadAgentMemorySnapshot`;
  - append loaded instruction Markdown to Responses `instructions` for the first
    model call and every follow-up call using `previous_response_id`;
  - include `agentMemory` metadata in the JSON input contract;
  - include memory `versionId` and file checksum summaries in logs without logging
    full memory file content;
  - return memory metadata in `createAgentTurnResult`.
- Update `src/app/api/chat/chat-route.ts`:
  - include memory metadata in successful JSON responses if present;
  - include memory `versionId` in route logs.
- Update `src/server/chat/ask-siargao-agent.test.ts`:
  - verify Responses `instructions` contain loaded Markdown memory;
  - verify both initial and follow-up tool-loop calls use the same memory
    instructions;
  - verify `AgentTurnResult.memory.versionId` is returned;
  - verify logs do not include raw memory document bodies.
- Update `src/app/api/chat/route.test.ts`:
  - verify successful route responses can include memory metadata;
  - verify malformed requests still fail before memory loading or model calls.

Acceptance Criteria:
- The agent receives product behavior instructions from Markdown, not only inline
  strings in code.
- Memory version metadata is available in runtime results, route responses, and
  logs.
- Tool-loop continuation calls do not drop instructions, because Responses
  instructions are not automatically carried over with `previous_response_id`.
- Existing model-written final-answer and source-consistency behavior still passes.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference
  if available, current status, and Step 3 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with a `Changed` entry for
  Markdown-backed chat-agent instructions and memory version reporting.

Commit:
- `Load agent memory into chat instructions`

### Step 3: Vector Store Sync and Operational Configuration
Goal: Provide a repeatable way to upload larger memory references to an OpenAI
vector store without doing network work during chat requests.

Depends on:
- Step 0
- Step 1
- Step 2

Changes:
- Add `src/server/chat/agent-memory-vector-store.ts` with:
  - a small OpenAI client factory using `OPENAI_API_KEY`;
  - functions to create or retrieve a vector store;
  - functions to upload or attach reference memory files;
  - checksum-aware metadata so unchanged files can be skipped where API metadata
    allows;
  - a dry-run mode for CI/local verification without network calls.
- Add `src/server/chat/sync-agent-memory-vector-store.ts` as a Bun script that:
  - loads the memory manifest;
  - syncs reference files, not instruction-only files, to a vector store;
  - prints the vector store ID and memory version ID;
  - exits non-zero when required memory files are missing or an upload fails.
- Add a package script in `package.json`:
  - `agent-memory:sync`: `bun run src/server/chat/sync-agent-memory-vector-store.ts`
- Add `src/server/chat/agent-memory-vector-store.test.ts` using fake OpenAI
  vector-store/file clients to cover:
  - dry-run output;
  - create versus reuse behavior;
  - skipped unchanged files;
  - failed upload propagation;
  - no secret or raw file-body logging.
- Update `documentation/developer/reference/environment.md`:
  - document server-only `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID`;
  - document that `OPENAI_API_KEY` is required for the sync script and live
    Responses calls;
  - state that vector-store IDs and OpenAI API keys must not use `NEXT_PUBLIC_`.
- Update `documentation/developer/reference/scripts.md` if it exists or the closest
  script reference document in `documentation/developer/reference/`:
  - document `bun run agent-memory:sync`;
  - describe local dry-run usage and production sync expectations.

Acceptance Criteria:
- Maintainers can sync larger reference memory to an OpenAI vector store with one
  repo script.
- Normal chat requests never upload memory files.
- The script exposes enough output for deploy configuration without committing
  private vector-store IDs.
- Environment and script documentation explain how to configure file search.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference
  if available, current status, and Step 4 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for
  vector-store memory synchronization and configuration documentation.

Commit:
- `Add agent memory vector store sync`

### Step 4: File Search Tool Registration and Backend Memory Fallback
Goal: Let the model retrieve larger memory references through OpenAI `file_search`
when configured, with a deterministic backend retrieval fallback for tests and
local development.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3

Changes:
- Update `src/server/chat/agent-runtime.ts`:
  - extend `AskSiargaoAgentToolName` to include `search_agent_memory` if using the
    backend fallback;
  - allow runtime tool definitions to include hosted tools as well as function
    tools, or add a typed `AgentHostedToolDefinition` for `file_search`.
- Update `src/server/chat/agent-tools.ts`:
  - add `search_agent_memory` with strict Zod arguments such as `query`,
    `documents`, and `max_results`;
  - implement deterministic local search over loaded reference memory files;
  - return concise excerpts and file names, but no live/source evidence labels;
  - keep source policy/data dictionary retrieval testable without OpenAI network
    access.
- Add or update a tool-builder helper, for example
  `buildAgentResponseTools(memorySnapshot)`, that:
  - always includes existing backend function tools;
  - includes `{ type: "file_search", vector_store_ids: [id], max_num_results: ... }`
    when `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` is configured;
  - includes `search_agent_memory` when no vector store is configured or when a
    test explicitly enables fallback mode;
  - never exposes both paths in a way that encourages duplicate retrieval unless a
    test or debug flag requests it.
- Update `src/server/chat/ask-siargao-agent.ts`:
  - pass the built tool list to every Responses call;
  - include memory retrieval guidance in the response contract;
  - ignore hosted `file_search_call` output items in the function-call executor
    path, because OpenAI handles hosted file search internally;
  - keep existing function-tool loop behavior unchanged for backend tools.
- Update `src/server/chat/agent-tools.test.ts`:
  - verify `search_agent_memory` retrieves source-policy content;
  - verify `search_agent_memory` retrieves data-dictionary content;
  - verify invalid memory-search arguments return `invalid_tool_arguments`;
  - verify memory search does not produce `live_checked`, `fresh_cache`, or
    `weather_checked` summaries.
- Update `src/server/chat/ask-siargao-agent.test.ts`:
  - verify Responses requests include `file_search` with the configured vector
    store ID;
  - verify fallback mode includes `search_agent_memory`;
  - verify no network is required for backend fallback tests.

Acceptance Criteria:
- The agent can retrieve larger Markdown references through OpenAI `file_search`
  when a vector-store ID is configured.
- The agent can retrieve source policy or data dictionary content through a backend
  memory tool in local/test mode.
- Required live/local fact claims still require weather, Places, local guide, or
  other governed backend tools; memory retrieval alone is not treated as live
  evidence.
- Existing backend tool schemas, provider field masks, and source consistency tests
  remain intact.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference
  if available, current status, and Step 5 as next.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with an `Added` entry for
  file-search memory retrieval and backend memory fallback.

Commit:
- `Wire agent memory retrieval tools`

### Step 5: Runtime Reference, Release Checks, and Cleanup
Goal: Document how persistent agent memory works and finish with a full validation
pass that another maintainer can trust.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Update `docs/developer/reference/chat-agent-runtime.md`:
  - describe the three memory layers: instruction Markdown, vector-store
    `file_search`, and backend memory fallback/tooling;
  - document how to add or edit an agent memory file;
  - document source-policy constraints for memory retrieval;
  - document that final answers remain AI-written and live/local facts still need
    governed tools.
- Update `docs/README.md` or the closest docs index to link the agent-memory
  reference if needed.
- Review `src/server/llm/chat-adapter.ts` and `src/server/llm/chat-adapter.test.ts`:
  - if the legacy adapter is still intentionally separate, document it as legacy or
    out of scope;
  - if it is dead after Priority 4, create a small follow-up issue instead of
    deleting it in this plan.
- Run a focused final audit of changed files for:
  - no committed private vector-store IDs;
  - no `NEXT_PUBLIC_` server secrets;
  - no raw memory bodies in logs;
  - no live/source labels backed only by memory retrieval;
  - no normal chat-request path that uploads files.
- If e2e tests need a deterministic memory fallback, configure test dependencies
  rather than requiring real OpenAI vector-store access.

Acceptance Criteria:
- Developer docs explain how persistent memory is authored, validated, synced, and
  used by the chat runtime.
- The final diff contains no secrets, deployment-specific vector-store IDs, or
  unrelated refactors.
- Full CI-equivalent gates pass or any skipped gate is recorded with a concrete
  reason in `PROGRESS.md`.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test && bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completion notes, validation results, commit reference
  if available, current status, and mark the plan complete.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with `Changed` or `Added` entries
  for persistent memory documentation and final release-readiness work.

Commit:
- `Document persistent agent memory`

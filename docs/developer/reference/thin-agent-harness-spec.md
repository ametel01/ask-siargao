# Thin Agent Harness Implementation Spec

Status: proposed implementation plan.

This spec describes how to reshape the Ask Siargao chat runtime into a thin harness around the
model, using the same practical pattern Codex CLI uses for skills:

- compact metadata is available by default;
- full knowledge files are loaded only when the model chooses them;
- the harness executes tools and enforces invariants;
- the model owns tool choice, synthesis, final wording, and visible artifact selection.

## Problem

The current runtime is close to this model, but it still has two harness behaviors that are too
thick:

1. Deterministic intent signals still influence tool and artifact behavior beyond validation.
2. `buildAgentTurnResult` merges cards and actions from every successful tool result into the
   public response.

The Dapa breakfast failure is the concrete bug this spec is meant to prevent. The model correctly
recognized a food request and called `search_places`, but it also called `search_local_guide`.
`search_local_guide` returned beach cards. The runtime then surfaced those beach cards because it
automatically merged artifacts from all tool results.

The correct harness behavior is: tools may produce many observations, but only the model decides
which observations belong in the final answer and which artifacts should be shown.

## Goals

- Keep `docs/agent-memory/INDEX.md` as the only default domain-memory instruction file.
- Make memory loading model-directed through `load_agent_memory_file` or `search_agent_memory`.
- Make memory files behave like Codex skills: compact discovery first, full file load only when
  selected.
- Remove automatic public artifact surfacing from tool results.
- Require the final answer to name the cards, actions, and itineraries that should be displayed.
- Keep deterministic code focused on execution, validation, privacy, source consistency, and
  observability.
- Add tests that prevent irrelevant beach artifacts from appearing in food answers.

## Non-Goals

- Do not add unrestricted database access.
- Do not make memory retrieval a live evidence source.
- Do not remove deterministic provider tools or source consistency checks.
- Do not introduce multi-root user or plugin memory packs yet.
- Do not make `/api/chat` render request-specific deterministic final prose. The current runtime
  supersedes this original non-goal with one shared terminal fallback for exhausted or unusable
  model responses.

## Codex CLI Logic To Reuse

Codex CLI separates skill handling into four modules. Ask Siargao should copy the shape, not the
Rust implementation.

| Codex concept | Ask Siargao equivalent |
| --- | --- |
| `SkillLoadOutcome` | `AgentMemoryLoadOutcome` |
| available skills developer block | available memory developer block plus `INDEX.md` |
| explicit skill injection | optional explicit `$memory-file` handling |
| full `SKILL.md` read after selection | `load_agent_memory_file` |
| render budget and path aliases | memory metadata render budget |
| enabled/disabled skill config | future memory file gating, not required for first pass |

The important design is progressive disclosure. The model sees enough to choose the right file, not
every domain rule by default.

## Target Runtime Contract

Every successful chat turn should follow this sequence:

1. The route validates the request and builds infrastructure context.
2. The runtime loads the agent-memory catalog.
3. The runtime injects minimal base instructions plus `INDEX.md`.
4. The runtime exposes governed tools, including memory-loading tools.
5. The model calls memory and data tools as needed.
6. The model returns a structured final payload.
7. The harness validates the payload and exposes only selected artifacts.
8. The route returns the model-written answer plus validated sources, tool calls, and selected
   artifacts.

The model should own all final-answer synthesis. The harness should only reject or repair violations
of hard contracts.

## Final Answer Schema

Add a structured final payload for agent turns.

```ts
export type AgentFinalPayload = {
  answer: string;
  usedMemoryFiles: string[];
  usedToolCallIds: string[];
  displayCardIds: string[];
  displayActionIds: string[];
  displayItineraryIds: string[];
};
```

Rules:

- `answer` is the only user-facing prose returned as `message`.
- `usedMemoryFiles` must contain only memory filenames returned by memory retrieval tools.
- `usedToolCallIds` must contain only tool call IDs from the current turn.
- `displayCardIds` must contain only card IDs produced by current-turn tools.
- `displayActionIds` must contain only action IDs produced by current-turn tools.
- `displayItineraryIds` must contain only itinerary IDs produced by current-turn tools.
- Unselected artifacts remain internal and can be logged, but they are not returned to the client.

Fallback behavior:

- If the model returns legacy plain text, continue to support it temporarily, but return no cards,
  actions, or itineraries unless they were explicitly supplied by trusted deterministic code.
- Add a feature flag or internal option so tests can require structured final output before making
  it mandatory in production.

## Memory Catalog

Keep `src/server/chat/agent-memory.ts` as the catalog loader, but deepen its interface.

Proposed types:

```ts
export type AgentMemoryDocumentMetadata = {
  id: string;
  title: string;
  fileName: string;
  relativePath: string;
  role: "instruction" | "reference";
  description: string;
  triggerTerms: string[];
};

export type AgentMemoryLoadOutcome = {
  versionId: string;
  documents: AgentMemoryDocumentMetadata[];
  instructionMarkdown: string;
  referenceFiles: AgentMemoryReferenceFile[];
  errors: AgentMemoryLoadError[];
};
```

The first pass can keep the current `requiredAgentMemoryManifest` as the allowlist. A later pass can
move `description` and `triggerTerms` into YAML frontmatter in each memory file.

`INDEX.md` remains authoritative for model-facing routing rules. The TypeScript manifest remains
authoritative for which files the server is willing to load.

## Memory Prompt Rendering

Add a renderer similar to Codex's available-skills block:

```ts
export function renderAvailableAgentMemory(outcome: AgentMemoryLoadOutcome): string;
```

The rendered block should include:

- a short explanation that memory files are policy/reference context, not live evidence;
- the list of memory filenames, titles, and descriptions;
- the instruction to load the smallest relevant set with `load_agent_memory_file`;
- the rule that memory files do not persist across turns unless reloaded or present in the current
  model context.

Budget behavior:

- Default to a small character budget, for example 4,000 characters.
- If metadata exceeds budget, truncate descriptions before dropping file names.
- Never truncate `INDEX.md` itself.

Prompt construction in `ask-siargao-agent.ts` should become:

```ts
[
  askSiargaoBaseInstructions,
  renderAvailableAgentMemory(memoryOutcome),
  memoryOutcome.instructionMarkdown,
].join("\n\n");
```

`askSiargaoBaseInstructions` should only include durable product and safety invariants. Tool-routing
detail belongs in memory files.

## Memory Loading Tools

Keep `load_agent_memory_file` as the primary progressive-disclosure tool.

Required changes:

- Build the enum of loadable documents from the memory catalog outcome, not duplicated constants.
- Allow the model to load up to 3 exact files per call.
- Return full file bodies in `text`, plus metadata in `data.files`.
- Include a stable `loadedMemoryFileNames` field in the tool result for validation.
- Do not attach `sources` for memory retrieval.

Keep `search_agent_memory` as a development and fallback retrieval tool:

- It may search reference files.
- It must not create source labels.
- It should return excerpts only, not whole files.
- It should be treated as weaker than `load_agent_memory_file` when `INDEX.md` names an exact file.

Hosted `file_search` may remain optional. It should follow the same policy: retrieved memory is not
live evidence.

## Explicit Memory Mentions

Explicit memory mentions are optional for the first implementation, but the runtime should reserve a
simple syntax:

- `$SURF`
- `$SURF.md`
- `[$SURF](memory://SURF.md)`

If implemented, explicit mentions should not bypass the memory policy. They should either:

- inject the selected memory file as a contextual user fragment, or
- force an initial `load_agent_memory_file` tool call before normal model reasoning.

Do not infer explicit memory selection from ordinary words like "surf" or "beach". Ordinary topical
selection belongs to the model after reading `INDEX.md`.

## Artifact Collection And Selection

Change `buildAgentTurnResult` so it does not automatically expose cards, actions, and itineraries
from every tool result.

Current behavior to remove:

```ts
const mergedCards = dedupeCardsById([
  ...(cards ?? []),
  ...artifactCarriers.flatMap((result) => cardsWithCarrierSources(result)),
]);
```

Target behavior:

1. Collect all tool-produced artifacts into an internal `AgentArtifactRegistry`.
2. Parse the model's `AgentFinalPayload`.
3. Return only artifacts whose IDs appear in `displayCardIds`, `displayActionIds`, or
   `displayItineraryIds`.
4. Log unselected artifact counts for debugging.

Proposed type:

```ts
export type AgentArtifactRegistry = {
  cardsById: Map<string, RecommendationCard>;
  actionsById: Map<string, ChatAction>;
  itinerariesById: Map<string, ItineraryPlan>;
};
```

Validation rules:

- Unknown selected IDs should fail the turn in strict mode.
- In compatibility mode, unknown selected IDs should be dropped and logged.
- Duplicate IDs should be deduped deterministically.
- Artifact IDs should remain stable across cards from the same tool result.

## Source And Evidence Validation

Keep existing source consistency validation. Add memory and artifact validation on top.

Validation checks:

- Final answer cannot claim live weather, open status, rating, tide, marine condition, booking, road
  condition, or safety clearance without a matching governed tool result.
- `usedMemoryFiles` must be a subset of loaded memory files or file-search/search-memory results.
- Memory retrieval must not create `live_checked`, `fresh_cache`, `weather_checked`,
  `marine_checked`, `tide_forecast_checked`, `curated_local_guide`, or `provider_unavailable`.
- Public cards, actions, and itineraries must be selected by the model final payload.

Do not add deterministic content routing such as "food answers can only show place cards" as the
primary fix. That can be a defensive validator later, but the main contract is model-selected
artifacts.

## Code Changes By File

### `src/server/chat/agent-memory.ts`

- Rename the current snapshot concept to `AgentMemoryLoadOutcome` or add a compatible alias.
- Add metadata descriptions for each reference file.
- Add `renderAvailableAgentMemory` or move rendering to `agent-memory-render.ts`.
- Keep `INDEX.md` as the only instruction-role memory file.
- Add tests for missing files, version changes, index-only instructions, and rendered metadata.

### `src/server/chat/agent-tools.ts`

- Build memory tool schemas from the catalog outcome where possible.
- Add `loadedMemoryFileNames` to `load_agent_memory_file` result data.
- Keep memory retrieval source-free.
- Make tool descriptions point the model back to `INDEX.md`.

### `src/server/chat/ask-siargao-agent.ts`

- Shrink base instructions.
- Inject the available-memory block plus `INDEX.md`.
- Ask for structured final output using `AgentFinalPayload`.
- Parse model output into `{ message, finalPayload }`.
- Continue the tool loop if the model tries to answer from domain memory without loading a relevant
  file and `INDEX.md` clearly names one.

### `src/server/chat/agent-runtime.ts`

- Add `AgentArtifactRegistry`.
- Stop automatically returning all tool-result cards/actions/itineraries.
- Return selected artifacts from `AgentFinalPayload`.
- Preserve source aggregation for validation, because source consistency still needs all audited
  tool calls.

### `src/app/api/chat/chat-route.ts`

- Return `message: finalPayload.answer`.
- Return only selected `cards`, `actions`, and `itineraries`.
- Log selected and unselected artifact counts.
- Keep public memory metadata redacted.

### `src/server/chat/source-consistency.ts`

- Add validation that memory retrieval cannot justify live/source labels.
- Add checks for selected artifact source labels if needed.

### `docs/agent-memory/INDEX.md`

- Keep the file short.
- Ensure each entry includes:
  - when to load the file;
  - required live tools, if any;
  - hard boundaries where the file must not be used.
- Avoid duplicating the full contents of reference files.

### `docs/developer/reference/chat-agent-runtime.md`

- Document the index-only default memory model.
- Link to this spec until the implementation is complete.

## Test Plan

### Unit Tests

Add or update tests in `src/server/chat/agent-memory.test.ts`:

- `INDEX.md` is the only instruction memory.
- Rendered memory metadata includes all reference file names.
- Rendered memory metadata stays within the configured budget.
- Missing memory files produce clear errors.
- Version IDs change when any memory file changes.

Add tests in `src/server/chat/agent-runtime.test.ts`:

- Tool-produced cards are not returned unless selected in `displayCardIds`.
- Unknown selected card IDs are rejected or dropped according to mode.
- Unselected itineraries are not returned.
- Source aggregation still includes all tool calls for validation.

Add tests in `src/server/chat/ask-siargao-agent.test.ts`:

- A surf request loads `SURF.md` before final answer.
- A breakfast request loads only the files it needs, or none if Google Places evidence is enough.
- A food turn that calls `search_local_guide` does not expose beach cards unless selected.
- Memory retrieval does not create source labels.

Add route tests in `src/app/api/chat/route.test.ts`:

- Dapa breakfast regression: restaurant card is returned, beach cards are not.
- Legacy plain-text compatibility returns no unselected artifacts.
- Public response does not expose checksums, vector-store IDs, or raw memory internals.

### Integration / Manual Tests

Run:

```sh
bun test src/server/chat/agent-memory.test.ts
bun test src/server/chat/agent-runtime.test.ts
bun test src/server/chat/ask-siargao-agent.test.ts
bun test src/app/api/chat/route.test.ts
bun run typecheck --incremental false
```

For a broader pass:

```sh
bun run lint
bun test
```

Manual chat checks:

- "i want to go surfing today, what are the best spots closest to me?"
- "can you tell me the best time to go to Pilar for the best waves?"
- "i'll go to dapa later, tell me some good places for breakfast"
- "plan a sandy beach half-day within 30 minutes from General Luna"

Expected result for the Dapa breakfast check: no beach cards unless the final payload explicitly
selects beach card IDs, which it should not for a breakfast-only answer.

## Migration Plan

### Phase 1: Artifact Selection Backstop

Implement `AgentFinalPayload` and selected artifact filtering while keeping legacy plain text
compatibility.

Acceptance criteria:

- Irrelevant tool cards are not returned by default.
- Existing source consistency tests still pass.
- Route responses remain backward-compatible for clients.

### Phase 2: Memory Catalog Rendering

Add Codex-style available-memory rendering and use it in prompt construction.

Acceptance criteria:

- `INDEX.md` is still the only default domain memory file.
- The model sees compact memory metadata.
- Tests prove no reference memory body is injected by default.

### Phase 3: Model-Directed Memory Enforcement

Add repair or validation when the model answers from a domain memory topic without loading the file
named by `INDEX.md`.

Acceptance criteria:

- Surf answers load `SURF.md`.
- Beach answers load `LOCAL_GUIDE_BEACHES.md`.
- Source-policy answers load `ASK_SIARGAO_SOURCE_POLICY.md`.
- Food answers are not forced to load beach or surf memory.

### Phase 4: Optional Explicit Mentions

Add `$SURF` or `memory://SURF.md` support if developer workflows need it.

Acceptance criteria:

- Explicit memory mentions resolve only to enabled memory files.
- Ambiguous or unknown mentions produce a warning or normal fallback.
- Explicit mentions do not create source labels.

## Acceptance Criteria

The implementation is complete when:

- The default prompt contains `INDEX.md` and compact memory metadata, but no full reference memory
  bodies.
- The model can load exact memory files with `load_agent_memory_file`.
- Public artifacts are returned only when selected by the final payload.
- The Dapa breakfast regression is covered by tests.
- Memory retrieval remains source-free.
- Deterministic code still validates source claims, privacy, and provider contracts.
- `/api/chat` does not contain request-specific prose branches. The agent runtime may return its
  shared evidence-bounded terminal fallback when no policy-valid model answer is available within
  budget.

# Chat Agent Runtime Reference

The `/api/chat` route delegates every valid chat response to the Ask Siargao agent runtime. The
route validates JSON and request shape, derives deterministic intent signals, calls
`runAskSiargaoAgentTurn`, validates returned source labels, and returns the model-written message
with structured tool and source metadata.

## Add A Backend Chat Tool

Add the tool in `src/server/chat/agent-tools.ts`.

1. Add the tool name to `AskSiargaoAgentToolName` in `src/server/chat/agent-runtime.ts`.
2. Define a strict Responses function tool in `registeredTools`.
3. Add a Zod schema for the arguments.
4. Implement the handler so it returns an `AgentToolResult`.
5. Add tests in `src/server/chat/agent-tools.test.ts`.
6. Add or update route/runtime tests only if the route contract or deterministic signals change.

Do not add a hardcoded final-answer branch to `/api/chat`. Deterministic code can classify,
validate, fetch, rank, and normalize data, but final prose belongs to the model.

## Local Itinerary Tool

`plan_local_itinerary` is a planning-evidence tool, not a final-answer renderer. Its handler lives
in `src/server/chat/agent-tools.ts` and delegates deterministic plan shaping to
`src/server/chat/itinerary-tools.ts`.

Supported initial themes are:

- `rainy_cloud_9_afternoon`;
- `sunset_plus_dinner`;
- `sandy_beach_half_day`;
- `non_surfer_half_day`;
- `food_crawl`.

The tool returns:

- `data.plan`, an `ItineraryPlan` with title, duration label, sequenced stops, fallback stops,
  skip guidance, and source summaries;
- `data.requiredToolChecks`, which names follow-up `get_weather_forecast` and `search_places`
  calls the model should make before final prose when the itinerary depends on weather or live
  place status;
- `sources`, so source-consistency validation can verify itinerary labels;
- `itineraries`, so `/api/chat` can return structured artifacts for the chat UI;
- optional prompt `actions` for weather and Places follow-up checks.

Use `plan_local_itinerary` first for 2-4 hour local itinerary requests. The model must still write
the final traveler-facing answer after it inspects the artifact and any required follow-up tool
results. Do not convert `renderLocalItineraryToolText` into public answer copy.

Weather-sensitive itineraries require a weather check through `get_weather_forecast`. Meal, cafe,
dinner, drinks, and food-crawl stops require `search_places` when live status, a map identity, or
open-now confidence matters. Provider failures should remain visible as provider-unavailable or
not-verified caveats instead of being rewritten as checked facts.

The current itinerary tool does not check surf, swell, tides, road flooding, closures, lifeguard
status, or provider-independent safety conditions. Keep those items in `notChecked` caveats unless
a future governed tool explicitly supplies them.

## Persistent Agent Memory

Agent memory lives in `docs/agent-memory/` and is wired into the chat runtime deliberately. Markdown
files are not treated as model memory unless the runtime loads or indexes them.

The current memory layers are:

- instruction Markdown: `ASK_SIARGAO_AGENT_SKILLS.md` and
  `ASK_SIARGAO_TOOL_USE_POLICY.md` are loaded by `loadAgentMemorySnapshot` and appended to every
  Responses `instructions` call, including tool-loop continuation calls with
  `previous_response_id`;
- vector-store `file_search`: reference files can be synced with
  `bun run agent-memory:sync`; when `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` is set, the chat runtime
  registers hosted `file_search` with that vector store;
- backend memory fallback: when no vector store ID is configured, the runtime registers
  `search_agent_memory`, a deterministic local search tool over reference-role Markdown files for
  local development and tests.

Every successful agent turn can include internal memory metadata: version ID, file IDs, roles,
checksums, byte lengths, and optional vector-store ID. Public `/api/chat` responses expose only the
memory version plus file IDs, names, and roles; vector-store IDs and checksums remain server/log
metadata. Model-facing prompt and `search_agent_memory` tool payloads also omit vector-store IDs,
checksums, relative paths, and byte lengths. Logs must not include raw memory document bodies.

To add or edit agent memory:

1. Edit the relevant file under `docs/agent-memory/`.
2. Keep instruction files short and stable; use reference files for larger data dictionary, source
   policy, and local assumption material.
3. Run `bun test src/server/chat/agent-memory.test.ts`.
4. Run `bun run agent-memory:sync -- --dry-run` to confirm the reference-file sync plan.
5. For deployed file search, run `bun run agent-memory:sync` with `OPENAI_API_KEY`, then configure
   the printed `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` as a server-only environment variable.

Normal chat requests never upload memory files. Uploads only happen through the sync script.

## Argument Validation

Tool arguments are validated by each Zod schema before handler code runs. Invalid arguments return a
structured tool error with `errorCode: "invalid_tool_arguments"` and no provider call. Keep schemas
strict with `additionalProperties: false` in the Responses tool definition and `.strict()` in Zod.

Prefer small, domain-specific tools over generic database access. If a future SQL-like tool is
needed, it must be read-only, allowlisted, row-limited, timeout-limited, and parsed before execution.

## Provider Failures

Provider failures should be returned as tool outputs, not route-level fallback prose. Use:

- `status: "error"`;
- `errorCode: "provider_unavailable"` when the provider or cache could not supply usable data;
- a short `text` summary safe for the model;
- a `provider_unavailable` source summary with explicit `notChecked` items.

Do not include raw restricted provider payloads, secrets, request headers, review text, bookings, or
availability data in tool results unless the source policy explicitly allows that field.

## Source Summaries

Every tool-backed claim should return `AnswerSourceSummary` entries:

- `live_checked` for successful live Google Places search/detail outputs;
- `fresh_cache` for fresh cached Google Places outputs;
- `weather_checked` for usable Open-Meteo forecast snapshots;
- `curated_local_guide` for curated Ask Siargao guide data;
- `provider_unavailable` for failed or fallback provider checks;
- `not_verified` for generic model reasoning with no matching tool evidence.

`src/server/chat/source-consistency.ts` validates structured `sources` and rendered `Checked:` /
`Not checked:` lines against actual audited tool calls. The route returns a controlled `502` if the
model produces source labels that are not backed by tool evidence.

`describe_source_policy` is descriptive policy metadata, not answer evidence. It should return the
label explanations in `data.policies` and `text`, with an empty `sources` array.

`file_search` and `search_agent_memory` are also policy/reference retrieval paths, not answer
evidence. They must not create `live_checked`, `fresh_cache`, `weather_checked`,
`curated_local_guide`, or `provider_unavailable` source summaries. Live/local factual claims still
need governed tools such as weather, Google Places, or the curated local guide.

## Observability

Runtime logs include request ID bindings, model, tool names, tool status, provider operation,
provider failure status, source labels, source profile IDs, durations, and upstream request IDs.
Logs must not include raw tool arguments, raw restricted provider payloads, provider response bodies,
secrets, review text, bookings, or availability data.

## Legacy Adapter Boundary

`src/server/llm/chat-adapter.ts` is a legacy direct Responses adapter used by older unit tests and
context-shaping helpers. Valid `/api/chat` responses use `runAskSiargaoAgentTurn` instead. Do not
add persistent-memory behavior to the legacy adapter unless a future cleanup plan decides to remove
or migrate that boundary.

## Out Of Scope

The current runtime does not include persistent long-term chat memory, unrestricted database access,
SQL tools, booking/table/room availability checks, review-text ingestion for chat answers,
surf/swell/tide integrations, road-closure feeds, or automatic repair-pass prompting after
source-consistency failures.

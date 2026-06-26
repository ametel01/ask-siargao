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

## Observability

Runtime logs include request ID bindings, model, tool names, tool status, provider operation,
provider failure status, source labels, source profile IDs, durations, and upstream request IDs.
Logs must not include raw tool arguments, raw restricted provider payloads, provider response bodies,
secrets, review text, bookings, or availability data.

## Out Of Scope

The current runtime does not include persistent long-term chat memory, unrestricted database access,
SQL tools, file-search memory, booking/table/room availability checks, review-text ingestion for
chat answers, surf/swell/tide integrations, road-closure feeds, or automatic repair-pass prompting
after source-consistency failures.

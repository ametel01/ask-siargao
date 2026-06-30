# 008 - Separate Public Tool Calls From Internal Tool Audits

Status: ready  
Priority: P1  
Effort: medium  
Risk: medium  
Depends on: plans 001 and 002 for a fully green final `bun test` run  
Category: security and data minimization  
Planned at: `2026-06-30` against `ccdd368`

> Executor instructions: follow this plan step by step. Run each verification command before
> handing off. If a STOP condition occurs, stop and report instead of expanding scope.
>
> Drift check, run first:
>
> ```sh
> git diff --stat ccdd368..HEAD -- src/server/chat/agent-runtime.ts src/app/api/chat/chat-route.ts src/server/chat/agent-tools.ts src/server/chat/source-consistency.ts src/server/chat/agent-runtime.test.ts src/app/api/chat/route.test.ts src/server/chat/agent-tools.test.ts
> ```
>
> If any in-scope file changed since this plan was written, compare the current code to the
> excerpts below before editing.

## Goal

Stop returning internal tool audit fields in the public `/api/chat` response. The route should keep
rich internal audit objects for source validation and server-side diagnostics, but the browser
response and persisted chat history should receive an explicit minimal public DTO with no raw tool
arguments and no raw `resultText`.

## Why This Matters

`AgentToolCallAudit` currently contains raw tool arguments and `resultText`. The chat route returns
`publicToolCalls` directly, and the current redaction only replaces exact browser geolocation
centers for one Places path. Provider error messages from Google Places can be copied into
`resultText`, so backend/provider details can reach the browser even though logs and stored history
already use summaries.

## Current Evidence

`src/server/chat/agent-runtime.ts:41-55` defines one audit type with both internal and public-looking
fields:

```ts
export type AgentToolCallAudit = {
  id: string;
  toolCallId?: string;
  name: string;
  arguments: Record<string, unknown>;
  status: AgentToolCallStatus;
  durationMs: number;
  startedAt: string;
  completedAt: string;
  resultText?: string;
  errorCode?: string;
  providerOperation?: string;
  sourceProfileIds: readonly string[];
  sources: readonly AnswerSourceSummary[];
};
```

`src/server/chat/agent-runtime.ts:289-322` stores raw tool output text on every audit:

```ts
...(result.text ? { resultText: result.text } : {}),
```

`src/app/api/chat/chat-route.ts:271-274` builds `publicToolCalls`, and
`src/app/api/chat/chat-route.ts:372` returns them in the response:

```ts
const publicToolCalls = redactToolCallsForPublicResponse(result.toolCalls, clientContext.geolocation);
...
toolCalls: publicToolCalls,
```

`src/app/api/chat/chat-route.ts:867-893` only redacts a matching `search_places.arguments.center`.
All other arguments and `resultText` stay in the returned objects.

`src/server/chat/agent-tools.ts:1213-1223` and `:1340-1350` include provider error messages in
tool output text:

```ts
text:
  error instanceof Error
    ? `Google Places search failed: ${error.message}`
    : "Google Places search failed.",
```

Existing route storage already uses a safer pattern at `src/app/api/chat/chat-route.ts:817-830`:
it persists id, name, status, error code, provider operation, source ids, sources, timestamps, and
duration, but not arguments or result text.

## Commands You Will Need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Search | `rg -n "resultText|redactToolCallsForPublicResponse|toolCalls:" src/server/chat src/app/api/chat` | Shows only expected references |
| Targeted route tests | `bun test src/app/api/chat/route.test.ts` | All tests in the file pass once plans 001/002 are resolved if they affect the file |
| Runtime tests | `bun test src/server/chat/agent-runtime.test.ts` | All tests pass |
| Tool tests | `bun test src/server/chat/agent-tools.test.ts` | All tests pass |
| Lint | `bun run lint` | Exit 0 |
| Typecheck | `bun run typecheck --incremental false` | Exit 0, no errors |
| Full unit baseline | `bun test` | Exit 0 after plans 001 and 002 land |

## Scope

In scope:

- `src/server/chat/agent-runtime.ts`
- `src/app/api/chat/chat-route.ts`
- `src/server/chat/agent-tools.ts`
- `src/server/chat/source-consistency.ts` only if the type split requires it
- `src/server/chat/agent-runtime.test.ts`
- `src/app/api/chat/route.test.ts`
- `src/server/chat/agent-tools.test.ts`

Out of scope:

- Changing provider field masks or Google Places retention policy.
- Changing source-summary rendering or final answer copy except for provider failure text.
- Reworking chat history schema.
- Removing internal audit fields needed by source consistency validation.
- Fixing the existing unrelated test baseline from plans 001 and 002.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/008-public-tool-call-dto
   ```

2. Add an explicit public type near `AgentToolCallAudit`.

   Suggested shape:

   ```ts
   export type PublicAgentToolCall = {
     id: string;
     toolCallId?: string;
     name: string;
     status: AgentToolCallStatus;
     durationMs: number;
     errorCode?: string;
     providerOperation?: string;
     sourceProfileIds: readonly string[];
     sources: readonly AnswerSourceSummary[];
   };
   ```

   Do not include `arguments`, `resultText`, raw `data`, or provider exception messages.

   Verify:

   ```sh
   bun run typecheck --incremental false
   ```

   Expected: either passes or reports only type sites that still need to accept the new public type.

3. Replace `redactToolCallsForPublicResponse()` with a mapper that returns
   `readonly PublicAgentToolCall[]`.

   Keep `AgentToolCallAudit[]` for `assertChatAnswerSourceConsistency()`, because
   `src/server/chat/source-consistency.ts:314-388` uses internal arguments and source summaries to
   verify checked claims. Do not feed the public DTO into validation if that weakens validation.

   The public mapper should copy only the approved public fields. Browser geolocation redaction
   becomes unnecessary for the public response because no arguments are returned.

   Verify:

   ```sh
   rg -n "function redactToolCallsForPublicResponse|arguments:|resultText" src/app/api/chat/chat-route.ts
   ```

   Expected: no public-response mapper returns `arguments` or `resultText`.

4. Update chat route types and helper signatures.

   - `summarizeToolCallForLogs()` can accept `PublicAgentToolCall` or a narrower structural type.
   - `summarizeToolCallsForStoredHistory()` can continue to accept `PublicAgentToolCall[]` if the
     public DTO contains every stored field.
   - `isProviderFailureToolCall()` should accept the public DTO if it only needs status, error code,
     and source labels.
   - `sourceValidationInput.toolCalls` should use internal audits or a separate internal redacted
     validation list, not the public DTO.

   Verify:

   ```sh
   bun run typecheck --incremental false
   ```

   Expected: exit 0.

5. Normalize provider failure text in Google Places tool outputs.

   In `src/server/chat/agent-tools.ts`, change the two Google Places catch blocks so
   `result.text` is stable and non-exceptional, for example:

   ```ts
   text: "Google Places search failed.",
   errorCode: "provider_unavailable",
   ```

   and:

   ```ts
   text: "Google Places details lookup failed.",
   errorCode: "provider_unavailable",
   ```

   Do not add raw `error.message` to logs unless it passes the repo's existing redaction rules and a
   test proves sensitive substrings are excluded from public responses.

   Verify:

   ```sh
   rg -n "Google Places .*failed: \\$\\{error\\.message\\}|resultText" src/server/chat/agent-tools.ts src/app/api/chat/chat-route.ts
   ```

   Expected: no match for provider error interpolation in Places tool text; no route public mapper
   returning `resultText`.

6. Add regression tests.

   In `src/app/api/chat/route.test.ts`, add a test using `chatDependencies({ toolCalls: [...] })`
   or the local `toolCall()` helper. The tool call should contain:

   - a distinctive raw argument such as `"secret cafe query fixture"`;
   - a raw center coordinate;
   - `resultText` containing a distinctive provider failure phrase.

   Assert that:

   - `body.toolCalls[0]` has name, status, duration/source fields;
   - serialized `body.toolCalls` does not contain `arguments`;
   - serialized `body.toolCalls` does not contain `resultText`;
   - serialized full response does not contain the distinctive raw argument or failure phrase.

   In `src/server/chat/agent-tools.test.ts`, add or update tests proving Places provider failures
   return `status: "error"`, `errorCode: "provider_unavailable"`, and stable text without the thrown
   error message.

   Verify:

   ```sh
   bun test src/app/api/chat/route.test.ts
   bun test src/server/chat/agent-tools.test.ts
   ```

   Expected: new regression tests fail before the implementation and pass after it.

## Test Plan

- Route response regression in `src/app/api/chat/route.test.ts`: public `toolCalls` omits raw
  `arguments` and `resultText`.
- Stored history regression in the existing authenticated persistence test: confirm stored
  `tool_calls_json` still omits raw user query and coordinates.
- Provider failure regression in `src/server/chat/agent-tools.test.ts`: thrown provider messages are
  not included in returned tool text.
- Type-level regression: `bun run typecheck --incremental false` should prevent passing public DTOs
  into code that expects internal audit fields.

## Done Criteria

- Public `/api/chat` JSON never includes tool `arguments` or `resultText`.
- Source consistency validation still uses enough internal evidence to enforce checked-source claims.
- Stored chat history remains summarized and does not gain raw arguments or result text.
- Google Places provider exception messages are not copied into tool output text.
- Targeted tests, lint, and typecheck pass.
- `bun test` passes after plans 001 and 002 restore the known baseline.
- `plans/README.md` status row is updated.

## STOP Conditions

Stop and report if:

- A frontend component or API client demonstrably depends on raw `toolCalls.arguments`.
- Source consistency validation cannot be preserved without exposing public arguments.
- A failing test requires changing response shape outside `toolCalls`.
- The fix requires schema migrations or chat history backfills.

## Maintenance Notes

Reviewers should treat `AgentToolCallAudit` as internal-only after this lands. Any future public
chat response field should be added to `PublicAgentToolCall` deliberately, with a route test proving
that raw arguments, provider payloads, and raw provider errors stay server-side.

Suggested commit:

```text
Separate public tool calls from audits
```

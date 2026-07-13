# Plan 016: Normalize model-visible agent tool failure text

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report; do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8775d60..HEAD -- src/server/chat/agent-tools.ts src/server/chat/agent-tools.test.ts`
> If either file changed since this plan was written, compare the "Current state" excerpts against
> the live code before proceeding; on mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8775d60`, 2026-07-08
- **Issue**: https://github.com/ametel01/ask-siargao/issues/93

## Why this matters

Agent tool results are sent back into the model loop. Some provider failure paths already return
stable unavailable text, but the generic wrapper and standalone weather, marine, and tide tools
still include `error.message` in `AgentToolResult.text`. Provider exceptions often contain status
details, request parameters, credential-shaped fragments, or infrastructure details. If that text is
sent to the model, logged in tool audits, or repeated in final prose, it bypasses the stricter
provider-failure handling that already exists for Google Places and web research.

This is separate from plan 012. Plan 012 hardens shared diagnostics redaction after text is already
captured. This plan prevents raw exception text from becoming model-visible tool output in the first
place.

## Current state

The generic tool executor returns raw exception messages for any tool that does not catch its own
errors:

```ts
// src/server/chat/agent-tools.ts:1379-1388
try {
  return await tool.execute(parsed.data, request, dependencies);
} catch (error) {
  return {
    name: request.name,
    status: "error",
    text:
      error instanceof Error ? error.message : `${request.name} failed with an unknown error.`,
    errorCode: "tool_execution_failed",
    sources: [],
  };
}
```

Google Places already has the intended public behavior:

```ts
// src/server/chat/agent-tools.test.ts:1767-1789
test("returns provider-unavailable output for Places search failures", async () => {
  // provider throws "Google Places chat lookup failed: PERMISSION_DENIED"
  expect(result.text).toBe("Google Places search is temporarily unavailable.");
  expect(result.text).not.toContain("PERMISSION_DENIED");
});
```

Web research also sanitizes provider failure metadata before returning it:

```ts
// src/server/chat/agent-tools.ts:2993-3008
function summarizeWebResearchProviderFailure(error: unknown): Record<string, unknown> {
  // ...
  ...(message ? { message: sanitizeProviderFailureText(message) } : {}),
}
```

The standalone weather, marine, and tide tools still interpolate raw provider exception messages:

```ts
// src/server/chat/agent-tools.ts:3157-3167
text:
  error instanceof Error
    ? `Open-Meteo weather forecast lookup failed: ${error.message}`
    : "Open-Meteo weather forecast lookup failed.",
```

```ts
// src/server/chat/agent-tools.ts:3185-3195
text:
  error instanceof Error
    ? `Open-Meteo Marine conditions lookup failed: ${error.message}`
    : "Open-Meteo Marine conditions lookup failed.",
```

```ts
// src/server/chat/agent-tools.ts:3213-3223
text:
  error instanceof Error
    ? `Tide-Forecast tide lookup failed: ${error.message}`
    : "Tide-Forecast tide lookup failed.",
```

The weather test currently locks in the raw status detail:

```ts
// src/server/chat/agent-tools.test.ts:2845-2862
test("returns provider-unavailable output for weather provider failures", async () => {
  // provider throws "Open-Meteo forecast request failed with HTTP 503."
  expect(result.text).toContain("HTTP 503");
});
```

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Targeted tests | `bun test src/server/chat/agent-tools.test.ts` | exit 0, all targeted tests pass |
| Chat route contract check | `bun test src/app/api/chat/route.test.ts src/server/chat/agent-runtime.test.ts` | exit 0, route and runtime public DTO tests pass |
| Lint | `bun run lint` | exit 0, Biome reports no fixes applied |
| Typecheck | `bun run typecheck --incremental false` | exit 0, no TypeScript errors |
| Full tests | `bun test` | exit 0, all Bun tests pass |

## Scope

**In scope**:

- `src/server/chat/agent-tools.ts`
- `src/server/chat/agent-tools.test.ts`
- Optional only if needed for public DTO regression coverage:
  `src/app/api/chat/route.test.ts` or `src/server/chat/agent-runtime.test.ts`

**Out of scope**:

- Changing tool schemas or adding new tools.
- Changing source labels, source consistency policy, or final-answer repair behavior.
- Replacing provider-side exceptions or fetch clients.
- Reproducing real credential values in tests, fixtures, logs, plans, issues, or comments.

## Git workflow

- Branch: `advisor/016-normalize-agent-tool-failures`
- Commit message style: short imperative, for example `Normalize agent tool failure text`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add failing coverage for model-visible raw exception text

In `src/server/chat/agent-tools.test.ts`, add focused tests that prove raw thrown text no longer
appears in model-visible `result.text`.

Cover these cases:

- A generic wrapper path where a tool throws outside its own catch block. A local-data dependency
  failure is a good fixture if it reaches the generic `executeAgentTool()` catch.
- `get_weather_forecast` provider failure.
- `get_marine_conditions` provider failure.
- `get_tide_forecast` provider failure.

Use fake sensitive-looking fixture fragments only, such as `token=fixture_should_not_render`,
`Bearer fixture_should_not_render_12345`, or `api_key=fixture_should_not_render`. Do not use copied
real credentials or realistic production secrets.

Assertions:

- `result.status` remains `"error"`.
- `result.errorCode` remains the correct existing code, usually `"provider_unavailable"` or
  `"tool_execution_failed"`.
- `result.text` contains stable user/model-usable unavailable text.
- `result.text` does not contain the unique fixture suffix, bearer fragment, raw status phrase, or
  provider-specific internal message.

**Verify**:
`bun test src/server/chat/agent-tools.test.ts` should fail before implementation and pass after
implementation.

### Step 2: Centralize safe failure rendering for tool outputs

In `src/server/chat/agent-tools.ts`, add a small helper for model-visible failure text. Keep it
boring and local to agent tools unless a clearer existing helper emerges while implementing.

Suggested behavior:

- Generic wrapper errors return a stable string such as
  `${request.name} failed before it could return safe data.`
- Weather, marine, and tide provider failures return stable provider-unavailable text without
  appending `error.message`.
- If you preserve sanitized operational details anywhere, keep them in `logData` and pass them
  through `sanitizeProviderFailureText()` or the stronger redactor from plan 012 if that plan has
  already landed.

Do not remove the existing Google Places or web research provider-unavailable behavior. Those paths
are the behavior exemplar.

**Verify**:
`bun test src/server/chat/agent-tools.test.ts` exits 0.

### Step 3: Preserve public route and runtime DTO boundaries

Run the chat route/runtime tests to make sure public tool calls still omit raw tool arguments and
raw result text. This plan should not change public DTO shape; it only makes internal/model-facing
tool result text safer.

**Verify**:
`bun test src/app/api/chat/route.test.ts src/server/chat/agent-runtime.test.ts` exits 0.

## Test plan

- Add agent-tool tests that fail on raw thrown text appearing in `AgentToolResult.text`.
- Update the existing weather failure test so it no longer expects `HTTP 503`.
- Add marine and tide failure tests if no focused provider-failure tests already exist.
- Preserve existing Google Places and web research provider-unavailable tests.

## Done criteria

- [ ] Generic tool execution failures no longer return raw `error.message` in `result.text`.
- [ ] Weather, marine, and tide provider failures return stable unavailable text.
- [ ] Raw fake token, bearer, key-value, and internal status fragments do not appear in model-visible
      tool output.
- [ ] Existing Google Places and web research provider-unavailable behavior still passes.
- [ ] `bun test src/server/chat/agent-tools.test.ts` exits 0.
- [ ] `bun test src/app/api/chat/route.test.ts src/server/chat/agent-runtime.test.ts` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run typecheck --incremental false` exits 0.
- [ ] `bun test` exits 0.

## STOP conditions

Stop and report back if:

- The current code no longer has the raw `error.message` behavior shown above.
- A test fixture, log output, or plan update contains a real credential value.
- Fixing the issue requires changing tool schemas, source labels, or final-answer policy.
- The executor finds a broader public route error-response problem and tries to fold it into this
  plan. Use plan 017 for public API response hygiene instead.

## Maintenance notes

Provider exception text belongs in sanitized diagnostics, not model-visible tool output. When adding
future tools, test both the success path and the provider-failure path for stable result text before
allowing the tool to participate in the agent loop.

# Plan 012: Expand diagnostics redaction for provider token strings

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report; do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8775d60..HEAD -- src/server/admin/redaction.ts src/server/admin/diagnostics.test.ts src/server/security/security.test.ts src/server/chat/agent-tools.ts src/server/chat/agent-tools.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts
> against the live code before proceeding; on mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8775d60`, 2026-07-08
- **Issue**: https://github.com/ametel01/ask-siargao/issues/85

## Why this matters

Admin diagnostics and telemetry use `redactDiagnosticValue()` as the common redaction path for
diagnostic payloads. That redactor catches sensitive keys and underscore-style test fixtures, but
it does not catch common hyphenated provider token strings in free text. A provider exception,
operator note, or diagnostic message containing a hyphenated API token could be logged or rendered
after "redaction" succeeds. Keep the fix defensive and pattern-based; do not add or print any real
secret values.

## Current state

- `src/server/admin/redaction.ts` owns the shared diagnostic redactor used by admin diagnostics and
  telemetry.
- `src/server/admin/diagnostics.ts` applies the redactor to blocked audits, job diagnostics,
  drilldown tool calls, and diagnostic log events.
- `src/server/security/privacy.ts` reuses the same redactor for telemetry.
- `src/server/chat/agent-tools.ts` already has a stronger provider-failure text sanitizer that can
  be used as a local behavior exemplar.

Relevant excerpts:

```ts
// src/server/admin/redaction.ts:1-3
const sensitiveKeyPattern = /secret|token|password|api[_-]?key|rawpayload|rawevent|authorization/i;
const secretStringPattern = /(sk|rk|pk|whsec|sess|pi|cs)_(test|live)?_[A-Za-z0-9_]+/g;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
```

```ts
// src/server/admin/redaction.ts:24-27
function redactString(value: string) {
  return value
    .replace(emailPattern, "[redacted-email]")
    .replace(secretStringPattern, "[redacted-secret]");
}
```

```ts
// src/server/chat/agent-tools.ts:3018-3023
function sanitizeProviderFailureText(value: string) {
  return value
    .replaceAll(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "sk-[redacted]")
    .replaceAll(/\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi, "Bearer [redacted]")
    .replaceAll(/\b(api[_-]?key|token|secret)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[redacted]")
    .slice(0, 500);
}
```

Existing test coverage proves only the underscore-style fixture path:

```ts
// src/server/admin/diagnostics.test.ts:49-62
test("redacts secrets, emails, and raw payloads from traces", () => {
  const redacted = redactDiagnosticValue({
    email: "traveler@example.com",
    apiKey: "sk_test_should_not_render",
    nested: {
      rawPayload: { token: "whsec_test_should_not_render" },
      message: "sent to traveler@example.com with sk_test_should_not_render",
    },
  });
```

Repo conventions to match:

- Keep redaction helper tests in `src/server/admin/diagnostics.test.ts` and telemetry tests in
  `src/server/security/security.test.ts`.
- Use Bun's colocated test style with `describe`, `test`, and `expect`.
- Do not log or commit any real credential value. Use obvious fake fixtures only.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Targeted tests | `bun test src/server/admin/diagnostics.test.ts src/server/security/security.test.ts src/server/chat/agent-tools.test.ts` | exit 0, all targeted tests pass |
| Lint | `bun run lint` | exit 0, Biome reports no fixes applied |
| Typecheck | `bun run typecheck --incremental false` | exit 0, no TypeScript errors |
| Full tests | `bun test` | exit 0, all Bun tests pass |

## Scope

**In scope**:

- `src/server/admin/redaction.ts`
- `src/server/admin/diagnostics.test.ts`
- `src/server/security/security.test.ts`
- Optional only if deduplicating logic is clearly cleaner: `src/server/chat/agent-tools.ts` and
  `src/server/chat/agent-tools.test.ts`

**Out of scope**:

- Changing admin access policy.
- Changing telemetry event names or payload shapes.
- Adding new observability sinks.
- Reproducing real credential values in tests, fixtures, logs, plans, issues, or comments.

## Git workflow

- Branch: `advisor/012-expand-diagnostics-redaction`
- Commit message style: short imperative, for example `Expand diagnostics token redaction`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add failing coverage for hyphenated and key-value secret strings

In `src/server/admin/diagnostics.test.ts`, extend the redaction test or add a focused test that
passes fake free-text values shaped like:

- a hyphenated provider key placeholder with at least 12 safe fixture characters after the prefix;
- a `Bearer ...` header-style placeholder;
- a `token=...`, `secret: ...`, or `api_key=...` free-text fragment.

Assert that the serialized redacted output does not contain the unique fixture suffixes and does
contain the redaction marker. Do not use a real key or a realistic copied token.

Add a telemetry-facing assertion in `src/server/security/security.test.ts` so
`trackServerEvent()` is covered through the shared `sanitizeForTelemetry()` path.

**Verify**:
`bun test src/server/admin/diagnostics.test.ts src/server/security/security.test.ts` should fail
before implementation and pass after implementation.

### Step 2: Expand the shared redaction patterns

Update `src/server/admin/redaction.ts` so `redactString()` catches:

- the existing underscore-style secret fixtures;
- hyphenated provider-token placeholders such as `sk-...`;
- `Bearer ...` token fragments;
- free-text key-value fragments for `api_key`, `apikey`, `api-key`, `token`, and `secret`.

Keep the replacement generic, such as `[redacted-secret]`, and avoid returning partial token
prefixes from the shared diagnostics redactor.

If you decide to deduplicate with `sanitizeProviderFailureText()`, extract a tiny shared helper
only if it keeps both call sites clearer. Do not broaden this plan into a logging refactor.

**Verify**:
`bun test src/server/admin/diagnostics.test.ts src/server/security/security.test.ts` exits 0.

### Step 3: Preserve existing chat provider sanitization behavior

If `src/server/chat/agent-tools.ts` was touched, run its existing sanitizer regression coverage and
ensure it still redacts provider failure messages without changing the public tool result shape.

**Verify**:
`bun test src/server/chat/agent-tools.test.ts` exits 0.

## Test plan

- Add or extend admin redaction tests for hyphenated token placeholders, bearer fragments, and
  free-text key-value fragments.
- Add telemetry coverage through `trackServerEvent()` so the shared redactor is tested through the
  production telemetry path.
- Preserve the existing provider failure sanitizer test that asserts chat tool diagnostics do not
  contain provider key fixture suffixes.

## Done criteria

- [ ] `redactDiagnosticValue()` redacts hyphenated provider-token placeholders in free text.
- [ ] `redactDiagnosticValue()` redacts bearer and key-value token fragments in free text.
- [ ] Existing email and sensitive-key redaction still passes.
- [ ] No real secret value appears in tests or code.
- [ ] `bun test src/server/admin/diagnostics.test.ts src/server/security/security.test.ts src/server/chat/agent-tools.test.ts` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run typecheck --incremental false` exits 0.
- [ ] `bun test` exits 0.

## STOP conditions

Stop and report back if:

- A test fixture or log output contains a real credential value.
- The fix requires changing telemetry event schemas or admin UI behavior.
- The current code no longer matches the excerpts above.

## Maintenance notes

Provider-specific sanitizers are useful close to provider boundaries, but the shared diagnostics
redactor is the last line of defense for admin and telemetry payloads. Review future provider
integrations for new token formats and add shared redaction tests before logging diagnostic text.

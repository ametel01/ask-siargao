# Plan 014: Return stable JSON errors for malformed intake requests

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/app/api/audit/intake/route.ts src/app/api/audit/checkout/route.ts src/server/audit/intake.test.ts src/server/payments/stripe-lifecycle.test.ts plans/002-server-side-checkout-eligibility.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: `plans/002-server-side-checkout-eligibility.md`
- **Category**: bug
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The intake API has a stable schema-error response for valid JSON that fails validation, but malformed JSON throws before the schema code runs. That can produce an unstructured framework error instead of the same predictable 400 JSON shape used by normal validation failures. This matters for the first user-facing API boundary on the landing page and for agents/tests that need stable error contracts.

Checkout malformed-JSON handling is already named in plan 002. This plan depends on plan 002 and should not duplicate its checkout route work; it should complete the same boundary for intake and optionally share a helper if plan 002 introduced one.

## Current State

- `src/app/api/audit/intake/route.ts` parses JSON before calling `intakeInputSchema.safeParse`.
- `src/app/api/audit/checkout/route.ts` has the same raw `request.json()` pattern, but checkout is already covered by plan 002.
- `src/server/audit/intake.test.ts` tests service-level intake behavior, not route-level malformed requests.

Relevant excerpts:

```ts
// src/app/api/audit/intake/route.ts:13
const body: unknown = await request.json();
const parsed = intakeInputSchema.safeParse(body);
```

```ts
// src/app/api/audit/intake/route.ts:17
return Response.json(
  {
    error: "invalid_intake",
    issues: parsed.error.issues.map((issue) => ({
```

```ts
// src/app/api/audit/checkout/route.ts:22
const body: unknown = await request.json();
const parsed = checkoutRequestSchema.safeParse(body);
```

Repo conventions:

- API routes return `Response.json(...)` with stable error codes such as `invalid_intake`, `invalid_checkout_request`, and `checkout_not_available`.
- Tests use direct function calls and synthetic `Request` objects where route behavior needs verification.
- Plan 002 may create route-level checkout tests; reuse that pattern after it lands.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/app/api/audit/intake/route.test.ts` | exit 0 |
| Existing intake tests | `bun test src/server/audit/intake.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/app/api/audit/intake/route.ts`
- `src/app/api/audit/intake/route.test.ts` (create)
- A small shared JSON request helper only if plan 002 already introduced one or if creating one keeps the intake route simpler

**Out of scope**:

- Checkout eligibility, payment, or Stripe behavior; plan 002 owns checkout route changes.
- Changing intake schema rules.
- Changing the landing form UI.
- Adding a global error middleware.
- Changing rate-limit behavior.

## Git Workflow

- Branch: `advisor/014-stable-intake-json-errors`
- Commit message style: `fix: return stable intake json errors`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Confirm plan 002 state

Check whether plan 002 has already created a shared JSON parsing helper or route-test pattern.

- If a helper exists, use it for intake.
- If checkout now handles malformed JSON inline and no helper exists, keep this plan scoped to intake and do not refactor checkout.
- If plan 002 has not landed, stop and ask whether to execute plan 002 first; this plan depends on that route contract cleanup.

**Verify**: `git diff --stat 43b43ca..HEAD -- src/app/api/audit/checkout/route.ts src/app/api/audit/checkout/route.test.ts` -> inspect output and continue only if checkout work is landed or intentionally deferred by the operator.

### Step 2: Add route-level intake tests

Create `src/app/api/audit/intake/route.test.ts`. Import `POST` from `src/app/api/audit/intake/route.ts` and call it with synthetic `Request` objects.

Cover:

- malformed JSON body returns status 400
- malformed JSON response body contains `error: "invalid_json"` or another stable code chosen in this step
- schema-invalid valid JSON still returns `error: "invalid_intake"`
- valid minimal intake still returns status 200 and a complete response

Recommended malformed request shape:

```ts
new Request("https://siargao.test/api/audit/intake", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{",
});
```

**Verify**: `bun test src/app/api/audit/intake/route.test.ts` -> fails until implementation is added.

### Step 3: Catch JSON parse failures in the intake route

In `src/app/api/audit/intake/route.ts`, wrap `request.json()` so malformed JSON returns a stable 400 response before schema validation.

Acceptable implementation:

```ts
let body: unknown;
try {
  body = await request.json();
} catch {
  return Response.json(
    { error: "invalid_json", message: "Request body must be valid JSON." },
    { status: 400, headers: rateLimit.headers },
  );
}
```

Keep existing behavior for schema failures and successful intake. Preserve rate-limit behavior: rate limiting should still happen before parsing, and the malformed JSON response should include rate-limit headers if practical.

**Verify**: `bun test src/app/api/audit/intake/route.test.ts` -> exit 0.

### Step 4: Run intake and full gates

**Verify**:

- `bun test src/server/audit/intake.test.ts src/app/api/audit/intake/route.test.ts` -> exit 0
- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Create route-level tests in `src/app/api/audit/intake/route.test.ts` for malformed JSON, schema-invalid JSON, and valid JSON. If plan 002 created checkout route tests, use those as the structural pattern; otherwise use `src/server/audit/intake.test.ts` for fixture values and call the route directly.

## Done Criteria

- [ ] Malformed intake JSON returns HTTP 400 with a stable JSON error code.
- [ ] Valid JSON that fails `intakeInputSchema` still returns `invalid_intake` with issues.
- [ ] Valid minimal intake still succeeds.
- [ ] Checkout route behavior from plan 002 is not regressed or duplicated.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Plan 002 has not landed and the operator has not approved doing this out of order.
- A global API error strategy already exists and conflicts with local route handling.
- Fixing this requires changing the intake schema or frontend form behavior.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

New API routes should not call `request.json()` without a stable parse-error path. Reviewers should check that route-level tests cover malformed JSON, not only schema-invalid JSON.

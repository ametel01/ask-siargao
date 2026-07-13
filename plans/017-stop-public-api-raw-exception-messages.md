# Plan 017: Stop returning raw exception messages from public API errors

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report; do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8775d60..HEAD -- src/app/api/stripe/webhook/route.ts src/app/api/stripe/webhook/webhook-route.ts src/app/api/clerk/webhooks/clerk-webhook-route.ts src/app/api/audit/checkout/checkout-route.ts src/app/api/trips/trip-routes.ts src/app/api/stripe/webhook/route.test.ts src/app/api/clerk/webhooks/route.test.ts src/app/api/audit/checkout/route.test.ts src/app/api/trips/route.test.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts
> against the live code before proceeding; on mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8775d60`, 2026-07-08
- **Issue**: https://github.com/ametel01/ask-siargao/issues/94

## Why this matters

Several externally reachable API catch blocks serialize `error.message` into JSON responses. That
creates an avoidable information disclosure path for database errors, provider SDK errors, webhook
verification details, and local lifecycle assertions. The app already follows a better pattern in
`/api/chat`: classify the failure internally, log the real error server-side, and return a stable
client-facing message.

This plan is about response hygiene only. It does not weaken webhook verification, checkout gating,
shared-trip authorization, route classification, rate limits, or server-side logging.

## Current state

The Stripe webhook Next route returns raw verification errors:

```ts
// src/app/api/stripe/webhook/route.ts:26-33
} catch (error) {
  return Response.json(
    {
      error: "invalid_stripe_webhook",
      message: error instanceof Error ? error.message : "Webhook verification failed.",
    },
    { status: 400 },
  );
}
```

The injectable Stripe webhook helper has the same pattern:

```ts
// src/app/api/stripe/webhook/webhook-route.ts:74-81
} catch (error) {
  return Response.json(
    {
      error: "invalid_stripe_webhook",
      message: error instanceof Error ? error.message : "Webhook verification failed.",
    },
    { status: 400 },
  );
}
```

The Clerk webhook helper exposes both verification and sync exception messages, and tests assert
that behavior:

```ts
// src/app/api/clerk/webhooks/clerk-webhook-route.ts:23-31
} catch (error) {
  return Response.json(
    {
      error: "invalid_clerk_webhook",
      message: error instanceof Error ? error.message : "Webhook verification failed.",
    },
    { status: 400 },
  );
}
```

```ts
// src/app/api/clerk/webhooks/clerk-webhook-route.ts:42-49
} catch (error) {
  return Response.json(
    {
      error: "clerk_user_sync_failed",
      message: error instanceof Error ? error.message : "Failed to sync Clerk user.",
    },
    { status: 500 },
  );
}
```

The checkout and shared-trip routes do the same for ordinary public workflow errors:

```ts
// src/app/api/audit/checkout/checkout-route.ts:61-68
} catch (error) {
  return Response.json(
    {
      error: "checkout_not_available",
      message: error instanceof Error ? error.message : "Checkout could not be started.",
    },
    { status: 409 },
  );
}
```

```ts
// src/app/api/trips/trip-routes.ts:234-241
} catch (error) {
  return Response.json(
    {
      error: "shared_trip_not_available",
      message: error instanceof Error ? error.message : "Shared trip could not be created.",
    },
    { status: 409, headers },
  );
}
```

The chat route is the behavior exemplar:

```ts
// src/app/api/chat/chat-route.ts:365-374
return Response.json(
  {
    error: errorCode,
    message: missingConfiguration
      ? "Ask Siargao is missing required provider configuration."
      : sourceConsistencyFailure
        ? "Ask Siargao could not verify the answer sources."
        : "Ask Siargao could not generate a response right now.",
  },
  { status, headers },
);
```

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Targeted API tests | `bun test src/app/api/stripe/webhook/route.test.ts src/app/api/clerk/webhooks/route.test.ts src/app/api/audit/checkout/route.test.ts src/app/api/trips/route.test.ts` | exit 0, all targeted tests pass |
| Route policy guard | `bun test src/server/auth/clerk-route-policy.test.ts` | exit 0, API route policy tests still pass |
| Lint | `bun run lint` | exit 0, Biome reports no fixes applied |
| Typecheck | `bun run typecheck --incremental false` | exit 0, no TypeScript errors |
| Full tests | `bun test` | exit 0, all Bun tests pass |

## Scope

**In scope**:

- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/stripe/webhook/webhook-route.ts`
- `src/app/api/clerk/webhooks/clerk-webhook-route.ts`
- `src/app/api/audit/checkout/checkout-route.ts`
- `src/app/api/trips/trip-routes.ts`
- Their route tests listed in the drift check.
- Optional small helper if it keeps response construction consistent.

**Out of scope**:

- Changing successful response bodies.
- Changing HTTP status codes unless a current code is plainly wrong.
- Changing webhook verification, checkout lifecycle, saved-trip authorization, or route policy.
- Removing server-side error logging or observability.
- Reproducing real credential values in tests, fixtures, logs, plans, issues, or comments.

## Git workflow

- Branch: `advisor/017-safe-api-error-responses`
- Commit message style: short imperative, for example `Normalize public API error messages`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Add failing response-hygiene coverage

Update or add tests so public JSON responses do not include raw fake internal exception text.

Cover at least:

- Clerk invalid webhook verification throws `No matching svix signature with token=fixture_should_not_render`.
- Clerk user sync throws `database unavailable at host=fixture_should_not_render`.
- Stripe webhook verification or application throws a fake internal phrase and the response omits it.
- Checkout lifecycle throws a fake internal phrase and the response omits it.
- Shared-trip creation throws a fake internal phrase and the response omits it.

Keep existing assertions for `error` codes and statuses. Change only message expectations from raw
exception text to stable client-facing text.

**Verify**:
`bun test src/app/api/stripe/webhook/route.test.ts src/app/api/clerk/webhooks/route.test.ts src/app/api/audit/checkout/route.test.ts src/app/api/trips/route.test.ts` should fail before implementation and pass after implementation.

### Step 2: Return stable messages from public catch blocks

Replace `message: error instanceof Error ? error.message : ...` in the in-scope route catch blocks
with stable strings. Suggested messages:

- Stripe invalid webhook: `"Webhook verification failed."`
- Clerk invalid webhook: `"Webhook verification failed."`
- Clerk sync failure: `"Failed to sync Clerk user."`
- Checkout unavailable: `"Checkout could not be started."`
- Shared trip unavailable: `"Shared trip could not be created."`

If you add a helper, keep it small and local to API response hygiene. Do not refactor unrelated route
responses.

**Verify**:
Run the targeted API tests.

### Step 3: Preserve operational visibility server-side

If an in-scope catch block currently has no server-side logging and losing response detail would make
operations blind, add a minimal server-side log or event that records the real error through the
repo's existing redaction/logging path. Keep this focused: do not add new sinks or change event
schemas unless the existing route already has an established event.

Never move raw exception text into the client response as a substitute for logging.

**Verify**:
`bun run lint` and `bun run typecheck --incremental false` exit 0.

### Step 4: Confirm route policy and broader tests still pass

Run the route policy test because plan 015 also touches API route classification, and this plan
should not change route public/private status.

**Verify**:
`bun test src/server/auth/clerk-route-policy.test.ts` exits 0.

## Test plan

- Update Clerk webhook tests that currently assert raw messages.
- Add Stripe webhook response tests that assert fake internal exception text is not echoed.
- Add checkout and shared-trip route tests for stable error messages.
- Preserve all existing status-code and error-code assertions.

## Done criteria

- [ ] In-scope public catch blocks no longer serialize raw `error.message`.
- [ ] Tests prove fake internal exception fragments are omitted from client JSON responses.
- [ ] Existing webhook verification, idempotency, checkout gating, and shared-trip authorization tests
      still pass.
- [ ] `bun test src/app/api/stripe/webhook/route.test.ts src/app/api/clerk/webhooks/route.test.ts src/app/api/audit/checkout/route.test.ts src/app/api/trips/route.test.ts` exits 0.
- [ ] `bun test src/server/auth/clerk-route-policy.test.ts` exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run typecheck --incremental false` exits 0.
- [ ] `bun test` exits 0.

## STOP conditions

Stop and report back if:

- The current route code no longer exposes raw exception messages in the cited catch blocks.
- Fixing response hygiene requires changing webhook verification semantics, checkout eligibility, or
  shared-trip ownership checks.
- A test fixture, log output, or plan update contains a real credential value.
- The executor wants to include model-visible agent tool output in this plan. Use plan 016 for that
  separate model-context boundary.

## Maintenance notes

Public API responses should carry stable error codes and stable client-facing messages. Real
exception detail belongs in server-side logs or redacted diagnostics. Review new API routes for this
pattern during route-policy updates so classification and response hygiene stay aligned.

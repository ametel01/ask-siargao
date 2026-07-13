# Plan 015: Make API route protection explicit

> **Executor instructions**: Follow this plan step by step. Run every verification command and
> confirm the expected result before moving to the next step. If anything in the "STOP conditions"
> section occurs, stop and report; do not improvise. When done, update the status row for this plan
> in `plans/README.md` unless a reviewer tells you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 8775d60..HEAD -- src/server/auth/clerk-route-policy.ts src/server/auth/clerk-route-policy.test.ts src/proxy.ts src/app/api`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts
> against the live code before proceeding; on mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `8775d60`, 2026-07-08
- **Issue**: https://github.com/ametel01/ask-siargao/issues/88

## Why this matters

The Clerk proxy protects only routes listed in `clerkProtectedRoutePatterns`; every unlisted route is
allowed through by default. That is intentional for public chat, public pages, webhooks, and share
links, but the current tests also assert that similarly named new routes such as `/api/chatbot` are
`public-by-default`. This creates a future footgun: a new private API route can be added without
being explicitly classified. Add an inventory-backed guardrail so every API route is deliberately
public, protected, or separately token/signature-gated.

## Current state

- `src/proxy.ts` wires Clerk middleware only for protected route patterns.
- `src/server/auth/clerk-route-policy.ts` classifies known public and protected paths, then returns
  `public-by-default` for everything else.
- `src/server/auth/clerk-route-policy.test.ts` asserts `/api/chatbot` is public-by-default.
- Current `src/app/api` route files include a mix of public, protected, webhook, and token/signed
  routes.

Relevant excerpts:

```ts
// src/proxy.ts:7-15
const isProtectedRoute = createRouteMatcher([...clerkProtectedRoutePatterns]);

const clerkProxy = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
});

export default isClerkServerConfigured ? clerkProxy : () => NextResponse.next();
```

```ts
// src/server/auth/clerk-route-policy.ts:1-8
export const clerkProtectedRoutePatterns = [
  "/settings(.*)",
  "/profile(.*)",
  "/chat/history(.*)",
  "/api/me(.*)",
  "/api/chat/threads(.*)",
  "/api/chat/ratings(.*)",
] as const;
```

```ts
// src/server/auth/clerk-route-policy.ts:35-47
export function classifyClerkRoute(pathnameOrUrl: string): ClerkRouteClassification {
  const pathname = normalizePathname(pathnameOrUrl);

  if (protectedRouteExpressions.some((expression) => expression.test(pathname))) {
    return "protected";
  }

  if (publicRouteExpressions.some((expression) => expression.test(pathname))) {
    return "public";
  }

  return "public-by-default";
}
```

```ts
// src/server/auth/clerk-route-policy.test.ts:28-32
test("does not protect similarly named public routes", () => {
  expect(classifyClerkRoute("/api/chat")).toBe("public");
  expect(classifyClerkRoute("/api/chatbot")).toBe("public-by-default");
  expect(classifyClerkRoute("/chatty")).toBe("public-by-default");
  expect(classifyClerkRoute("/settings-public")).toBe("public-by-default");
```

Current API route inventory at planning time:

```text
src/app/api/audit/checkout/route.ts
src/app/api/audit/intake/route.ts
src/app/api/chat/ratings/route.ts
src/app/api/chat/route.ts
src/app/api/chat/threads/[threadId]/route.ts
src/app/api/chat/threads/route.ts
src/app/api/clerk/webhooks/route.ts
src/app/api/me/profile/route.ts
src/app/api/public/*/route.ts
src/app/api/stripe/webhook/route.ts
src/app/api/trips/saved/*/route.ts
src/app/api/trips/share/*/route.ts
```

Repo conventions to match:

- Keep route-policy unit tests in `src/server/auth/clerk-route-policy.test.ts`.
- Public anonymous surfaces are part of the product contract: `/`, `/chat`, `/api/chat`,
  `/api/public/*`, saved-trip/share APIs, webhooks, sign-in/up, and shared trip pages.
- Server-side handlers should still enforce their own auth, token, signature, and rate-limit rules.
  This plan adds a proxy-policy guardrail; it does not replace handler-level checks.

## Commands you will need

| Purpose | Command | Expected on success |
| --- | --- | --- |
| Route policy tests | `bun test src/server/auth/clerk-route-policy.test.ts` | exit 0, route policy tests pass |
| API route tests | `bun test src/app/api/chat/threads/route.test.ts src/app/api/chat/ratings/route.test.ts src/app/api/me/profile/route.test.ts src/app/api/clerk/webhooks/route.test.ts src/app/api/stripe/webhook/route.test.ts src/app/api/trips/route.test.ts src/app/api/chat/route.test.ts` | exit 0, targeted API tests pass |
| Lint | `bun run lint` | exit 0, Biome reports no fixes applied |
| Typecheck | `bun run typecheck --incremental false` | exit 0, no TypeScript errors |
| Full tests | `bun test` | exit 0, all Bun tests pass |

## Scope

**In scope**:

- `src/server/auth/clerk-route-policy.ts`
- `src/server/auth/clerk-route-policy.test.ts`
- `src/proxy.ts` only if classification changes require proxy wiring
- Optional lightweight route inventory helper/test data under `src/server/auth/`

**Out of scope**:

- Requiring Clerk auth for public chat or public saved-trip routes.
- Changing webhook verification, Stripe handling, or Clerk webhook verification logic.
- Changing handler-level rate-limit policies.
- Adding new product authentication flows.

## Git workflow

- Branch: `advisor/015-explicit-api-route-policy`
- Commit message style: short imperative, for example `Make API route policy explicit`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define explicit route policy categories

In `src/server/auth/clerk-route-policy.ts`, replace the vague `public-by-default` outcome for API
routes with explicit categories. One acceptable shape:

- `public`: known anonymous public routes;
- `protected`: routes Clerk must protect;
- `externally_verified`: webhook/token routes whose handler verifies a signature or token;
- `unclassified`: unknown routes that should fail tests.

Keep non-API page routes compatible unless you intentionally update tests for them. The key
guardrail is that new `/api/...` routes do not silently pass as public-by-default.

**Verify**:
`bun test src/server/auth/clerk-route-policy.test.ts` should fail until tests are updated.

### Step 2: Add inventory-backed tests for every current API route family

Update `src/server/auth/clerk-route-policy.test.ts` so every current API route family is explicitly
classified. Cover at least:

- protected: `/api/me/profile`, `/api/chat/threads`, `/api/chat/ratings`;
- public chat: `/api/chat`;
- public knowledge: `/api/public/entities` and one slugged public route;
- public local-first trips: `/api/trips/saved`, `/api/trips/share`, `/api/trips/share/token`;
- externally verified: `/api/stripe/webhook`, `/api/clerk/webhooks`;
- audit checkout/intake: classify according to existing product intent, but make the choice
  explicit in the test name.

Add a regression assertion that `/api/chatbot` or another unknown API path is not public.

**Verify**:
`bun test src/server/auth/clerk-route-policy.test.ts` exits 0.

### Step 3: Keep proxy behavior aligned with classification

If the proxy only needs `clerkProtectedRoutePatterns`, keep `src/proxy.ts` unchanged. If the new
classification function changes how protected patterns are exported, update the proxy with the
smallest compatible change.

Do not route externally verified webhook endpoints through Clerk auth; their handlers own signature
verification.

**Verify**:
`bun test src/server/auth/clerk-route-policy.test.ts` exits 0.

### Step 4: Run targeted API route tests

Run route tests that prove protected handlers still return 401 for anonymous calls and public
handlers still work.

**Verify**:
`bun test src/app/api/chat/threads/route.test.ts src/app/api/chat/ratings/route.test.ts src/app/api/me/profile/route.test.ts src/app/api/clerk/webhooks/route.test.ts src/app/api/stripe/webhook/route.test.ts src/app/api/trips/route.test.ts src/app/api/chat/route.test.ts`
exits 0.

## Test plan

- Route-policy tests explicitly classify current API route families.
- Unknown API paths are no longer treated as public-by-default.
- Protected route tests continue to return 401 for anonymous access.
- Public chat, public trip, public knowledge, Stripe webhook, and Clerk webhook tests still pass.

## Done criteria

- [ ] Every current `/api` route family is explicitly classified in route-policy tests.
- [ ] Unknown `/api` paths are not classified as public-by-default.
- [ ] Clerk still protects `/api/me/*`, `/api/chat/threads*`, and `/api/chat/ratings*`.
- [ ] Public anonymous routes and externally verified webhooks remain reachable as intended.
- [ ] `bun test src/server/auth/clerk-route-policy.test.ts` exits 0.
- [ ] Targeted API route test command exits 0.
- [ ] `bun run lint` exits 0.
- [ ] `bun run typecheck --incremental false` exits 0.
- [ ] `bun test` exits 0.

## STOP conditions

Stop and report back if:

- A maintainer intends unknown API routes to remain public-by-default.
- Making unknown API routes fail closed would require broad middleware behavior changes beyond the
  route-policy module and tests.
- A current route's intended public/protected status is unclear after reading handler-level auth,
  token, signature, and rate-limit checks.

## Maintenance notes

When adding a new API route, update the route-policy test in the same PR. The test should force an
explicit public/protected/external-verification decision before the route ships.

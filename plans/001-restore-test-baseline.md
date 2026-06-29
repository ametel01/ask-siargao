# 001 - Make Saved-Trip Route Tests Clerk-Hermetic

Status: ready  
Priority: P0  
Effort: small  
Risk: low  
Depends on: none  
Category: test reliability  
Planned at: `2026-06-30` against `e8b08d4`

## Goal

Make `src/app/api/trips/route.test.ts` deterministic on machines that have Clerk server
environment variables loaded. Anonymous route tests must use an explicit fake unauthenticated
identity instead of accidentally falling through to real Clerk request-scoped APIs.

This plan handles the six saved-trip API route failures. The full `bun test` baseline also
requires plan 002 because shared-trip source tests were failing separately.

## Current Evidence

`bun test` failed with Clerk errors in six route tests:

```text
Clerk: auth(), currentUser() and clerkClient(), are only supported in App Router...
headers was called outside a request scope
```

Relevant files:

- `src/app/api/trips/route.test.ts`
  - anonymous tests call `savedTripsResponse(..., dependencies)`.
  - `tripRouteDependencies()` only supplies an `auth` dependency when `options.userId !== undefined`.
- `src/app/api/trips/trip-routes.ts`
  - `resolveTripUser()` uses `dependencies.auth` when supplied.
  - otherwise it uses real `ensureCurrentUser()` when Clerk is configured.
- `src/features/auth/clerk-config.ts`
  - `isClerkServerConfigured` is true when local env has Clerk server keys.

The route behavior is fine. The test fixture is not hermetic.

## In Scope

- `src/app/api/trips/route.test.ts`
- A tiny test-only helper adjustment if needed.
- Source changes only if the route dependency seam is currently insufficient.

## Out of Scope

- Clerk production auth behavior.
- Shared-trip `notChecked` or freshness behavior. That is plan 002.
- Broad route refactors.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/001-trip-route-test-auth
   ```

2. Inspect the current helper:

   ```sh
   rg -n "tripRouteDependencies|authForUser|savedTripsResponse" src/app/api/trips/route.test.ts
   rg -n "resolveTripUser|ensureCurrentUser" src/app/api/trips/trip-routes.ts
   ```

3. Update the test dependency helper so tests supply auth explicitly by default:

   - when `options.userId` is a string, return `auth: authForUser(options.userId)`;
   - when `options.userId` is omitted, return `auth: authForUser(null)`;
   - if any test intentionally needs production Clerk fallback, add an explicit option such as
     `useProductionAuthFallback: true` and keep that usage isolated.

4. Keep assertions focused on HTTP behavior:

   - anonymous saved-trip requests should return `401`;
   - authenticated requests should use the fake user id;
   - malformed-request tests should not depend on real Clerk config.

5. Do not delete Clerk config checks from route code.

## Verification

Run:

```sh
bun test src/app/api/trips/route.test.ts
bun run lint
bun run typecheck --incremental false
```

Expected:

- route test file passes without any `Clerk: auth()` or `headers was called outside a request
  scope` errors;
- lint and typecheck pass.

After plan 002 is also implemented, run:

```sh
bun test
```

Expected after both plans: full Bun test suite passes.

## Done Criteria

- `src/app/api/trips/route.test.ts` no longer calls real Clerk auth implicitly.
- The route dependency helper makes anonymous/authenticated identity explicit.
- No production route behavior changes unless a real seam bug is discovered and documented.
- Verification commands above pass.

## Stop Conditions

Stop and update this plan if:

- the route dependency API has been removed or substantially redesigned;
- tests now run inside a real Next request context and no longer need injected auth;
- fixing the failures requires changing saved-trip authorization semantics.

## Suggested Commit

```text
Make trip route auth tests hermetic
```

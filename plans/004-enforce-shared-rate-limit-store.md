# 004 - Enforce Shared Production Rate-Limit Storage

Status: ready  
Priority: P1  
Effort: medium  
Risk: medium  
Depends on: none  
Category: security and production safety  
Planned at: `2026-06-30` against `e8b08d4`

## Goal

Make production rate limiting fail closed when it would otherwise use process-local memory
storage. Production deployments should use a shared store or make an explicit, documented
single-instance exception.

## Current Evidence

The server has rate-limit logic under `src/server/security`. The audit found the default
production behavior can rely on process-local memory, which does not enforce limits across
instances and can create a false sense of protection.

Repository docs already treat production secrets and runtime configuration as explicit
operational concerns. Rate-limit storage should follow that pattern.

## In Scope

- `src/server/security/rate-limit.ts` or the current rate-limit module path.
- `src/server/security/security.test.ts` or a focused adjacent test file.
- `documentation/developer/reference/environment.md`
- Any existing operational/security docs that mention rate limiting.

## Out of Scope

- Adding a new managed Redis provider unless one is already configured in the project.
- Changing route-level rate-limit thresholds.
- Replacing all security middleware.
- Building billing, paid passes, or refresh-budget features.

## Implementation Steps

1. Create a branch:

   ```sh
   git switch -c advisor/004-shared-rate-limit-store
   ```

2. Inspect current storage selection:

   ```sh
   rg -n "rateLimit|RateLimit|memory|store|production" src/server/security src/app/api documentation/developer
   ```

3. Add an explicit storage mode to the rate-limit implementation if it does not already exist:

   - `shared` for a cross-instance store;
   - `process-local` for in-memory storage.

4. In production, reject process-local storage by default.

   Recommended behavior:

   - throw a clear configuration error during rate-limit initialization or first check;
   - include remediation text such as "configure a shared rate-limit store";
   - optionally allow a narrowly named emergency override, for example
     `ALLOW_PROCESS_LOCAL_RATE_LIMITS=true`, documented as single-instance only.

5. Add tests for:

   - development/test can still use process-local memory;
   - production with process-local memory fails closed;
   - production with a fake shared store passes;
   - optional override behavior, if implemented.

6. Update environment docs:

   - name the required shared-store variables if they already exist;
   - otherwise document the current supported store contract and the fail-closed behavior;
   - document any temporary override as unsafe for multi-instance production.

7. Keep the route response behavior intentional:

   - a rate-limit configuration failure should not silently allow traffic;
   - if the error reaches route handlers, it should be visible in server logs.

## Verification

Run:

```sh
bun test src/server/security/security.test.ts
bun run lint
bun run typecheck --incremental false
```

If the rate-limit tests live elsewhere after inspection, run the exact adjacent test file too.

Expected:

- production process-local storage is covered by a failing test before the fix and a passing test
  after the fix;
- lint and typecheck pass.

## Done Criteria

- Production cannot silently use process-local rate-limit storage.
- Tests cover production failure and shared-store success.
- Environment/security docs describe how to configure or intentionally override the behavior.
- Verification commands pass.

## Stop Conditions

Stop and ask for an operational decision if:

- the current production deployment is intentionally single-instance and the team wants warning-only
  behavior;
- no shared-store abstraction exists and adding one would exceed this plan's scope;
- route handlers swallow configuration errors and a broader error-handling change is required.

## Suggested Commit

```text
Enforce shared rate limit storage
```

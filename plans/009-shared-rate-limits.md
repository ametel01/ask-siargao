# Plan 009: Back production rate limits with shared trusted storage

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/security/rate-limit.ts src/server/security/security.test.ts documentation/developer/explanation/audit-lifecycle-and-boundaries.md documentation/developer/reference/environment.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The current rate limiter is a process-local `Map` keyed by request forwarding headers. In serverless or multi-instance production, limits reset per instance; in direct deployments, clients can vary `x-forwarded-for` and create fresh buckets. The app relies on this limiter for intake, checkout, public APIs, report access, and Stripe/provider endpoints.

## Current State

- `src/server/security/rate-limit.ts` implements all rate-limit policies.
- `src/server/security/security.test.ts` covers threshold blocking.
- Docs already note production should replace or back limits with shared infrastructure.

Relevant excerpts:

```ts
// src/server/security/rate-limit.ts:24
const store = new Map<string, { count: number; resetAt: number }>();
```

```ts
// src/server/security/rate-limit.ts:81
const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
const realIp = request.headers.get("x-real-ip")?.trim();

return forwarded || realIp || "local";
```

```md
<!-- documentation/developer/explanation/audit-lifecycle-and-boundaries.md:27 -->
Current rate limits are in-memory policies for intake, checkout, public APIs, report access, and provider/webhook calls.
```

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Target tests | `bun test src/server/security/security.test.ts` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/server/security/rate-limit.ts`
- `src/server/security/security.test.ts`
- `documentation/developer/explanation/audit-lifecycle-and-boundaries.md`
- `documentation/developer/reference/environment.md`
- `.env.example` only if a new optional env var is introduced

**Out of scope**:

- Rewriting every route that calls `rateLimitRequest`.
- Implementing a full worker backend.
- Adding a hard dependency on one hosted vendor unless already chosen by the repo.

## Git Workflow

- Branch: `advisor/009-shared-rate-limits`
- Commit message style: `fix: support shared rate limit storage`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Introduce a rate-limit store interface

Refactor `checkRateLimit` around a small store interface such as:

```ts
type RateLimitStore = {
  increment(bucketKey: string, windowMs: number, nowMs: number): Promise<{ count: number; resetAt: number }> | { count: number; resetAt: number };
}
```

Keep an in-memory implementation for tests/local development. Add cleanup for expired buckets to avoid unbounded growth.

**Verify**: `bun test src/server/security/security.test.ts` -> exit 0.

### Step 2: Add production shared-store hook

Add a production path that can use shared infrastructure. If the repo has no selected Redis/KV client dependency, do not add a new dependency blindly. Instead:

- support an injected store for deployment wiring
- document that production must provide Redis/Upstash/Vercel KV adapter
- fail closed or warn clearly when `NODE_ENV=production` uses memory storage, depending on current deployment needs

If adding a dependency is approved in this task context, use the smallest adapter and update lockfile intentionally.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 3: Stop blindly trusting forwarding headers

Change request identity so forwarded headers are used only under an explicit trusted-proxy setting, for example `TRUST_PROXY_HEADERS=true`. Otherwise use a platform-provided trusted header if documented, or fall back to `"local"` for local dev.

Update tests to prove spoofing `x-forwarded-for` does not bypass limits when trusted proxy mode is off.

**Verify**: `bun test src/server/security/security.test.ts` -> exit 0.

### Step 4: Update docs and run gates

Document:

- local in-memory behavior
- production shared storage requirement
- trusted proxy header assumptions
- any new env vars

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Extend `src/server/security/security.test.ts` with:

- shared injected store preserves counts across two limiter instances
- expired buckets are cleaned/reset
- spoofed forwarding headers do not bypass limits unless trusted proxy mode is explicitly enabled

## Done Criteria

- [ ] Rate limiting is behind a store interface with local memory and production shared-store path.
- [ ] Forwarding headers are not trusted by default.
- [ ] Tests cover spoofed header bypass and cross-instance/shared storage behavior.
- [ ] Docs explain production requirements.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, and `bun test` exit 0.
- [ ] No files outside the in-scope list are modified unless adding an approved dependency.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Choosing Redis/KV vendor is required but not already decided.
- The deployment platform's trusted client IP header is unknown.
- Adding a dependency conflicts with repo policy or lockfile state.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Reviewers should check that local test convenience does not silently become production behavior. Rate limiting for Stripe webhooks must not block legitimate Stripe retries too aggressively.


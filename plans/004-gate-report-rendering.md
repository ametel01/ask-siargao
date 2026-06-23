# Plan 004: Gate report rendering on payment, publication, and access

> **Executor instructions**: Follow this plan step by step. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- 'src/app/audits/[auditRequestId]/report/page.tsx' src/features/report/FinalReportPage.tsx src/server/audit/sample-report.ts src/server/audit/lifecycle.ts tests/e2e/root.e2e.ts`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/003-apply-verified-webhooks.md`
- **Category**: security
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

The report route currently renders the same sample paid report for any requested audit ID. Today that exposes fixture content; once real persisted reports exist, the same pattern leaks paid report data to anyone with a URL. The route must require a published report, verified payment, reviewer approval, and an access mechanism such as a signed delivery token.

## Current State

- `src/app/audits/[auditRequestId]/report/page.tsx` renders reports.
- `src/features/report/FinalReportPage.tsx` is a presentational component.
- `src/server/audit/sample-report.ts` is fixture data.
- `src/server/audit/lifecycle.ts` already has publish guards.

Relevant excerpts:

```ts
// src/app/audits/[auditRequestId]/report/page.tsx:10
const { auditRequestId } = await params;
const rateLimit = checkRateLimit({ key: auditRequestId, policy: "report_access" });
```

```ts
// src/app/audits/[auditRequestId]/report/page.tsx:17
return <FinalReportPage auditRequestId={auditRequestId} report={sampleReport} />;
```

```ts
// src/server/audit/lifecycle.ts:206
function assertPublishable(audit: AuditLifecycleRecord) {
  if (audit.payment?.status !== "paid") {
```

Product constraints:

- Private audit report routes are marked noindex.
- Publication requires verified payment and reviewer approval.
- Private paid reports, user trip details, and payment state must not appear in public agent-readable surfaces.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Route tests | `bun test src/app/audits/report-route.test.ts` | exit 0 |
| E2E | `bun run test:e2e` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/app/audits/[auditRequestId]/report/page.tsx`
- A report access/repository module under `src/server/audit/`
- `src/app/audits/report-route.test.ts` or equivalent route test file
- `tests/e2e/root.e2e.ts`
- A demo-only route or QA fixture route if keeping sample report rendering is necessary

**Out of scope**:

- Building a full account system.
- Changing `FinalReportPage` layout except for props needed by access state.
- Publishing real reports; plan 003 gets generation started, this plan gates rendering.
- Public knowledge pages.

## Git Workflow

- Branch: `advisor/004-gate-report-rendering`
- Commit message style: `fix: require published paid report access`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define the report access contract

Create a server function that takes `auditRequestId` and an access credential from the request, then returns either:

- authorized published report data
- unauthorized/not found result

Acceptable access mechanisms for this plan:

- signed delivery token in query params
- unguessable report token stored with the report
- authenticated owner if an auth layer already exists

Do not accept bare `auditRequestId` as authorization.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 2: Replace sample rendering in the real route

Update `src/app/audits/[auditRequestId]/report/page.tsx` so it:

- applies rate limiting
- loads report access state from Step 1
- returns `notFound()` or a 403-style route response for missing/unpaid/unpublished/unauthorized reports
- renders `FinalReportPage` only for authorized published reports

Move `sampleReport` rendering to a clearly named demo/QA-only route if e2e still needs a fixture.

**Verify**: `bun test src/app/audits/report-route.test.ts` -> exit 0 after tests are added.

### Step 3: Add route and e2e tests

Add tests for:

- bare `/audits/audit_123/report` does not render a paid report
- unpublished report does not render
- unpaid report does not render
- valid access token for a published paid report renders
- the demo route, if created, is explicitly named and not confused with production report delivery

Update `tests/e2e/root.e2e.ts`, which currently expects `/audits/audit_123/report` to render the sample report.

**Verify**:

- `bun test src/app/audits/report-route.test.ts` -> exit 0
- `bun run test:e2e` -> exit 0

### Step 4: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0

## Test Plan

Use route-level tests for access decisions and Playwright for the final rendered state. The key regression is that a bare guessed audit report URL must not render paid report content.

## Done Criteria

- [ ] Production report route no longer imports or renders `sampleReport`.
- [ ] Rendering requires published report state, verified payment, reviewer approval, and a valid access credential.
- [ ] Bare guessed report URLs fail closed.
- [ ] E2E tests are updated to use the real authorized route or a clearly demo-only route.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, `bun test`, and `bun run test:e2e` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- The access model cannot be chosen without product input.
- Implementing this requires account/auth work beyond a signed token or existing owner check.
- Plan 003 has not produced durable paid/published state to load.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

Reviewers should look for accidental fallback paths that render sample or persisted reports without authorization. Keep fixture routes obviously named as demos.


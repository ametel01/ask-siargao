# Advisor Plans

These plans turn the remaining `$improve` findings into independently executable work.
They are written for another coding agent to implement from a clean checkout.

Last reconciled: `2026-06-30`
Repository revision reviewed: `a9d1775`

## Execution Order

1. [003 - Stop logging plaintext chat previews](003-stop-chat-preview-logging.md)
2. [008 - Separate public tool calls from internal tool audits](008-separate-public-tool-call-dto.md)
3. [004 - Enforce shared production rate-limit storage](004-enforce-shared-rate-limit-store.md)
4. [009 - Consolidate live place evidence planning](009-consolidate-live-place-evidence-planning.md)
5. [006 - Make local verification non-mutating and CI-aligned](006-make-verify-non-mutating.md)
6. [010 - Pin Bun runtime in CI](010-pin-bun-runtime-in-ci.md)
7. [002 - Align shared-trip source disclosure docs with the public contract](002-reconcile-shared-trip-source-disclosure.md)
8. [005 - Extract saved-trip client state from ChatWorkspace](005-extract-saved-trip-client-state.md)
9. [007 - Add nightlife event sources and route-style answers](007-nightlife-event-sources.md)
10. [011 - Add trip pass usage meter foundation](011-add-trip-pass-usage-meter-foundation.md)

Plan 001 was deleted during reconciliation because the saved-trip route tests were fixed
independently before execution. Plan 002 is no longer a baseline-repair plan; it now aligns
documentation and tests around the current public shared-trip source contract.

Plans 003, 004, and 008 are the highest-leverage security/privacy work. Plan 009 is the highest
product-correctness item after the security fixes. Plans 006 and 010 improve verification and CI
determinism. Plans 005, 007, and 011 are larger direction or maintainability work and should follow
once the lower-risk fixes are clear.

## Status Table

| Plan | Title | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 002 | Align shared-trip source disclosure docs with the public contract | P2 | small | none | TODO |
| 003 | Stop logging plaintext chat previews | P1 | small | none | TODO |
| 004 | Enforce shared production rate-limit storage | P1 | medium | none | DONE |
| 005 | Extract saved-trip client state from ChatWorkspace | P2 | large | none | TODO |
| 006 | Make local verification non-mutating and CI-aligned | P2 | small | none | TODO |
| 007 | Add nightlife event sources and route-style answers | P2 | large | existing chat/source systems | TODO |
| 008 | Separate public tool calls from internal tool audits | P1 | medium | none | DONE |
| 009 | Consolidate live place evidence planning | P1 | medium | none | DONE |
| 010 | Pin Bun runtime in CI | P2 | small | none | DONE |
| 011 | Add trip pass usage meter foundation | P2 | large | none | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED
(with one-line rationale).

## Shared Executor Rules

- Start by checking drift against each plan's `Planned at` commit:
  - `git status --short`
  - `git rev-parse --short HEAD`
  - inspect any touched files before editing them.
- Preserve user changes. Do not reset, checkout, or overwrite unrelated work.
- Use focused branches such as `advisor/003-no-chat-preview-logs`.
- Keep commits short and imperative, matching repository style.
- Run the plan-specific verification commands before handing off.
- If the code has materially changed from the reviewed paths, stop and update the plan before
  implementing.

## Baseline Observed During Reconciliation

Passing at `a9d1775`:

```sh
bun run lint
bun run typecheck --incremental false
bun audit
bun test
```

Observed `bun test` result:

```text
582 pass
0 fail
2853 expect() calls
Ran 582 tests across 55 files.
```

## Findings Considered And Rejected

- Deleted stale plan 001, saved-trip route tests calling Clerk `auth()` outside request scope:
  rejected because `tripRouteDependencies()` now injects `authForUser(options.userId ?? null)` and
  `bun test` passes.
- Stale root e2e landing assertions: rejected because `tests/e2e/root.e2e.ts` still matches the
  current `LandingPage` headings and trust-row copy.
- `/api/chat` lacking route-level rate limiting: rejected because `src/app/api/chat/route.ts`
  applies the chat rate-limit policy.
- Committed live secrets: no committed real secret values were found during this review; only
  placeholders and test fixtures were observed.

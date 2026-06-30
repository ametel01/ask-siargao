# Advisor Plans

These plans turn the remaining `$improve` findings into independently executable work.
They are written for another coding agent to implement from a clean checkout.

Planned at: `2026-06-30`  
Repository revision reviewed: `e8b08d4` for plans 001-007; `ccdd368` for plans 008-011.

## Execution Order

1. [001 - Make saved-trip route tests Clerk-hermetic](001-restore-test-baseline.md)
2. [002 - Reconcile shared-trip source disclosure](002-reconcile-shared-trip-source-disclosure.md)
3. [003 - Stop logging plaintext chat previews](003-stop-chat-preview-logging.md)
4. [004 - Enforce shared production rate-limit storage](004-enforce-shared-rate-limit-store.md)
5. [005 - Extract saved-trip client state from ChatWorkspace](005-extract-saved-trip-client-state.md)
6. [006 - Make local verification non-mutating and CI-aligned](006-make-verify-non-mutating.md)
7. [007 - Add nightlife event sources and route-style answers](007-nightlife-event-sources.md)
8. [008 - Separate public tool calls from internal tool audits](008-separate-public-tool-call-dto.md)
9. [009 - Consolidate live place evidence planning](009-consolidate-live-place-evidence-planning.md)
10. [010 - Pin Bun runtime in CI](010-pin-bun-runtime-in-ci.md)
11. [011 - Add trip pass usage meter foundation](011-add-trip-pass-usage-meter-foundation.md)

Plans 001 and 002 together restore the current `bun test` baseline. Plans 005 and 006 are
best executed after that baseline is green, so their verification failures are attributable to
the work under test rather than existing failures.

Plan 007 covers the nightlife/event-backed direction item. Plans 008-011 turn the remaining
`$improve` findings and direction option from the `ccdd368` review into executor-ready work.
Plans 008, 009, and 011 can be implemented before 001/002, but their final full-suite verification
should be rerun after the known unit-test baseline is restored. Plan 010 is independent.

## Status Table

| Plan | Title | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 001 | Make saved-trip route tests Clerk-hermetic | P0 | small | none | TODO |
| 002 | Reconcile shared-trip source disclosure | P0 | medium | none | TODO |
| 003 | Stop logging plaintext chat previews | P1 | small | none | TODO |
| 004 | Enforce shared production rate-limit storage | P1 | medium | none | TODO |
| 005 | Extract saved-trip client state from ChatWorkspace | P2 | medium-large | 001, 002 | TODO |
| 006 | Make local verification non-mutating and CI-aligned | P2 | small | 001, 002 for green final verification | TODO |
| 007 | Add nightlife event sources and route-style answers | P0 | medium-large | existing chat/source systems | TODO |
| 008 | Separate public tool calls from internal tool audits | P1 | medium | 001, 002 for green final verification | TODO |
| 009 | Consolidate live place evidence planning | P1 | medium | 001, 002 for green final verification | TODO |
| 010 | Pin Bun runtime in CI | P2 | small | none | TODO |
| 011 | Add trip pass usage meter foundation | P2 | large | 001, 002 for green final verification | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED
(with one-line rationale).

## Shared Executor Rules

- Start by checking drift against `e8b08d4`:
  - `git status --short`
  - `git rev-parse --short HEAD`
  - inspect any touched files before editing them.
- For plans 008-011, use each plan's `ccdd368` drift command instead of the older shared
  `e8b08d4` command.
- Preserve user changes. Do not reset, checkout, or overwrite unrelated work.
- Use focused branches such as `advisor/001-trip-route-test-auth`.
- Keep commits short and imperative, matching repository style.
- Run the plan-specific verification commands before handing off.
- If the code has materially changed from the reviewed paths, stop and update the plan before
  implementing.

## Baseline Observed During Planning

Passing:

```sh
bun run lint
bun run typecheck --incremental false
bun audit
```

Failing before these plans:

```sh
bun test
```

Observed result: 571 passing tests and 11 failing tests. Six failures came from saved-trip API
route tests calling Clerk `auth()` outside request scope when local Clerk env is present. Five
failures came from conflicting shared-trip source disclosure expectations around `notChecked`
and freshness fields.

## Findings Considered And Rejected

- `/api/chat` lacking route-level rate limiting: rejected because `src/app/api/chat/route.ts`
  applies the chat rate-limit policy.
- Committed live secrets: no committed real secret values were found during this review; only
  placeholders and test fixtures were observed.
- Plaintext chat preview logging, process-local production rate limiting, large `ChatWorkspace`
  state, and mutating `verify`: already covered by plans 003-006.

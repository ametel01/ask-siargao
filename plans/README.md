# Advisor Plans

These plans turn the remaining `$improve` findings into independently executable work.
They are written for another coding agent to implement from a clean checkout.

Planned at: `2026-06-30`  
Repository revision reviewed: `e8b08d4`

## Execution Order

1. [001 - Make saved-trip route tests Clerk-hermetic](001-restore-test-baseline.md)
2. [002 - Reconcile shared-trip source disclosure](002-reconcile-shared-trip-source-disclosure.md)
3. [003 - Stop logging plaintext chat previews](003-stop-chat-preview-logging.md)
4. [004 - Enforce shared production rate-limit storage](004-enforce-shared-rate-limit-store.md)
5. [005 - Extract saved-trip client state from ChatWorkspace](005-extract-saved-trip-client-state.md)
6. [006 - Make local verification non-mutating and CI-aligned](006-make-verify-non-mutating.md)

Plans 001 and 002 together restore the current `bun test` baseline. Plans 005 and 006 are
best executed after that baseline is green, so their verification failures are attributable to
the work under test rather than existing failures.

## Shared Executor Rules

- Start by checking drift against `e8b08d4`:
  - `git status --short`
  - `git rev-parse --short HEAD`
  - inspect any touched files before editing them.
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

# Advisor Plans

These plans turn the remaining `$improve` findings into independently executable work.
They are written for another coding agent to implement from a clean checkout.

Last reconciled: `2026-07-08`
Repository revision reviewed: `8775d60`

## Execution Order

1. [012 - Expand diagnostics token redaction](012-expand-diagnostics-token-redaction.md)
2. [016 - Normalize model-visible agent tool failure text](016-normalize-agent-tool-failure-text.md)
3. [017 - Stop returning raw exception messages from public API errors](017-stop-public-api-raw-exception-messages.md)
4. [013 - Align source-caveat memory with the chat response contract](013-align-source-caveat-contract.md)
5. [014 - Bound persisted profile trip context](014-bound-profile-trip-context.md)
6. [015 - Make API route protection explicit](015-make-api-route-policy-explicit.md)

Plan 001 was deleted during reconciliation because the saved-trip route tests were fixed
independently before execution. Plan 002 was corrected after the issue #23 maintainer decision:
issue #8 / PR #9 is authoritative, so public shared trips preserve governed traveler-safe
`notChecked` source context while private/internal data remains hidden.

Plans 012, 016, and 017 are the current security/privacy fixes. Plan 013 is the highest current
chat-correctness item because model-facing memory conflicts with the runtime response contract.
Plans 014 and 015 are bounded data-shape and route-policy guardrails.

Older plans 002 and 004-011 are retained as historical completed work. Plan 003 is rejected as
fixed independently: current `src/app/api/chat/chat-route.ts` logs latest user-message length and
hash only, with no plaintext preview.

## Status Table

| Plan | Title | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 002 | Align shared-trip source disclosure docs with the public contract | P2 | small | none | DONE |
| 003 | Stop logging plaintext chat previews | P1 | small | none | REJECTED - fixed independently before this run |
| 004 | Enforce shared production rate-limit storage | P1 | medium | none | DONE |
| 005 | Extract saved-trip client state from ChatWorkspace | P2 | large | none | DONE |
| 006 | Make local verification non-mutating and CI-aligned | P2 | small | none | DONE |
| 007 | Add nightlife event sources and route-style answers | P2 | large | existing chat/source systems | DONE |
| 008 | Separate public tool calls from internal tool audits | P1 | medium | none | DONE |
| 009 | Consolidate live place evidence planning | P1 | medium | none | DONE |
| 010 | Pin Bun runtime in CI | P2 | small | none | DONE |
| 011 | Add trip pass usage meter foundation | P2 | large | none | DONE |
| 012 | Expand diagnostics token redaction | P1 | small | none | TODO |
| 013 | Align source-caveat memory with the chat response contract | P1 | medium | none | TODO |
| 014 | Bound persisted profile trip context | P2 | small | none | TODO |
| 015 | Make API route protection explicit | P2 | medium | none | TODO |
| 016 | Normalize model-visible agent tool failure text | P1 | medium | none | TODO |
| 017 | Stop returning raw exception messages from public API errors | P2 | medium | none | TODO |

Status values: TODO | IN PROGRESS | DONE | BLOCKED (with one-line reason) | REJECTED
(with one-line rationale).

## Published Issues

- [#85 - Expand diagnostics token redaction](https://github.com/ametel01/ask-siargao/issues/85)
  maps to [012](012-expand-diagnostics-token-redaction.md).
- [#86 - Align source-caveat memory with chat response contract](https://github.com/ametel01/ask-siargao/issues/86)
  maps to [013](013-align-source-caveat-contract.md).
- [#87 - Bound persisted profile trip context](https://github.com/ametel01/ask-siargao/issues/87)
  maps to [014](014-bound-profile-trip-context.md).
- [#88 - Make API route protection explicit](https://github.com/ametel01/ask-siargao/issues/88)
  maps to [015](015-make-api-route-policy-explicit.md).
- [#93 - Normalize agent tool failure text](https://github.com/ametel01/ask-siargao/issues/93)
  maps to [016](016-normalize-agent-tool-failure-text.md).
- [#94 - Stop returning raw exception messages from public API errors](https://github.com/ametel01/ask-siargao/issues/94)
  maps to [017](017-stop-public-api-raw-exception-messages.md).

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

Passing at `8775d60`:

```sh
bun audit
bun run lint
bun run typecheck --incremental false
bun test
```

Observed `bun test` result:

```text
808 pass
0 fail
4169 expect() calls
Ran 808 tests across 74 files.
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
- Plan 003, plaintext chat preview logging: rejected because
  `src/app/api/chat/chat-route.ts:806-810` now returns only message length and hash.
- Admin diagnostics displaying sample data: not treated as a bug in this run because
  `documentation/developer/reference/demo-data.md` documents that admin diagnostics use
  `createSampleDiagnosticsSnapshot`; wiring live diagnostics remains a product-direction option.

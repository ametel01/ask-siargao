# Issue 124 - Restrained grounded-answer motion

- issue: #124 Add one restrained motion signature to grounded answers
- role: builder-agent
- branch: `run/42f7c271-issue-124`
- pr: https://github.com/ametel01/ask-siargao/pull/135
- phase: draft PR open; ready for independent checker
- summary:
  - Added an ephemeral `answer-arrival-motion` helper for live local pending-to-complete
    assistant messages with selected decision-strip metadata.
  - Wired the activation only at the successful `/api/chat` pending assistant replacement path;
    thread hydration, reload, errors, stops, and plain answers remain static/ineligible.
  - Added one scoped decision-strip sequence cue: a non-interactive absolute rail that animates
    only `opacity` and `transform`, clears after `animationend`, and suppresses itself under
    `prefers-reduced-motion: reduce`.
  - Preserved the #107 decision-strip DOM/data contract and #119 honest wait behavior; no provider,
    response timing, persistence, source, schema, or fake-progress changes.
- evidence:
  - Focused unit: `bun test src/features/chat/answer-arrival-motion.test.ts src/features/chat/decision-strip-presentation.test.ts src/features/chat/response-wait-state.test.tsx src/features/chat/assistant-message-presentation.test.ts` passed, 22 tests / 57 assertions.
  - Focused browser: `bun run test:e2e -- tests/e2e/chat.e2e.ts -g "runs the decision strip arrival sequence|leads live grounded answers|loads signed-in chat history" --workers=1` passed, 3 tests.
  - Focused 390x844 4x-throttled motion metrics: one `decision-strip-sequence-cue` animation start, one end, CLS `0`, `0` long tasks over 50ms, 63 rAF samples, max frame interval about `10.3ms`, duration `520ms`.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `bun test` passed, 939 tests / 5014 assertions.
  - `bun run db:migrate:test` passed, 50 tables / 8 migrations.
  - `bun run db:seed:test` passed, 5 areas / 3 routes / 6 source profiles.
  - `bun run build` passed; emitted the known sibling-lockfile Next workspace-root warning.
  - `bun run test:e2e` passed, 81 tests; emitted known baseline `DATABASE_URL` warnings for
    unmocked background requests.
  - `npx react-doctor@latest --verbose --scope changed` passed with no issues, score `85/100`.
  - `bun run doctor` exited 0 and reported the pre-existing full-codebase baseline score `80/100`
    with 50 warnings.
  - `git diff --check` passed.
- checker focus:
  - Verify eligibility is based on local pending-to-complete transition, not mount, message ID,
    scroll, focus, reload, or thread hydration.
  - Verify reduced-motion users get no eligibility attribute, no animation start, and final
    decision/source content immediately.
  - Verify the cue is the only motion treatment and uses only compositor-safe properties without
    content gating, pointer interception, source disclosure delay, layout shift, or replay.

## Checker Result

Status: FAILED

## Commands

- command: `git rev-parse HEAD && git status --short --branch --untracked-files=all`
  result: pass
  evidence: head `ba49a87aefe97c38b73e155ce5ec928726fa3467`; worktree clean before status writes.
- command: read live issue #124 and PR #135 with `gh issue view` / `gh pr view`
  result: pass
  evidence: issue #124 open; PR #135 open draft; head `ba49a87aefe97c38b73e155ce5ec928726fa3467`; `closingIssuesReferences` exactly `{#124}`; no reviews.
- command: inspect #107/#119 live context and ancestry
  result: pass
  evidence: #107 and #119 are closed; ancestry includes #107 decision-strip `276040b` and #119 wait-state commits `75fe47e`, `6f624dc`, `1ffc0e6`.
- command: static inspection of `ChatWorkspace.tsx`, `answer-arrival-motion.ts`, `global.css`, and `tests/e2e/chat.e2e.ts`
  result: pass
  evidence: activation only at local pending-to-complete success (`ChatWorkspace.tsx:1059`), error/stopped clear (`1095`, `1150`), hydrated messages are static (`4697`), one-shot consume and animation-end clear (`3301`, `3318`), CSS only opacity/transform (`global.css:431`, `436`), reduced motion disables animation (`global.css:460`).
- command: `bun install --frozen-lockfile`
  result: pass
  evidence: checked 911 installs, no changes.
- command: `bun test src/features/chat/answer-arrival-motion.test.ts src/features/chat/decision-strip-presentation.test.ts src/features/chat/response-wait-state.test.tsx src/features/chat/assistant-message-presentation.test.ts`
  result: pass
  evidence: 22 pass, 0 fail, 57 assertions.
- command: `bun run test:e2e -- tests/e2e/chat.e2e.ts -g "runs the decision strip arrival sequence|leads live grounded answers|loads signed-in chat history" --workers=1`
  result: pass
  evidence: 3 passed; normal-motion metrics `starts=1`, `ends=1`, `layoutShift=0`, `longTaskCountOver50ms=0`, `sampledFrames=59`, `maxFrameIntervalMs=41.6`, `animationDurationMs=520`, viewport 390x844, CPU 4x.
- command: `bun run lint`
  result: pass
  evidence: Biome checked 337 files; no fixes applied.
- command: `bun run typecheck --incremental false`
  result: pass
  evidence: `tsc --noEmit --incremental false` exited 0.
- command: `bun test`
  result: pass
  evidence: 939 pass, 0 fail, 5014 assertions.
- command: `bun run db:migrate:test`
  result: pass
  evidence: migrated 50 tables and recorded 8 migrations.
- command: `bun run db:seed:test`
  result: pass
  evidence: seeded 5 areas, 3 routes, and 6 source profiles.
- command: `bun run build`
  result: pass
  evidence: compiled and generated 27 static pages; only known sibling-lockfile workspace-root warning.
- command: `bun run test:e2e`
  result: pass
  evidence: 81 passed; known baseline `DATABASE_URL is required` warnings from unmocked background profile/saved-trip requests.
- command: `npx react-doctor@latest --verbose --scope changed`
  result: pass
  evidence: no issues found; score 85/100.
- command: `bun run doctor`
  result: pass
  evidence: exited 0; full-codebase baseline score 80/100 with 50 pre-existing warnings.
- command: `git diff --check origin/main...HEAD`
  result: pass
  evidence: no whitespace errors.
- command: changed-file secret grep
  result: pass
  evidence: only existing placeholders/test redaction fixtures found; no new real secrets.
- command: `gh run view 29189525779 --json ...`
  result: fail
  evidence: exact-head CI release-gate passed setup, checkout, Bun setup, frozen install, Chromium install, lint, typecheck, Bun tests, DB migrate/seed, build, and screenshot uploads, but failed `End-to-end tests`.

## Failures

- `tests/e2e/chat.e2e.ts:2218`
  check: hosted exact-head CI `bun run test:e2e` in release-gate run `29189525779`
  exact error: `Expected length: 0`; `Received length: 4`; `Received array: [196, 122, 135, 116]` for `metrics.longTasks.filter((duration) => duration > 50)`.
  likely owner: builder-agent for #124 motion performance harness/implementation.

## Coverage Gaps

- Local full E2E passed with zero >50ms long tasks in the #124 motion test, but hosted CI failed the same assertion; the CI/mobile-performance requirement is not satisfied until the hosted gate is green.
- `STATUS.md` and `STATUS.contracts.md` were absent inside the issue worktree; checker read the shared root files at `/Users/alexmetelli/source/ask-siargao/STATUS.md` and `/Users/alexmetelli/source/ask-siargao/STATUS.contracts.md`.

## Next Action

- Builder repair is complete locally; checker should rerun focused #124 Playwright and exact-head CI before maintainer review.

## Builder Follow-up

Status: READY FOR CHECKER

- Repair: replaced duration-only long-task collection with timestamped task intervals and an explicit
  `readyAt` baseline. The regression now rejects only tasks overlapping the actual
  `animationstart` to `animationend` window; tasks that complete before the cue remain visible as
  baseline evidence and cannot be misclassified as motion work.
- Scope: no motion CSS, activation, reduced-motion, layout, source disclosure, interaction, or
  hydration behavior changed. Frame cadence and one-time cleanup assertions remain active.
- Focused browser: 3 consecutive runs passed; each reported `starts=1`, `ends=1`, `layoutShift=0`,
  `motionLongTaskCountOver50ms=0`, and 61-63 sampled frames at 390x844 with 4x CPU throttle.
- Full browser: `bun run test:e2e` passed 81 tests; motion metrics reported
  `starts=1`, `ends=1`, `layoutShift=0`, `motionLongTaskCountOver50ms=0`, and 63 sampled frames.
- Static/local gates after repair: lint, clean typecheck, Bun (939 tests / 5014 assertions), DB test
  migrate/seed, and build all passed.
- Hosted follow-up: push this repair as a new head and rerun exact-head release-gate; do not move to
  maintainer review until the hosted E2E check is green.

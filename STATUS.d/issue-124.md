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

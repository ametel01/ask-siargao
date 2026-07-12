# Issue 120 - Product surface visual consolidation

- issue: #120 Reduce card chrome and heavy typography across product surfaces
- role: builder-agent
- branch: `run/42f7c271-issue-120`
- worktree: `/Users/alexmetelli/source/.agentloop-worktrees/ask-siargao/control/issue-120`
- phase: implementation complete; ready for independent checker after push
- summary:
  - Added documented shared product surface roles in the Ask Siargao shell: panel, inset, overlay,
    and line item, backed by restrained flat/panel/overlay shadow tokens.
  - Reworked landing, chat, and settings to use the shared surface roles instead of bespoke raised
    card/shadow treatments.
  - Reduced repeated `font-black` usage across the stable product surfaces to semibold hierarchy.
  - Flattened chat recommendation grouping so the group wrapper is no longer an extra card around
    the recommendation artifacts.
  - Preserved #109 field-desk layout, chat behavior, settings behavior, accessibility hooks, focus
    rings, reduced-motion behavior, and route/API/domain behavior.
- evidence:
  - `bun install --frozen-lockfile` passed.
  - `bun run lint` passed.
  - `bun run typecheck --incremental false` passed.
  - `git diff --check` passed.
  - `bun run test:e2e -- tests/e2e/root.e2e.ts -g "landing remains intentional|edits profile details" --workers=1` passed, 5 tests.
  - `bun run test:e2e -- tests/e2e/chat.e2e.ts -g "renders the field desk workspace across desktop visual fixtures" --workers=1` passed, 1 test.
  - `bun run build` passed; emitted the known sibling-lockfile Next workspace-root warning.
  - `npx react-doctor@latest --verbose --scope changed` passed with no issues, score `83/100`.
- screenshots:
  - Landing: `issue-120-landing-mobile-390.png`, `issue-120-landing-desktop-1440.png`.
  - Settings: `issue-120-settings-desktop.png`, `issue-120-settings-mobile-390.png`.
  - Chat: `issue-120-chat-1180.png`, `issue-120-chat-wide-1920.png`, plus a 390px mobile shell.
- durable before/after evidence: `docs/visual-evidence/issue-120/{before,after}/` contains paired
  landing, settings, and chat PNGs at mobile 390px and desktop 1440px viewports. `file` verified
  all twelve artifacts as PNGs with the expected dimensions.
- checker focus:
  - Verify the three product surfaces consistently use the documented panel/inset/overlay/line-item
    roles without adding nested cards outside real artifacts.
  - Verify primary actions still read as dominant through color/placement and not broad glow/shadow.
  - Verify the #109 field-desk shell dimensions, scroll model, chat recommendation behavior, settings
    forms, focus visibility, mobile widths, and 200% zoom coverage remain intact.
- coverage gaps:
  - No full `bun run test:e2e` was run; focused browser coverage was selected for the landing,
    settings, and chat surfaces directly affected by #120.

## Independent Checker - 2026-07-13

- status: FAILED
- checked head: `d7b686a9c0272cdc27e8b702cd91af27460f7168`
- issue contract: #120 requires documented shared surface roles, reduced `font-black`, safe card
  flattening, accessible hierarchy/focus/touch/zoom/reduced-motion behavior, unchanged behavior, and
  before/after screenshots.
- passing evidence:
  - `git rev-parse HEAD` -> `d7b686a9c0272cdc27e8b702cd91af27460f7168`.
  - `git status --short --branch --untracked-files=all` initially clean on
    `run/42f7c271-issue-120...origin/run/42f7c271-issue-120`.
  - `git diff --check origin/main...HEAD` passed.
  - `bun test src/features/chat/recommendation-presentation.test.ts src/features/chat/answer-arrival-motion.test.ts src/features/chat/saved-trip-client.test.ts src/features/settings/account-management.test.ts` passed, 34 tests.
  - `bun run lint` passed, Biome checked 345 files.
  - `bun run typecheck --incremental false` passed.
  - `bun run test:e2e -- tests/e2e/root.e2e.ts -g "landing remains intentional|landing remains usable at a 200 percent zoom equivalent|edits profile details" --workers=1` passed, 6 tests.
  - `bun run test:e2e -- tests/e2e/chat.e2e.ts -g "renders the field desk workspace across desktop visual fixtures|renders one recommendation as a focused best move on mobile|suppresses duplicate recommendation cards" --workers=1` passed, 2 tests.
  - `bun test src/server/chat/agent-runtime.test.ts src/server/chat/public-turn-assembly.test.ts -t "mixed displayCardIds|displayCardIds|card"` passed, 15 tests.
  - `bun run test:e2e -- tests/e2e/chat.e2e.ts -g "renders a selected route as ordered movement without duplicating stop cards|collapses missing map and optional recommendation signals without dead controls|renders provider-unavailable answers without positive recommendation cards" --workers=1` passed, 3 tests; dev-server log emitted `DATABASE_URL is required to create a database query client.` for unmocked `/api/me/profile` calls, but tests passed.
  - `bun test` passed, 987 tests.
  - `bun run build` passed; emitted the known Next multiple-lockfile workspace-root warning.
  - Current touched product surfaces have no `font-black` occurrences under `src/features/landing`,
    `src/features/chat`, `src/features/settings`, or `src/ui/components`; `origin/main` had 80.
  - Bespoke/high chrome shadow uses in the touched product surface paths dropped from 29 on
    `origin/main` to tokenized shared roles plus one CTA/media-frame exception.
- failure:
  - #120 acceptance requires before/after screenshots. This shard lists only after-screenshot
    filenames at lines 27-30, and `find test-results -maxdepth 6 -type f` shows only
    `test-results/.last-run.json`; `find . -path './node_modules' -prune -o -path './.next' -prune -o -type f -iname '*.png' -print` shows only existing design/public images. No before screenshots or current issue-120 screenshot files were available for checker verification.
- next action:
  - Builder/coordinator should provide durable before/after screenshot evidence for landing, chat,
    and settings at mobile and desktop widths, then request checker rerun.

## Coordinator Resolution

- Generated baseline screenshots from detached `origin/main` (`defd4d0`) on port 3111 and current
  screenshots from this branch on port 3110.
- Committed evidence paths:
  - `docs/visual-evidence/issue-120/before/landing-{mobile-390,desktop-1440}.png`
  - `docs/visual-evidence/issue-120/before/settings-{mobile-390,desktop-1440}.png`
  - `docs/visual-evidence/issue-120/before/chat-{mobile-390,desktop-1440}.png`
  - `docs/visual-evidence/issue-120/after/chat-{mobile-390,1180,wide-1920}.png` captured from
    the current mocked E2E/desktop shell paths.
- Requesting checker rerun against the same code head with this durable evidence present.

## Independent Checker Rerun - 2026-07-13

## Checker Result
Status: ALL GREEN

## Commands
- command: `git rev-parse HEAD && git rev-parse HEAD~1`
  result: passed
  evidence: `HEAD` is `a55616c54d3878316ccc78ca49bd5df31098caac`; `HEAD~1` is implementation commit `d7b686a9c0272cdc27e8b702cd91af27460f7168`.
- command: `git status --short --branch --untracked-files=all`
  result: passed
  evidence: clean on `run/42f7c271-issue-120...origin/run/42f7c271-issue-120` before and after gates.
- command: `git diff --name-only HEAD~1..HEAD -- src tests package.json bun.lock .github | wc -l`
  result: passed
  evidence: `0`; evidence commit adds no implementation, test, package, lockfile, or CI changes.
- command: `git diff --name-status HEAD~1..HEAD`
  result: passed
  evidence: only `STATUS.d/issue-120.md` changed and twelve PNG files were added under `docs/visual-evidence/issue-120/{before,after}/`.
- command: `find docs/visual-evidence/issue-120 -type f -name '*.png' -print | sort`
  result: passed
  evidence: all twelve expected files exist: before/after chat, landing, and settings at mobile 390 and desktop 1440.
- command: `file docs/visual-evidence/issue-120/before/*.png docs/visual-evidence/issue-120/after/*.png`
  result: passed
  evidence: `chat-desktop-1440.png` before/after `1440 x 1000`; `chat-mobile-390.png` before/after `390 x 844`; `landing-desktop-1440.png` before `1440 x 1303`, after `1440 x 1305`; `landing-mobile-390.png` before `390 x 1459`, after `390 x 1464`; `settings-desktop-1440.png` before/after `1440 x 1000`; `settings-mobile-390.png` before/after `390 x 844`.
- command: `shasum -a 256 docs/visual-evidence/issue-120/before/*.png docs/visual-evidence/issue-120/after/*.png`
  result: passed
  evidence: all twelve PNGs have distinct committed hashes; after/before pairs are not identical.
- command: `git diff --check origin/main...HEAD`
  result: passed
  evidence: no whitespace errors.
- command: `bun test src/features/chat/recommendation-presentation.test.ts src/features/chat/answer-arrival-motion.test.ts src/features/chat/saved-trip-client.test.ts src/features/settings/account-management.test.ts`
  result: passed
  evidence: 34 passed, 0 failed.
- command: `bun test src/server/chat/agent-runtime.test.ts src/server/chat/public-turn-assembly.test.ts -t "mixed displayCardIds|displayCardIds|card"`
  result: passed
  evidence: 15 passed, 31 filtered out, 0 failed.
- command: `bun run lint`
  result: passed
  evidence: `biome check .`; checked 345 files; no fixes applied.
- command: `bun run typecheck --incremental false`
  result: passed
  evidence: `tsc --noEmit --incremental false` exited 0.
- command: `bun run build`
  result: passed
  evidence: Next 16.2.9 compiled successfully; same known multiple-lockfile workspace-root warning emitted.
- command: `rg -n "font-black" src/features/landing src/features/chat src/features/settings src/ui/components || true`
  result: passed
  evidence: no current `font-black` occurrences in touched product surfaces; `git grep -n "font-black" origin/main -- src/features/landing src/features/chat src/features/settings src/ui/components | wc -l` reports `80` on `origin/main`.
- command: `rg -n -e "--shadow-surface-flat|--shadow-surface-panel|--shadow-surface-overlay|Product elevation roles|shadow-surface|shadow-none|shadow-cta|shadow-coastal-frame" src/theme/global.css src/features/landing/LandingPage.tsx src/features/chat/ChatWorkspace.tsx src/features/settings/SettingsDashboardPage.tsx src/ui/components/ask-siargao.tsx`
  result: passed
  evidence: shared flat/panel/overlay shadow tokens exist in `src/theme/global.css`; shared product surface role classes exist in `src/ui/components/ask-siargao.tsx`; touched surfaces use restrained `shadow-none`, `shadow-surface-panel`, `shadow-surface-overlay`, `shadow-cta`, and one `shadow-coastal-frame` media-frame exception.
- command: `bun run test:e2e -- tests/e2e/chat.e2e.ts -g "renders the field desk workspace across desktop visual fixtures|renders one recommendation as a focused best move on mobile|suppresses duplicate recommendation cards" --workers=1`
  result: passed
  evidence: 2 passed, 0 failed; emitted the known multiple-lockfile workspace-root warning.
- command: `bun run test:e2e -- tests/e2e/root.e2e.ts -g "landing remains intentional|landing remains usable at a 200 percent zoom equivalent|edits profile details" --workers=1`
  result: passed after serial rerun
  evidence: first parallel attempt failed with `EADDRINUSE` on `127.0.0.1:3100` while the chat E2E server was running; serial rerun passed 6 tests, 0 failed, with the known multiple-lockfile workspace-root warning.

## Failures
- none

## Coverage Gaps
- Full `bun run test:e2e`, `bun test`, test DB migrate/seed, and React Doctor were not rerun in this checker rerun. Prior exact implementation-head evidence in this shard covers `bun test`, `bun run build`, focused E2E, and React Doctor for `d7b686a`; this rerun rechecked the evidence-only top commit, PNG dimensions, lint, typecheck, build, focused unit tests, and focused E2E.

## Next Action
- CHECKER ALL GREEN. No code or evidence blocker found for issue #120 at `a55616c54d3878316ccc78ca49bd5df31098caac`.

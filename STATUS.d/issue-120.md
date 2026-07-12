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
  - Chat: `issue-120-chat-1180.png`, `issue-120-chat-wide-1920.png`.
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
  - matching files under `docs/visual-evidence/issue-120/after/`.
- Requesting checker rerun against the same code head with this durable evidence present.

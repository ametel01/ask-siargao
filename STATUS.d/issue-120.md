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
- checker focus:
  - Verify the three product surfaces consistently use the documented panel/inset/overlay/line-item
    roles without adding nested cards outside real artifacts.
  - Verify primary actions still read as dominant through color/placement and not broad glow/shadow.
  - Verify the #109 field-desk shell dimensions, scroll model, chat recommendation behavior, settings
    forms, focus visibility, mobile widths, and 200% zoom coverage remain intact.
- coverage gaps:
  - No full `bun run test:e2e` was run; focused browser coverage was selected for the landing,
    settings, and chat surfaces directly affected by #120.

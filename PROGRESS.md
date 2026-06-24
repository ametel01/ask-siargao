# Real Chat Replacement Progress

## Source Summary

This tracks implementation of `PLAN.md`: replace the `/chat` mockup with a real,
responsive Ask Siargao chat surface backed by the existing `/api/chat` endpoint,
preserve `?prompt=...` auto-submit links, remove fake evidence/context UI, add mocked
Playwright coverage, and run the repository quality gates.

## Update Rule

After each step is completed, update this file with the completed step, validation
results, commit reference if available, current status, and next step.

## Baseline Context

- The GPT-backed chat API slice is already committed in `43b3a32 Add Ask Siargao chat flow`.
- Current uncommitted baseline at Step 0 start: `PLAN.md` only.

## Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Replace Mock Chat Layout With A Focused Responsive Shell
- [ ] Step 2: Add Mocked Browser Coverage For Real Chat Interaction
- [ ] Step 3: Harden Chat Error, Pending, And Accessibility States
- [ ] Step 4: Align Landing Deep Links And Final Visual Smoke
- [ ] Step 5: Final Verification And Handoff

## Current Status

Step 1 complete. Current status: ready for Step 2.

Next step: Add mocked browser coverage for real chat submission, assistant response
rendering, and prompt auto-submit.

## Update Log

### Step 0: Progress and Changelog Tracking Setup

- Created durable execution tracking in `PROGRESS.md`.
- Verified `CHANGELOG.md` exists with `# Changelog`, the Keep a Changelog preamble,
  and `## [Unreleased]`.
- Recorded the existing committed GPT chat API work as baseline context.
- Confirmed no chat behavior changes were made.

Validation:

- `test -f PROGRESS.md` - passed
- `test -f CHANGELOG.md` - passed
- `rg -n "^# Changelog|^## \\[Unreleased\\]" CHANGELOG.md` - passed

Commit:

- `dcc0148 chore: track real chat replacement progress`

### Step 1: Replace Mock Chat Layout With A Focused Responsive Shell

- Replaced the split desktop/mobile mock workspace with one responsive chat shell.
- Removed fake sidebars, saved places, recent questions, trip context, weather, surf,
  sample evidence, restaurant cards, freshness badges, and confidence badges from `/chat`.
- Added small internal `ChatMessage`, `ChatComposer`, `SuggestedPromptBar`, and
  `ChatEmptyState` components.
- Kept the existing React-only message state, `/api/chat` submit flow, suggested prompts,
  and `initialPrompt` support from `src/app/chat/page.tsx`.
- Updated the existing chat e2e smoke coverage to assert the real shell and absence of
  old fake layout content.

Validation:

- `bun run format` - passed
- `bun run lint` - passed after replacing the ARIA-labelled prompt wrapper with a
  semantic `fieldset` and removing the unnecessary effect dependency
- `bun run typecheck` - passed
- `bun test src/app/api/chat/route.test.ts` - passed
- `bun run test:e2e -- tests/e2e/chat.e2e.ts` - passed
- `bun run build` - passed

Commit:

- Pending: `feat: replace chat mockup with real chat shell`

# Remove Panda and Expand shadcn Integration Progress

Sources:
- `PLAN.md`
- Inline user brief supplied in chat on 2026-06-24
- `components.json`
- `package.json`
- `src/theme/tokens.ts`
- `src/theme/global.css`

## Status

- Current status: Step 4 complete; remaining report, admin, public, and status surface migration pending.
- Next step: Step 5, Migrate Report, Admin, Public, and Status Surfaces.
- Update rule: After each completed step, update this file with completion notes, validation results, commit reference if available, current status, and next step.

## Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Baseline Inventory and Gate Run
- [x] Step 2: Add shadcn Primitives and Brand CSS Variables
- [x] Step 3: Migrate Shared Ask Siargao Primitives off Panda
- [x] Step 4: Migrate Landing and Chat Surfaces to shadcn/Tailwind
- [ ] Step 5: Migrate Report, Admin, Public, and Status Surfaces
- [ ] Step 6: Remove Panda Configuration, Generated Output, Scripts, and Docs
- [ ] Step 7: Final Regression, Visual Polish, and Handoff

## Source Summary

The migration removes Panda CSS from runtime code, generated assets, scripts, dependencies, and documentation while preserving the current Ask Siargao brand. shadcn source components, Tailwind v4 utilities, and CSS variables are the target styling foundation. The canonical color, gradient, surface, shadow, typography, spacing, duration, and easing values currently live in `src/theme/tokens.ts` and must be moved into `src/theme/global.css` before Panda is removed.

## Update Log

- 2026-06-24: Reset progress tracking for the "Remove Panda and Expand shadcn Integration" plan. Validation confirmed `PROGRESS.md` contains the new migration checklist and `CHANGELOG.md` retains the Keep a Changelog structure with `# Changelog` and `## [Unreleased]`. Commit pending for Step 0.
- 2026-06-24: Step 1 complete. Baseline inventory found Panda still active in `package.json`, `panda.config.ts`, `doctor.config.json`, `documentation/developer/reference/scripts.md`, `src/theme/global.css`, `src/theme/recipes.ts`, `src/ui/components/ask-siargao.tsx`, `src/features/landing/LandingPage.tsx`, `src/features/chat/ChatWorkspace.tsx`, `src/features/report/FinalReportPage.tsx`, `src/features/admin/AdminDiagnosticsPage.tsx`, `src/features/public-pages/PublicKnowledgePage.tsx`, and `src/features/audit-status/AuditStatusPage.tsx`. Current shadcn inventory contains accordion, alert, badge, button, card, checkbox, dialog, dropdown-menu, field, input, label, progress, radio-group, select, separator, sheet, skeleton, sonner, spinner, switch, table, tabs, textarea, and tooltip. Registry search confirmed `sidebar`, `scroll-area`, `avatar`, `input-group`, `button-group`, `toggle-group`, `item`, `empty`, `breadcrumb`, `collapsible`, and `navigation-menu` are available from `@shadcn`. Validation passed: `bun run lint`, `bun run typecheck --incremental false`, `bun test`, `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and `bun run test:e2e`. Commit pending for Step 1.
- 2026-06-24: Step 2 complete. Added shadcn `sidebar`, `scroll-area`, `avatar`, `input-group`, `button-group`, `toggle`, `toggle-group`, `item`, `empty`, `breadcrumb`, `collapsible`, and `navigation-menu` primitives without overwriting existing local components. Moved the canonical Ask Siargao brand palette, surfaces, text colors, confidence and risk colors, borders, shadows, gradients, fonts, durations, and easing into `src/theme/global.css`; mapped shadcn sidebar, chart, background, foreground, card, popover, primary, secondary, muted, accent, border, input, and ring variables to the brand layer; and kept the generated Panda stylesheet import as a temporary fallback for unmigrated code. Validation passed: `bun run format`, `bun run lint`, `bun run typecheck --incremental false`, `bun test`, `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and `bun run test:e2e`. Commit pending for Step 2.
- 2026-06-24: Step 3 complete. Refactored `src/ui/components/ask-siargao.tsx` off Panda `css()`, `cx()`, and token references while preserving `BrandLockup`, `PalmMark`, `GradientLink`, `SignalBadge`, and `BrowserDots` exports. The shared primitives now use `cn`, Tailwind utilities, CSS variables, `Button`, `Badge`, and `Avatar`; generated Panda CSS was refreshed to remove no-longer-referenced shared primitive classes. Validation passed: `bun run format`, `bun run lint`, `bun run typecheck --incremental false`, `bun test`, `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and `bun run test:e2e`. Commit pending for Step 3.
- 2026-06-24: Step 4 complete. Migrated `src/features/landing/LandingPage.tsx` and `src/features/chat/ChatWorkspace.tsx` from Panda helper functions to Tailwind/shadcn classes and primitives, including `NavigationMenu`, `ButtonGroup`, `Card`, `Sidebar`, `ScrollArea`, `Avatar`, and `InputGroup` usage while preserving the existing root and `/chat` copy, routing, desktop three-column chat layout, mobile chat surface, and responsive root overflow behavior. Refreshed generated Panda CSS to remove landing/chat extracted classes that are no longer referenced. Screenshot smoke checks were captured for root desktop/mobile and `/chat` desktop/mobile under `/tmp/siargao-step4-*.png`, with a follow-up desktop chat sidebar fit polish. Validation passed: `bun run format`, `bun run lint`, `bun run typecheck --incremental false`, `bun test`, `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, `bun run test:e2e`, and `npx react-doctor@latest --verbose --scope changed` with score 100/100 and no issues. Commit pending for Step 4.

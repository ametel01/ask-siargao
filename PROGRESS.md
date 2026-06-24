# Remove Panda and Expand shadcn Integration Progress

Sources:
- `PLAN.md`
- Inline user brief supplied in chat on 2026-06-24
- `components.json`
- `package.json`
- `src/theme/tokens.ts`
- `src/theme/global.css`

## Status

- Current status: Step 1 complete; shadcn primitives and brand CSS variable migration pending.
- Next step: Step 2, Add shadcn Primitives and Brand CSS Variables.
- Update rule: After each completed step, update this file with completion notes, validation results, commit reference if available, current status, and next step.

## Checklist

- [x] Step 0: Progress and Changelog Tracking Setup
- [x] Step 1: Baseline Inventory and Gate Run
- [ ] Step 2: Add shadcn Primitives and Brand CSS Variables
- [ ] Step 3: Migrate Shared Ask Siargao Primitives off Panda
- [ ] Step 4: Migrate Landing and Chat Surfaces to shadcn/Tailwind
- [ ] Step 5: Migrate Report, Admin, Public, and Status Surfaces
- [ ] Step 6: Remove Panda Configuration, Generated Output, Scripts, and Docs
- [ ] Step 7: Final Regression, Visual Polish, and Handoff

## Source Summary

The migration removes Panda CSS from runtime code, generated assets, scripts, dependencies, and documentation while preserving the current Ask Siargao brand. shadcn source components, Tailwind v4 utilities, and CSS variables are the target styling foundation. The canonical color, gradient, surface, shadow, typography, spacing, duration, and easing values currently live in `src/theme/tokens.ts` and must be moved into `src/theme/global.css` before Panda is removed.

## Update Log

- 2026-06-24: Reset progress tracking for the "Remove Panda and Expand shadcn Integration" plan. Validation confirmed `PROGRESS.md` contains the new migration checklist and `CHANGELOG.md` retains the Keep a Changelog structure with `# Changelog` and `## [Unreleased]`. Commit pending for Step 0.
- 2026-06-24: Step 1 complete. Baseline inventory found Panda still active in `package.json`, `panda.config.ts`, `doctor.config.json`, `documentation/developer/reference/scripts.md`, `src/theme/global.css`, `src/theme/recipes.ts`, `src/ui/components/ask-siargao.tsx`, `src/features/landing/LandingPage.tsx`, `src/features/chat/ChatWorkspace.tsx`, `src/features/report/FinalReportPage.tsx`, `src/features/admin/AdminDiagnosticsPage.tsx`, `src/features/public-pages/PublicKnowledgePage.tsx`, and `src/features/audit-status/AuditStatusPage.tsx`. Current shadcn inventory contains accordion, alert, badge, button, card, checkbox, dialog, dropdown-menu, field, input, label, progress, radio-group, select, separator, sheet, skeleton, sonner, spinner, switch, table, tabs, textarea, and tooltip. Registry search confirmed `sidebar`, `scroll-area`, `avatar`, `input-group`, `button-group`, `toggle-group`, `item`, `empty`, `breadcrumb`, `collapsible`, and `navigation-menu` are available from `@shadcn`. Validation passed: `bun run lint`, `bun run typecheck --incremental false`, `bun test`, `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, and `bun run test:e2e`. Commit pending for Step 1.

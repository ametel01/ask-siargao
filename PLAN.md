# Implementation Plan

## Source Documents
- Path: Inline user brief supplied in chat on 2026-06-24
  - Role: Primary migration brief.
  - Summary: Expand shadcn usage around real UI patterns, migrate Panda tokens into Tailwind/shadcn CSS variables, remove Panda completely, and preserve the current Ask Siargao brand colors.
- Path: `components.json`
  - Role: Current shadcn configuration.
  - Summary: Confirms the project uses the `radix-nova` shadcn style, Tailwind v4 CSS at `src/theme/global.css`, lucide icons, and `@/components/ui` aliases.
- Path: `package.json`
  - Role: Toolchain and dependency source of truth.
  - Summary: Shows Bun scripts, current Panda dependency and Panda-backed `dev`, `build`, and `postinstall` scripts that must be removed near the end of the migration.
- Path: `src/theme/tokens.ts`
  - Role: Current Panda brand-token source.
  - Summary: Defines the navy, violet, lavender, sunset, confidence, surface, text, risk, border, shadow, gradient, font, spacing, duration, and easing values that must be preserved in CSS variables.
- Path: `src/theme/global.css`
  - Role: Current global CSS and Tailwind/shadcn bridge.
  - Summary: Imports Tailwind, shadcn CSS, and generated Panda CSS, and defines shadcn CSS variables that should become the permanent brand-token bridge.

## Goals
- Remove Panda CSS completely from runtime code, generated assets, scripts, dependencies, and documentation.
- Preserve the existing Ask Siargao brand colors, gradients, shadows, typography intent, and dark coastal surface treatment.
- Expand shadcn integration with components that map to actual app patterns: sidebar, scroll-area, avatar, input-group, button-group, toggle-group, item, empty, breadcrumb, navigation-menu, and collapsible.
- Replace `styled-system` imports, `css()` calls, Panda recipes, and `token(...)` references with Tailwind v4 utilities, shadcn CSS variables, and small shadcn-backed local wrappers.
- Keep each migration slice buildable, reviewable, and covered by existing unit and Playwright gates.

## Non-Goals
- Rebranding or changing the current color palette.
- Rebuilding backend chat, audit, provider, payment, or database behavior.
- Replacing shadcn with a separate component library.
- Adding every situational shadcn component in the first pass; popover, hover-card, alert-dialog, form, combobox, command, chart, aspect-ratio, and carousel are optional follow-ups unless needed by a migration slice.
- Large product redesigns beyond preserving the current UI while changing the styling/component foundation.

## Assumptions and Open Questions
- Assumption: "Only use shadcn" means shadcn source components plus Tailwind v4 utilities and CSS variables, because shadcn is not a complete styling runtime by itself.
- Assumption: The existing brand colors in `src/theme/tokens.ts` are canonical and should be copied into `src/theme/global.css` before any Panda-generated CSS is removed.
- Assumption: New shadcn components should be added with `bunx shadcn@4.11.0 add @shadcn/<component>` and reviewed before use.
- Assumption: `navigation-menu` is useful for the landing header, but the implementation can defer it if a plain accessible nav remains simpler and closer to the current design.
- Open question: Should the final implementation keep `shadcn` as a dependency for future component additions, or use `shadcn eject` after the migration? Impact: keeping it simplifies future additions; ejecting reduces runtime/tooling dependency surface.
- Open question: Should generated screenshots be committed as visual baselines? Impact: Playwright currently asserts behavior and layout-critical text, but visual snapshots would add stricter design regression coverage.

## Quality Gates
- Setup status: Existing gates are configured in `package.json`, `biome.json`, `playwright.config.ts`, and `.github/workflows/ci.yml`; no separate quality-gate setup step is required.
- Baseline command: `bun run lint && bun run typecheck --incremental false && bun test && bun run db:migrate:test && bun run db:seed:test && bun run build && bun run test:e2e`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run typecheck --incremental false`, `bun run db:migrate:test`, `bun run db:seed:test`, `bun run build`, `bun run test:e2e`
- Optional UI health gate after React UI slices: `bun run doctor`

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create or reset `PROGRESS.md` for this migration before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step, validation results, commit reference if available, current status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Ensure `CHANGELOG.md` exists before implementation work begins.
- Initial content: Include `# Changelog`, the standard preamble, and an `## [Unreleased]` section if they are not already present.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with human-readable notable changes under the appropriate `Unreleased` change-type headings before creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress and changelog tracking for the shadcn/Panda migration.

Changes:
- Reset or update `PROGRESS.md` in the project root for the "Remove Panda and Expand shadcn Integration" plan.
- Add the plan title, source summary, a step checklist, current status, next step, and update log.
- Document that `PROGRESS.md` must be updated after every completed step.
- Confirm `CHANGELOG.md` follows Keep a Changelog 1.0.0 structure with `# Changelog`, the standard preamble, and `## [Unreleased]`.
- Add missing `CHANGELOG.md` structure only if needed; preserve existing historical entries.

Acceptance Criteria:
- `PROGRESS.md` describes this migration rather than the completed landing/chat plan.
- `CHANGELOG.md` keeps existing entries and has a valid `## [Unreleased]` section.

Validation:
- Confirm `PROGRESS.md` exists and contains the new step checklist.
- Confirm `CHANGELOG.md` exists and follows the required Keep a Changelog 1.0.0 structure.

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status, and identify the next step.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing shadcn/Panda migration tracking.

Commit:
- `chore: track shadcn panda migration progress`

### Step 1: Baseline Inventory and Gate Run
Goal: Establish a clean baseline and exact Panda-removal inventory before editing UI code.

Depends on:
- Step 0

Changes:
- Run the baseline quality-gate command to distinguish pre-existing failures from migration regressions.
- Capture the current Panda usage inventory with `rg` for `styled-system`, `@pandacss`, `panda`, `css(`, `pageShell`, and `token(`.
- Capture the current shadcn component inventory in `src/components/ui`.
- Run `bunx shadcn@4.11.0 search @shadcn -t ui --limit 200 --json` and record which requested components are available.
- Document the migration order and any discovered blockers in `PROGRESS.md`; avoid source changes beyond progress/changelog notes.

Acceptance Criteria:
- Baseline validation results are recorded.
- The Panda usage inventory identifies all files that must change before Panda can be removed.
- The shadcn registry inventory confirms the planned components are available or records substitutes.

Validation:
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with inventory notes, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with any notable planning or migration-inventory updates after validation and before committing.

Commit:
- `chore: record panda migration baseline`

### Step 2: Add shadcn Primitives and Brand CSS Variables
Goal: Install the missing shadcn primitives and move brand tokens into the Tailwind/shadcn CSS variable layer while Panda still exists as a fallback.

Depends on:
- Step 0
- Step 1

Changes:
- Add high-value shadcn components:
  - `@shadcn/sidebar`
  - `@shadcn/scroll-area`
  - `@shadcn/avatar`
  - `@shadcn/input-group`
  - `@shadcn/button-group`
  - `@shadcn/toggle-group`
  - `@shadcn/item`
  - `@shadcn/empty`
  - `@shadcn/breadcrumb`
  - `@shadcn/collapsible`
  - `@shadcn/navigation-menu` only if it remains a good fit after dry-run review.
- Review generated files in `src/components/ui` and keep them aligned with existing `radix-nova` conventions.
- Copy the canonical values from `src/theme/tokens.ts` into `src/theme/global.css` as plain CSS variables such as `--brand-navy-980`, `--brand-violet-650`, `--surface-tint`, `--text-strong`, `--confidence-high`, `--shadow-card`, `--gradient-cta`, and equivalent values for the existing token families.
- Map shadcn variables such as `--background`, `--foreground`, `--card`, `--card-foreground`, `--popover`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--accent`, `--border`, `--input`, `--ring`, `--sidebar`, and chart colors to brand variables.
- Add Tailwind v4 `@theme inline` entries for brand colors, surfaces, confidence colors, shadows, gradients, and fonts needed by migrated code.
- Keep `@import "../../styled-system/styles.css";` temporarily so unmigrated files continue to render.

Acceptance Criteria:
- Requested shadcn primitives exist in `src/components/ui` or documented alternatives are chosen.
- Brand variables in `global.css` can express all current Panda token values used by UI surfaces.
- Existing pages still render before page-level migrations begin.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completed primitive/token work, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with `Added` entries for new shadcn primitives and `Changed` entries for the brand CSS variable bridge.

Commit:
- `feat: add shadcn primitives and brand tokens`

### Step 3: Migrate Shared Ask Siargao Primitives off Panda
Goal: Remove Panda from shared brand primitives before migrating page surfaces.

Depends on:
- Step 0
- Step 1
- Step 2

Changes:
- Refactor `src/ui/components/ask-siargao.tsx` to use `cn`, Tailwind utilities, CSS variables, `Button`, `Badge`, and `Avatar` where appropriate.
- Preserve `BrandLockup`, `PalmMark`, `GradientLink`, `SignalBadge`, and `BrowserDots` public APIs unless a call-site review proves a small API change reduces duplication safely.
- Replace Panda `css()` and `cx()` usage with Tailwind class strings and `cn`.
- Ensure gradient CTA, badge tones, palm icon sizing, dark text colors, focus rings, and hover states match the current brand treatment.
- Add or update focused tests only if any behavior changes; otherwise rely on existing root/chat Playwright coverage that exercises these primitives.

Acceptance Criteria:
- `src/ui/components/ask-siargao.tsx` has no `styled-system`, `css()`, or Panda token references.
- Landing and chat pages still compile using the same shared primitive imports.
- Brand colors, focus states, and icon sizing are preserved.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with completed shared primitive work, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with a `Changed` entry for migrating shared Ask Siargao primitives from Panda to shadcn/Tailwind.

Commit:
- `refactor: migrate ask siargao primitives to shadcn`

### Step 4: Migrate Landing and Chat Surfaces to shadcn/Tailwind
Goal: Replace the highest-volume Panda UI code in the landing and chat experiences with shadcn primitives and Tailwind utilities.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3

Changes:
- Refactor `src/features/landing/LandingPage.tsx`:
  - Replace Panda `css()` helpers with Tailwind classes.
  - Use `Button`, `ButtonGroup`, `ToggleGroup`, `NavigationMenu`, `Card`, `Badge`, and existing shared brand primitives where they fit naturally.
  - Preserve hero background, prompt card, weather card, suggestion chips, trust row, feature cards, responsive behavior, and CTA routing.
- Refactor `src/features/chat/ChatWorkspace.tsx`:
  - Replace custom sidebar structure with `Sidebar` primitives where practical.
  - Use `ScrollArea` for message and panel overflow.
  - Use `Avatar` for traveler and assistant identity markers while preserving the palm mark.
  - Use `InputGroup` for the composer.
  - Use `ButtonGroup` or `ToggleGroup` for quick chips and mode-like controls where useful.
  - Preserve desktop three-column layout, mobile sheet behavior, evidence cards, weather/surf panels, composer affordances, and existing copy.
- Update `tests/e2e/root.e2e.ts` and `tests/e2e/chat.e2e.ts` only where selectors or accessible names need adjustment.
- Run a local browser check or Playwright screenshots at desktop and narrow widths to catch overflow or visual regressions.

Acceptance Criteria:
- `LandingPage.tsx` and `ChatWorkspace.tsx` no longer import from `styled-system`.
- Existing root and chat Playwright tests pass.
- The user-visible landing and chat experiences keep the current brand colors and layout intent.
- Mobile layout remains usable with no text overlap or horizontal overflow.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.
- Optionally run `bun run doctor` and record any advisory findings.

Progress:
- Update `PROGRESS.md` with completed landing/chat migration work, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with `Changed` entries for migrating landing and chat surfaces to shadcn/Tailwind.

Commit:
- `refactor: migrate landing and chat to shadcn`

### Step 5: Migrate Report, Admin, Public, and Status Surfaces
Goal: Remove Panda from the remaining feature surfaces and introduce shadcn components that improve repeated data/display patterns.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4

Changes:
- Refactor `src/features/report/FinalReportPage.tsx`:
  - Replace `pageShell`, `panel`, `compactCard`, list, label, body, and heading Panda helpers with Tailwind and shadcn `Card`, `Badge`, `Item`, `Collapsible`, and `Breadcrumb` where useful.
  - Preserve report hierarchy, risk badges, evidence references, and note sections.
- Refactor `src/features/admin/AdminDiagnosticsPage.tsx`:
  - Replace Panda helpers with Tailwind and shadcn `Card`, `Badge`, `Item`, `Empty`, `ScrollArea`, and `Collapsible`.
  - Add empty states for blocked audits, completeness failures, provider/job failures, reviewer rejections, cost drivers, and drill-down sections when arrays are empty.
- Refactor `src/features/public-pages/PublicKnowledgePage.tsx`:
  - Replace Panda helpers with Tailwind and shadcn `Card`, `Badge`, `Item`, and `Breadcrumb`.
  - Preserve JSON-LD script output and public claim rendering.
- Refactor `src/features/audit-status/AuditStatusPage.tsx`:
  - Replace Panda helpers with Tailwind and shadcn `Card`, `Alert`, `Progress`, `Item`, and existing status icons.
  - Preserve progress values, alert tone logic, and lifecycle copy.
- Add or update unit/browser tests only where user-visible output, empty states, or route behavior changes.

Acceptance Criteria:
- No feature file under `src/features` imports from `styled-system`.
- Admin diagnostics empty arrays render deliberate empty states instead of blank panels.
- Public JSON-LD and report/audit business content remain unchanged.
- Existing page tests and server tests pass.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.
- Optionally run `bun run doctor` and record any advisory findings.

Progress:
- Update `PROGRESS.md` with completed remaining surface migration work, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with `Changed` entries for migrating report, admin, public, and status surfaces to shadcn/Tailwind, plus `Added` entries for new empty states.

Commit:
- `refactor: migrate remaining surfaces from panda`

### Step 6: Remove Panda Configuration, Generated Output, Scripts, and Docs
Goal: Complete the Panda removal once no application code depends on it.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5

Changes:
- Remove `@import "../../styled-system/styles.css";` from `src/theme/global.css`.
- Delete `panda.config.ts`, `src/theme/tokens.ts`, `src/theme/recipes.ts`, and the generated `styled-system/` directory after confirming no imports remain.
- Remove `@pandacss/dev` from `package.json`.
- Update scripts in `package.json`:
  - `dev`: remove `panda codegen && panda cssgen &&`.
  - `dev:container`: remove `panda codegen && panda cssgen &&`.
  - `build`: remove Panda codegen/cssgen and keep a clean Next build.
  - `postinstall`: remove Panda generation or delete the script if no replacement is needed.
- Run `bun install` to update `bun.lock`.
- Update `doctor.config.json` so it no longer scans deleted Panda output or theme token files.
- Update `documentation/developer/reference/scripts.md`, `README.md`, and any docs that mention Panda generation or `styled-system`.
- Use `rg` to confirm no `styled-system`, `@pandacss`, `panda codegen`, `panda cssgen`, `pageShell`, `css(` from Panda imports, or `token(` references remain outside historical changelog/progress text.

Acceptance Criteria:
- The app installs, builds, and runs without Panda.
- `package.json` and `bun.lock` no longer include `@pandacss/dev`.
- No runtime source imports generated Panda files.
- Documentation reflects Tailwind/shadcn as the styling path.

Validation:
- Run `bun install`.
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.
- Run `rg -n "styled-system|@pandacss|panda codegen|panda cssgen|pageShell|token\\(" package.json src tests docs documentation README.md doctor.config.json`.

Progress:
- Update `PROGRESS.md` with completed Panda removal work, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with `Removed` entries for Panda CSS, generated `styled-system`, and Panda scripts/dependency, plus `Changed` entries for docs/script updates.

Commit:
- `refactor: remove panda styling runtime`

### Step 7: Final Regression, Visual Polish, and Handoff
Goal: Verify the full migration end to end and document any residual follow-up work.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3
- Step 4
- Step 5
- Step 6

Changes:
- Run the full gate list in the same order as CI.
- Run `bun run doctor` and triage any new high-confidence React issues introduced by the migration.
- Manually inspect or capture Playwright/browser screenshots for:
  - root landing page desktop and mobile widths,
  - `/chat` desktop and mobile widths,
  - admin diagnostics with empty and populated panels if fixtures are available,
  - audit status,
  - public knowledge pages,
  - final report page.
- Fix brand regressions, text overlap, inaccessible focus states, broken responsive layouts, or shadcn component misuse discovered during verification.
- Record any intentionally deferred situational shadcn components in `PROGRESS.md` and, if useful, a follow-up issue list.

Acceptance Criteria:
- Full CI-equivalent validation passes without Panda installed or generated.
- The current Ask Siargao brand palette is visually intact.
- No high-risk React Doctor findings remain untriaged.
- `PROGRESS.md` marks the migration complete and lists any follow-up opportunities.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run db:migrate:test`.
- Run `bun run db:seed:test`.
- Run `bun run build`.
- Run `bun run test:e2e`.
- Run `bun run doctor`.

Progress:
- Update `PROGRESS.md` with final validation results, commit reference if available, current status set to complete, and any follow-up notes.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with final user-visible or developer-visible migration notes after validation and before committing.

Commit:
- `chore: verify shadcn migration`

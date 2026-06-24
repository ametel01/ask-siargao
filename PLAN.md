# Implementation Plan

## Source Documents
- Path: `docs/LANDING_STYLE_REQUIREMENTS.md`
  - Role: Primary visual and interaction spec for the landing and chat mockups.
  - Summary: Defines the Ask Siargao brand, desktop landing layout, desktop chat workspace, mobile landing/chat adaptations, required copy, weather and confidence badges, and the browser-like frame treatment.
- Path: `docs/PRD.md`
  - Role: Product-direction source of truth.
  - Summary: Establishes the chat-first product frame, trip-pass positioning, user stories, and the requirement to replace the old audit-first intake flow with a natural-language assistant.
- Path: `docs/TECH.md`
  - Role: Technical architecture and stack guidance.
  - Summary: Confirms the Next.js App Router stack, shared UI direction, chat-first surfaces, and the expectation that the first screen accepts a trip plan or question instead of a long form.
- Path: `docs/DATA_STRATEGY.md`
  - Role: Supporting context for the freshness and confidence language used in the UI.
  - Summary: Explains the DB-first/freshness-first fact flow, the meaning of freshness windows, and the reason the mockups show live data, freshness, and confidence badges.
- Path: `documentation/developer/reference/routes-and-surfaces.md`
  - Role: Current route inventory that must be reconciled with the new product framing.
  - Summary: Shows the existing audit-first route wording that needs to be updated so the landing/chat surfaces and CTA routing do not conflict with the docs.

## Goals
- Replace the audit-first root experience with an Ask Siargao landing page that closely matches `design/web-landing.png`.
- Add a chat workspace surface that matches `design/web-chat-page.png` on desktop and the mobile mockup pattern in `design/mobile.png`.
- Keep the implementation responsive, accessible, and visually consistent across desktop and mobile breakpoints.
- Update route and product-facing docs so the repository no longer describes `/` as an audit intake entry point.

## Non-Goals
- Building the backend chat orchestration, fact retrieval, provider integrations, or payment flow.
- Changing database schema, data ingestion logic, or source-governance behavior.
- Reworking unrelated audit, public-page, or admin surfaces beyond any documentation references that would otherwise become stale.
- Inventing new product copy or UX beyond what the mockups and spec already prescribe.

## Assumptions and Open Questions
- Assumption: the chat workspace should live on a dedicated route such as `/chat`, with the landing page CTA opening that workspace.
- Assumption: the existing Sunset/palm imagery in the repo is the intended visual asset source unless the implementation discovers a better approved local asset.
- Open question: should the mobile mockup be delivered as one responsive experience or as separate landing/chat routes with mobile-specific layout rules?
- Open question: should the old audit-oriented route copy be fully removed from user-facing docs in this pass, or only updated where it directly conflicts with the new surfaces?

## Quality Gates
- Setup status: existing gates are already configured in `package.json`, `README.md`, and the release-QA docs; no extra gate scaffolding is required before implementation.
- Baseline command: `bun run lint && bun run typecheck --incremental false && bun test`
- Format command: `bun run format`
- Lint command: `bun run lint`
- Test command: `bun test`
- Additional gates: `bun run build`, `bun run test:e2e`

## Progress Tracking
- File: `PROGRESS.md`
- Requirement: Create `PROGRESS.md` before any quality-gate setup or implementation work begins.
- Update rule: After each step is completed, update `PROGRESS.md` with the completed step, validation results, commit reference if available, current status, and next step.

## Changelog Tracking
- File: `CHANGELOG.md`
- Standard: Keep a Changelog 1.0.0, <https://keepachangelog.com/en/1.0.0/>
- Requirement: Create `CHANGELOG.md` before any quality-gate setup or implementation work begins.
- Initial content: Include `# Changelog`, the standard preamble, and an `## [Unreleased]` section.
- Update rule: After each step is completed and validated, update `CHANGELOG.md` with human-readable notable changes under the appropriate `Unreleased` change-type headings before creating that step's commit.

## Incremental Steps

### Step 0: Progress and Changelog Tracking Setup
Goal: Create durable progress and changelog files the team can consult while the plan is being executed.

Changes:
- Create `PROGRESS.md` in the project root.
- Add the plan title and source-document summary.
- Add a step checklist with current status, next step, and a short update log.
- State that `PROGRESS.md` must be updated after every completed step.
- Create `CHANGELOG.md` in the project root before any implementation work begins.
- Add `# Changelog`, the Keep a Changelog preamble, and `## [Unreleased]` at the top.
- State that `CHANGELOG.md` must be updated after each validated step, before that step is committed.

Validation:
- Confirm `PROGRESS.md` exists and contains the step checklist.
- Confirm `CHANGELOG.md` exists and follows the required Keep a Changelog 1.0.0 structure.

Progress:
- Mark Step 0 complete in `PROGRESS.md`, record validation results, set the current status, and identify the next step.

Changelog:
- Add an `Added` entry under `## [Unreleased]` for establishing progress and changelog tracking.

Commit:
- `chore: add progress and changelog tracking files`

### Step 1: Reframe the Shared App Shell
Goal: Establish the Ask Siargao brand foundation that both the landing page and chat workspace will reuse.

Depends on:
- Step 0

Changes:
- Update `src/app/layout.tsx` metadata so the title and description no longer reference the audit-only product.
- Update `src/theme/global.css` and, if needed, `src/theme/tokens.ts` so the global surface supports the dark coastal frame, glass panels, violet glow, and serif headline treatment described in the mockups.
- Introduce or refactor shared shell components under `src/features/landing/` or a new shared UI module so the browser-like frame, top-left dots, dark canvas, and common CTA/chip/button patterns are not duplicated.
- Keep the existing design-system primitives as the source for shared button, badge, and card treatments whenever possible.

Acceptance Criteria:
- The root shell reads as Ask Siargao rather than the old audit product.
- Shared frame, typography, and button treatments are reusable by both the landing and chat surfaces.
- The app still boots cleanly and the baseline gate run passes after the refactor.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with the completed shell work, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with a concise `Changed` or `Added` note about the shared Ask Siargao shell and metadata refresh.

Commit:
- `feat: establish the ask siargao app shell`

### Step 2: Rebuild the Landing Page Mockup
Goal: Replace the current audit-first landing page with the desktop landing surface shown in `design/web-landing.png`.

Depends on:
- Step 0
- Step 1

Changes:
- Rework `src/features/landing/LandingPage.tsx` into smaller sections if needed so the desktop layout can match the header, hero, prompt card, weather card, chip row, trust row, and four feature cards from the mockup.
- Update `src/app/page.tsx` so the landing page remains the root entry and the primary CTA routes into the assistant workspace.
- Preserve the sunset/palm background composition and the darkened overlay so the hero remains readable while still recognizing the image.
- Ensure the landing page works at desktop and tablet widths without horizontal overflow.
- Add or update browser regression coverage in `tests/e2e/root.e2e.ts` for the root landing surface and its major sections.

Acceptance Criteria:
- The landing page copy, section order, and visual hierarchy align with the mockup and product brief.
- The prompt card, weather card, chips, and trust band are all present and visually distinct.
- The page remains responsive and keyboard-accessible.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with the completed landing work, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with a concise `Changed` or `Added` note describing the new Ask Siargao landing experience.

Commit:
- `feat: rebuild the ask siargao landing page`

### Step 3: Add the Chat Workspace and Mobile Layouts
Goal: Deliver the chat-first workspace and mobile presentation described by the desktop chat and mobile mockups.

Depends on:
- Step 0
- Step 1

Changes:
- Add a dedicated chat workspace route and component set, likely under `src/app/chat/page.tsx` and `src/features/chat/`, unless a route review shows a better existing surface.
- Build the desktop three-column workspace with a dark sidebar, light chat column, and right context sidebar, including the exact sections, message rhythm, badges, and sticky composer from the mockup.
- Build the mobile landing/chat presentation using responsive layout rules or a dedicated mobile route so the top bar, trip-context pill, dark message cards, and bottom composer match the mobile brief.
- Wire any CTA or navigation entry points so the landing page can open the assistant workspace cleanly.
- Add browser regression coverage for the chat workspace and at least one narrow viewport in a new or existing Playwright test.

Acceptance Criteria:
- The desktop workspace matches the mockup structure closely enough that the major layout regions and card types are recognizable at a glance.
- The mobile layout renders the correct stacked hierarchy and keeps the composer usable on small screens.
- The route choice is documented and does not conflict with the root landing page.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with the completed chat work, validation results, commit reference if available, current status, and next step.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with a concise `Added` or `Changed` note describing the new chat workspace and mobile experience.

Commit:
- `feat: add the ask siargao chat workspace`

### Step 4: Reconcile Docs and Regression Coverage
Goal: Bring repository documentation and route references into alignment with the new landing/chat surfaces.

Depends on:
- Step 0
- Step 1
- Step 2
- Step 3

Changes:
- Update `documentation/developer/reference/routes-and-surfaces.md` so `/` and the assistant workspace route(s) reflect the new product framing rather than the old audit intake wording.
- Update `README.md` and, if needed, `docs/README.md` so the overview and local entry points describe Ask Siargao as a chat-first product with landing and chat surfaces.
- Add or refine any page-level or component-level tests needed to lock in the mockup-critical copy, route targets, and responsive behavior.
- Re-run the release-candidate checks after the docs/test adjustments to confirm the repo is still green.

Acceptance Criteria:
- No user-facing or developer-facing route documentation still claims the root page is an audit intake form.
- The new UI surfaces have regression coverage that will fail if the route target, major layout regions, or copy regress materially.
- Final validation passes without needing follow-up documentation fixes.

Validation:
- Run `bun run format`.
- Run `bun run lint`.
- Run `bun run typecheck --incremental false`.
- Run `bun test`.
- Run `bun run build`.
- Run `bun run test:e2e`.

Progress:
- Update `PROGRESS.md` with the completed docs and regression work, validation results, commit reference if available, current status, and a note that the plan is complete.

Changelog:
- Update `CHANGELOG.md` under `## [Unreleased]` with a concise note summarizing the route/docs alignment and any regression coverage added.

Commit:
- `docs: align route references with ask siargao surfaces`

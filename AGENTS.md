# Repository Guidelines

## Project Structure & Module Organization

Ask Siargao is a Bun-powered Next.js App Router app. Pages and route handlers live in `src/app`, with larger UI surfaces under `src/features`. Shared UI primitives are in `src/components/ui`, theme CSS is in `src/theme`, and public assets are in `public`. Server-side domain code is grouped under `src/server` by concern, including `audit`, `chat`, `providers`, `payments`, `db`, and `security`. Database migrations are in `drizzle/`. Bun tests sit beside source files as `*.test.ts`; Playwright tests live in `tests/e2e` as `*.e2e.ts`.

## Build, Test, and Development Commands

- `bun install`: install dependencies from `bun.lock`.
- `bun run dev`: start the Next.js dev server.
- `bun run dev:up`: start local Postgres, migrate, seed, and run the dev server.
- `bun run build`: clean `.next` and build the production app.
- `bun run lint`: run the non-mutating Biome check used by CI.
- `bun run format`: write Biome formatting fixes.
- `bun run typecheck --incremental false`: run a clean TypeScript check.
- `bun test`: run Bun tests.
- `bun run test:e2e`: run Playwright tests against port `3100`.

## Coding Style & Naming Conventions

Use TypeScript with strict compiler settings and the `@/*` path alias for `src/*`. Biome enforces space indentation, 100-character line width, double quotes, semicolons, recommended lint rules, and import organization. Prefer explicit filenames such as `chat-route.ts`, `risk-engine.ts`, or `google-places-policy.test.ts`. React components use `PascalCase`; functions, variables, and route helpers use `camelCase`.

## Testing Guidelines

Add Bun tests next to the code they cover using `*.test.ts`. Put browser-level coverage in `tests/e2e/*.e2e.ts`. For database behavior, prefer the existing PGlite helpers and run `bun run db:migrate:test` plus `bun run db:seed:test`. Before merging broad changes, run lint, typecheck, Bun tests, database test migrate/seed, build, and e2e tests.

## Commit & Pull Request Guidelines

Recent commits use short imperative summaries, for example `Record chat and provider maintenance`. Keep commits focused and describe the behavior changed. Pull requests should include a concise summary, linked issue or plan when applicable, validation commands run, and screenshots for changed UI surfaces.

## Agent Team Review Preflight

Before a coordinator hands a PR to `maintainer-reviewer`, record the PR author, current draft state, intended formal approver identity, and whether GitHub can accept that approver's decision. The checker and maintainer-reviewer remain separate roles: checker evidence does not replace maintainer review, and reviewer preflight does not replace checker gates.

If GitHub cannot accept the intended formal approver because they are the PR author or otherwise ineligible, record that as an administrative blocker in `STATUS.md` with the next non-author human approver action. Do not classify the blocker as a code finding, do not treat a same-author `COMMENT` review as a formal approval, and do not weaken CI, quality gates, branch protection, or reviewer independence.

## Agent Team Evidence Review

When an issue or completion contract says an evidence tool must run before another tool, interpret that as a semantic ordering requirement: tool A completes before tool B starts unless the issue explicitly permits concurrency. Spec agents should turn ordered evidence wording, such as "event lookup before Places", into explicit acceptance criteria and required checker evidence.

Checker agents should inspect or require regressions that fail when a downstream evidence tool starts prematurely while upstream evidence is still pending. Broad green lint, typecheck, test, CI, or review gates do not replace this semantic check when evidence ordering is part of the contract.

For selected-artifact filtering fixes, checker agents should cover both omitted or auto-selected artifact paths and adversarial explicit mixed-selection paths when relevant. For chat recommendation cards, include mixed `displayCardIds` cases that combine allowed and disallowed cards.

If semantic ordering or artifact-selection checks are skipped, record them in `STATUS.md` as coverage gaps with the short reason, residual risk, and the next checker or maintainer action. Preserve checker independence, maintainer-review independence, #30 approver preflight, and all existing quality gates.

## Security & Configuration Tips

Keep secrets in `.env.local` and follow `documentation/developer/reference/environment.md`. Server-only keys must not use the `NEXT_PUBLIC_` prefix. Preserve Google Places field-mask, retention, and source-governance constraints when changing provider ingestion.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

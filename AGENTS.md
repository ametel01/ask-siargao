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

## Security & Configuration Tips

Keep secrets in `.env.local` and follow `documentation/developer/reference/environment.md`. Server-only keys must not use the `NEXT_PUBLIC_` prefix. Preserve Google Places field-mask, retention, and source-governance constraints when changing provider ingestion.

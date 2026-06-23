# Script Reference

Scripts are defined in `package.json`.

| Script | Command | Purpose |
| --- | --- | --- |
| `bun run dev` | `panda codegen && panda cssgen && next dev` | Generate Panda artifacts and run the local Next.js dev server. |
| `bun run build` | `panda codegen && panda cssgen && next build` | Generate Panda artifacts and build the production Next.js app. |
| `bun run db:migrate:test` | `bun run src/server/db/migrate-test.ts` | Apply the SQL migration to a PGlite test database. |
| `bun run db:seed:test` | `bun run src/server/db/seed-test.ts` | Seed Siargao taxonomy and source profiles into a PGlite test database. |
| `bun run format` | `biome format --write .` | Format the repository with Biome. |
| `bun run lint` | `biome check .` | Run Biome lint/checks. |
| `bun run typecheck` | `tsc --noEmit` | Run TypeScript type checking. |
| `bun test` | `bun test` | Run Bun unit and integration tests. |
| `bun run test:e2e` | `playwright test` | Run Playwright browser tests. |
| `bun run postinstall` | `panda codegen && panda cssgen` | Regenerate Panda artifacts after install. |

The release-candidate gate is:

```sh
bun run format
bun run lint
bun run typecheck
bun test
bun run db:migrate:test
bun run db:seed:test
bun run build
bun run test:e2e
```

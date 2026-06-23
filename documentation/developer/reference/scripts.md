# Script Reference

Scripts are defined in `package.json`.

| Script | Command | Purpose |
| --- | --- | --- |
| `bun run dev` | `panda codegen && panda cssgen && next dev` | Generate Panda artifacts and run the local Next.js dev server. |
| `bun run dev:container` | `panda codegen && panda cssgen && next dev -H 0.0.0.0` | Run the Next.js dev server inside the Compose app container. |
| `bun run stack:up` | `docker compose up -d` | Start the local full-stack Compose environment: Next.js app and Postgres. |
| `bun run stack:down` | `docker compose down` | Stop and remove the local Compose app and database containers while keeping volumes. |
| `bun run stack:down:volumes` | `docker compose down --volumes` | Stop the local Compose stack and remove its named volumes for a clean reset. |
| `bun run stack:logs` | `docker compose logs -f` | Follow logs from the local Compose app and database services. |
| `bun run stack:ps` | `docker compose ps` | Show local Compose service status. |
| `bun run build` | `panda codegen && panda cssgen && next build` | Generate Panda artifacts and build the production Next.js app. |
| `bun run db:migrate` | `bun run src/server/db/migrate.ts` | Apply the SQL migration to the Postgres database at `DATABASE_URL`. |
| `bun run db:seed` | `bun run src/server/db/seed.ts` | Seed Siargao taxonomy and source profiles into the Postgres database at `DATABASE_URL`. |
| `bun run db:migrate:test` | `bun run src/server/db/migrate-test.ts` | Apply the SQL migration to a PGlite test database. |
| `bun run db:seed:test` | `bun run src/server/db/seed-test.ts` | Seed Siargao taxonomy and source profiles into a PGlite test database. |
| `bun run format` | `biome format --write .` | Write Biome formatting fixes. |
| `bun run lint` | `biome check .` | Run the non-mutating Biome check used by CI. |
| `bun run typecheck` | `tsc --noEmit` | Run TypeScript type checking. |
| `bun test` | `bun test` | Run Bun unit and integration tests. |
| `bun run test:e2e` | `playwright test` | Run Playwright browser tests. |
| `bun run postinstall` | `panda codegen && panda cssgen` | Regenerate Panda artifacts after install. |
| `bun run doctor` | `npx react-doctor@latest` | Run the advisory React Doctor scan locally. |

The release-candidate gate is:

```sh
bun run lint
bun run typecheck --incremental false
bun test
bun run db:migrate:test
bun run db:seed:test
bun run build
bun run test:e2e
```

`bun run format` is a fix command, not a verification gate.

# Script Reference

Scripts are defined in `package.json`.

| Script | Command | Purpose |
| --- | --- | --- |
| `bun run dev` | `next dev` | Run the local Next.js dev server. |
| `bun run dev:up` | `docker compose up -d db && db:migrate && db:seed && next dev` | Start local Postgres in Docker, migrate/seed it, then run the host Next.js dev server. This is the preferred local chatbot workflow. |
| `bun run dev:container` | `next dev -H 0.0.0.0` | Run the Next.js dev server inside the Compose app container. |
| `bun run stack:up` | `docker compose up -d db` | Start only the local Postgres service. Use this before host `bun run dev` when database-backed chat behavior is needed. |
| `bun run stack:app:up` | `docker compose --profile app up -d` | Start the opt-in full Compose app container as well as Postgres. Do not run this at the same time as host `bun run dev` on port `3000`. |
| `bun run stack:down` | `docker compose down` | Stop and remove the local Compose app and database containers while keeping volumes. |
| `bun run stack:down:volumes` | `docker compose down --volumes` | Stop the local Compose stack and remove its named volumes for a clean reset. |
| `bun run stack:logs` | `docker compose logs -f` | Follow logs from the local Compose app and database services. |
| `bun run stack:ps` | `docker compose ps` | Show local Compose service status. |
| `bun run build` | `rm -rf .next && NEXT_PRIVATE_BUILD_WORKER=0 ./node_modules/.bin/next build` | Build the production Next.js app from a clean Next output directory. |
| `bun run db:migrate` | `bun run src/server/db/migrate.ts` | Apply the SQL migration to the Postgres database at `DATABASE_URL`. |
| `bun run db:seed` | `bun run src/server/db/seed.ts` | Seed Siargao taxonomy and source profiles into the Postgres database at `DATABASE_URL`. |
| `bun run db:discover:google-places` | `bun run src/server/providers/discover-google-places.ts` | Run the free Google Places Text Search ID-only discovery pass for Siargao accommodations and persist dedupable place candidates into `source_records` and `candidate_entities`. Requires `GOOGLE_API_KEY`, `DATABASE_URL`, and a seeded `source_google_places` profile. Add `-- --dry-run` to fetch and print a summary without writing rows. |
| `bun run db:enrich:google-places` | `bun run src/server/providers/enrich-google-places.ts` | Enrich discovered Google Places candidates with Place Details Pro fields: display name, address, location, types, business status, and Google Maps URI. Requires `GOOGLE_API_KEY`, `DATABASE_URL`, and prior `db:discover:google-places` rows. Add `-- --dry-run` to fetch and print a sample without writing rows. |
| `bun run db:prune:google-places` | `bun run src/server/jobs/prune-google-places.ts` | Delete expired Google Places review, detail, and snapshot rows from Postgres at `DATABASE_URL` while preserving durable `google_places` identity rows. Add `-- --dry-run` to count rows without deleting. |
| `bun run db:ingest:open-meteo` | `bun run src/server/providers/ingest-open-meteo.ts` | Fetch the Siargao Open-Meteo forecast and persist source records, weather facts, evidence, scores, and a refresh job into Postgres at `DATABASE_URL`. |
| `bun run db:migrate:test` | `bun run src/server/db/migrate-test.ts` | Apply the SQL migration to a PGlite test database. |
| `bun run db:seed:test` | `bun run src/server/db/seed-test.ts` | Seed Siargao taxonomy and source profiles into a PGlite test database. |
| `bun run format` | `biome format --write .` | Write Biome formatting fixes. |
| `bun run lint` | `biome check .` | Run the non-mutating Biome check used by CI. |
| `bun run typecheck` | `tsc --noEmit` | Run TypeScript type checking. |
| `bun test` | `bun test` | Run Bun unit and integration tests. |
| `bun run test:e2e` | `playwright test` | Run Playwright browser tests. |
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

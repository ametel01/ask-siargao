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
| `bun run db:migrate` | `bun run src/server/db/migrate.ts` | Apply unapplied SQL migrations to the Postgres database at `DATABASE_URL` through the `schema_migrations` ledger. |
| `bun run db:seed` | `bun run src/server/db/seed.ts` | Seed Siargao taxonomy and source profiles into the Postgres database at `DATABASE_URL`. |
| `bun run db:discover:google-places` | `bun run src/server/providers/discover-google-places.ts` | Run the free Google Places Text Search ID-only discovery pass for Siargao accommodations and persist dedupable place candidates into `source_records` and `candidate_entities`. Requires `GOOGLE_API_KEY`, `DATABASE_URL`, and a seeded `source_google_places` profile. Add `-- --dry-run` to fetch and print a summary without writing rows. |
| `bun run db:enrich:google-places` | `bun run src/server/providers/enrich-google-places.ts` | Enrich discovered Google Places candidates with Place Details Pro fields: display name, address, location, types, business status, and Google Maps URI. Requires `GOOGLE_API_KEY`, `DATABASE_URL`, and prior `db:discover:google-places` rows. Add `-- --dry-run` to fetch and print a sample without writing rows. |
| `bun run db:prune:google-places` | `bun run src/server/jobs/prune-google-places.ts` | Delete expired Google Places review, detail, and snapshot rows from Postgres at `DATABASE_URL` while preserving durable `google_places` identity rows. Add `-- --dry-run` to count rows without deleting, `-- --batch-size <rows>` to tune each delete batch, and `-- --max-batches <count>` to cap work per table for one run. |
| `bun run db:ingest:open-meteo` | `bun run src/server/providers/ingest-open-meteo.ts` | Fetch the Siargao Open-Meteo forecast and persist source records, weather facts, evidence, scores, and a refresh job into Postgres at `DATABASE_URL`. |
| `bun run db:ingest:open-meteo-marine` | `bun run src/server/providers/ingest-open-meteo-marine.ts` | Fetch the Siargao Open-Meteo Marine forecast and persist modelled sea-level, wave, swell, and current facts into Postgres at `DATABASE_URL`. This is tide-proxy model data, not official tide-gauge or safety authority data. |
| `bun run agent-memory:sync` | `bun run src/server/chat/sync-agent-memory-vector-store.ts` | Sync reference-role `docs/agent-memory/` files to an OpenAI vector store for chat-agent file search. Use `bun run agent-memory:sync -- --dry-run` for local/CI verification without network access. Non-dry-run sync requires `OPENAI_API_KEY`; pass `-- --vector-store-id <id>` or set `OPENAI_AGENT_MEMORY_VECTOR_STORE_ID` to reuse an existing store. The command prints the vector store ID to configure and never prints raw memory file bodies. |
| `bun run db:migrate:test` | `bun run src/server/db/migrate-test.ts` | Apply unapplied SQL migrations to a PGlite test database through the same ledger runner. |
| `bun run db:seed:test` | `bun run src/server/db/seed-test.ts` | Seed Siargao taxonomy and source profiles into a PGlite test database. |
| `bun run format` | `biome format --write .` | Write Biome formatting fixes. |
| `bun run lint` | `biome check .` | Run the non-mutating Biome check used by CI. |
| `bun run typecheck` | `tsc --noEmit` | Run TypeScript type checking. |
| `bun run verify` | `bun run lint && bun run typecheck --incremental false && bun test` | Run the fast non-mutating local verification gate. |
| `bun run verify:ci` | `bun run verify && bun run db:migrate:test && bun run db:seed:test && bun run build && bun run test:e2e` | Run the full CI-equivalent release gate locally. |
| `bun test` | `bun test` | Run Bun unit and integration tests. |
| `bun run test:e2e` | `playwright test` | Run Playwright browser tests. |
| `bun run doctor` | `npx react-doctor@latest` | Run the advisory React Doctor scan locally. |

The release-candidate gate is:

```sh
bun run verify:ci
```

`bun run format` is a fix command, not a verification gate. `bun run verify` and `bun run verify:ci` are non-mutating verification commands.

## Migration Ledger Behavior

`bun run db:migrate` creates `schema_migrations` when needed and records each applied migration
file by filename, SHA-256 checksum, and applied timestamp. Repeat runs skip rows whose filename and
checksum already match the ledger, so historical SQL files are not re-executed.

The production Postgres command takes a deterministic advisory lock before ledger checks and
releases it after success or failure. Each unapplied migration runs in a transaction unless the SQL
contains a statement PostgreSQL cannot run transactionally, such as `CREATE INDEX CONCURRENTLY`.

The runner fails before applying new work when the ledger contains an unknown migration, when the
ledger is not an ordered prefix of the migration files, or when an applied migration file checksum no
longer matches the recorded checksum. Logs include applied and skipped migration names and keep
`DATABASE_URL` credentials redacted.

Treat applied files in `drizzle/` as append-only historical records. Do not casually edit an applied
migration to "clean up" DDL or fold in a later schema tweak: a database that already recorded that
file will fail with a checksum mismatch, while a database without the ledger history may execute the
edited SQL as different bootstrap behavior. Put new schema changes in a new numbered migration, and
document any intentional checksum recovery as an operator action with backups and ledger review.

For read-only duplicate-index and unused-index review SQL, see
`documentation/developer/reference/database-index-audits.md`. The #65 hot-path index migration is
additive only and does not drop indexes.

## Google Places Retention Pruning

Schedule `bun run db:prune:google-places` as a recurring maintenance job against the production
`DATABASE_URL`. The job removes expired rows from `google_place_reviews`, `google_place_details`,
and `google_place_snapshots`; it does not remove durable `google_places` identity rows.

Start with a dry run:

```sh
bun run db:prune:google-places -- --dry-run
```

Dry runs count expired rows and print the same per-table progress shape as delete runs, but never
delete rows. The output includes review, detail, snapshot, and total row counts, batch counts, and
whether expired rows remain after the run.

Delete runs use bounded batches to keep locks, WAL bursts, and rollback scope smaller on large
tables:

```sh
bun run db:prune:google-places -- --batch-size 500 --max-batches 20
```

Both options must be positive integers. `--batch-size` defaults to `500`, and `--max-batches`
defaults to `20` per table. If output says more expired rows remain, rerun the command or schedule
another maintenance window with the same controls. Expired reviews are always cleaned up before
snapshot deletion starts; if the review pass reaches `--max-batches` and still has expired rows,
snapshot deletion is skipped for that run and the output reports remaining snapshot work.

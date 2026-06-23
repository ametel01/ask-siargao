# Build The Data Pipeline With Local Postgres

Use this guide to move the autonomous Siargao fact graph from test fixtures to a local Postgres-backed ingestion pipeline, then promote the same schema to cloud Postgres after the first vertical slice works.

The order matters. Start with the Docker Compose local stack so migrations, seed data, source governance, ingestion adapters, confidence scoring, and payment gating can be changed cheaply. Provision cloud Postgres only after the local pipeline can ingest, normalize, score, and gate a narrow set of facts.

## Current Repo Baseline

The codebase already has these pieces:

- Drizzle schema definitions in `src/server/db/schema.ts`.
- An initial SQL migration at `drizzle/0000_initial_schema.sql`.
- Test migration and seed scripts that use PGlite, not external Postgres.
- Siargao taxonomy in `src/server/audit/destinations/siargao/taxonomy.ts`.
- Source governance primitives in `src/server/providers/source-registry.ts`.
- Seed source profiles for official transport, Open-Meteo, and user-submitted evidence.
- Fact governance, scoring, conflict detection, and a completeness gate skeleton.

The local Compose stack is now available. The remaining production-readiness pieces are:

- A production migration command wired to `DATABASE_URL`.
- A local ingestion runner that persists normalized source records, facts, evidence, candidates, matches, scores, conflicts, and refresh jobs into Postgres.
- A cloud Postgres promotion process.

## Step 1: Set Up Docker Compose Postgres Locally

Use the local Docker Compose stack as the first shared integration target. PGlite is useful for fast tests, but Compose Postgres is closer to the production database that `createDatabaseClient` expects through `DATABASE_URL`.

The local stack is defined in `docker-compose.yml`:

- `db`: Postgres 16 with the same local credentials as `.env.example`.
- `app`: the Bun/Next.js app, which serves both the frontend and App Router API backend on port `3000`.

Start the full local stack:

```sh
bun run stack:up
```

Check container state through the package script:

```sh
bun run stack:ps
```

Follow logs when the app is starting or installing dependencies:

```sh
bun run stack:logs
```

Shut the local stack down:

```sh
bun run stack:down
```

Expected result: the app is available at `http://localhost:3000`, and Postgres is available on host port `5432` with `DATABASE_URL=postgres://user:password@localhost:5432/siargao_portal`.

## Step 2: Add Migrations For The Core Fact-Graph Tables

The schema already defines the core fact-graph tables:

- `source_profiles`
- `source_permissions`
- `raw_snapshots`
- `source_records`
- `candidate_entities`
- `entity_matches`
- `facts`
- `evidence`
- `fact_confidence_scores`
- `source_credibility_scores`
- `fact_conflicts`
- `refresh_jobs`
- `provider_health_checks`
- `public_page_generation_jobs`
- `public_pages`
- `public_evidence_bundles`
- `agent_readable_snapshots`

The current test command applies `drizzle/0000_initial_schema.sql` to PGlite:

```sh
bun run db:migrate:test
```

For Compose Postgres, add a production/local migration command that applies migrations to `DATABASE_URL`. The command should be separate from the PGlite test command so local integration and fast tests stay independent.

Implementation task:

- Add a migration script such as `src/server/db/migrate.ts` that reads `DATABASE_URL`.
- Add a package script such as `db:migrate`.
- Apply the same migration files that tests apply, rather than maintaining a second schema path.
- Fail fast when `DATABASE_URL` is missing.

Verification:

```sh
bun run db:migrate
```

Then inspect tables using a Postgres client.

```sh
psql "$DATABASE_URL" -c "\dt"
```

Expected result: the core fact-graph and audit tables exist in Compose Postgres.

## Step 3: Seed Siargao Geography And Taxonomy

The first seed should be stable destination data, not volatile provider data. The current taxonomy source is `siargaoTaxonomy`, which includes:

- Areas: General Luna, Cloud 9, Malinao, Dapa, and Del Carmen.
- Routes: Sayak Airport to General Luna, Dapa Port to General Luna, and Surigao City to Dapa Ferry.
- Risk categories.
- Provider categories.
- Practical service categories.
- Optional risk modules.

The current seed command writes areas, routes, providers, and source profiles into the PGlite test database:

```sh
bun run db:seed:test
```

For Compose Postgres, add a seed command that writes the same stable data to `DATABASE_URL`.

Implementation task:

- Add a production/local seed script such as `src/server/db/seed.ts`.
- Reuse `siargaoTaxonomy` instead of duplicating seed values.
- Seed providers before source profiles because `source_profiles.provider_id` references `providers.id`.
- Make seed writes idempotent with `on conflict`.
- Seed only stable destination data and explicit source profiles.

Verification:

```sh
bun run db:seed
psql "$DATABASE_URL" -c "select id, slug, name from areas order by slug;"
psql "$DATABASE_URL" -c "select id, allowed_use, authority_level from source_profiles order by id;"
```

Expected result: the local Postgres database contains the stable Siargao taxonomy and explicit source profiles before any ingestion job runs.

## Step 4: Build One Adapter First

Start with one low-risk adapter. Do not begin with broad web scraping or OTA pages.

Recommended first adapter:

- Open-Meteo for weather facts, because it is already represented by `openMeteoAdapter` and is suitable for forecast or historical weather facts.

Alternative first adapter:

- A manually profiled official/static source for transport or public-sector facts, using `officialTransportAdapter`.

Adapter requirements:

- Require an explicit source profile before fetching or inserting facts.
- Respect `allowedUse`, raw storage, republication, citation, and audit-use decisions.
- Normalize provider payloads into `source_records`.
- Insert `raw_snapshots` only when `storesRawAllowed` is true.
- Extract small atomic facts into `facts`.
- Create supporting `evidence` rows.
- Set `expires_at` from the source or fact freshness window.
- Create or update `refresh_jobs` when data is stale, conflicted, or required for an active audit.

Open-Meteo first-slice facts can be narrow:

- Current forecast fetched for Siargao.
- Forecast freshness timestamp.
- Daily rain or wind risk for audit dates.
- Weather facts that expire in one day.

Verification:

- The adapter refuses unknown source profiles.
- The adapter refuses disallowed source profiles.
- Public-republish weather facts can appear in public pages only when confidence and freshness pass.
- Audit-only or citation-only facts do not leak into public agent-readable surfaces.

Useful current tests:

```sh
bun test src/server/providers/source-governance.test.ts
```

## Step 5: Run Ingestion Locally And Inspect Records

Run ingestion against Compose Postgres after migrations and seed data are in place. The first ingestion runner should be explicit and narrow. Avoid background scheduling until the insert path is understandable.

Implementation task:

- Add a command such as `db:ingest:local` or `ingest:open-meteo`.
- Insert one batch into these tables in this order where applicable:
  - `raw_snapshots`
  - `source_records`
  - `candidate_entities`
  - `entity_matches`
  - `facts`
  - `evidence`
  - `source_credibility_scores`
  - `fact_confidence_scores`
  - `fact_conflicts`
  - `refresh_jobs`
- Use deterministic IDs for seed and fixture-style data so reruns are idempotent.
- Use provider IDs for API-backed data when available.

Inspect the local database after each run:

```sh
psql "$DATABASE_URL" -c "select id, source_profile_id, entity_type, name, fetched_at from source_records order by fetched_at desc limit 20;"
psql "$DATABASE_URL" -c "select id, fact_type, confidence_label, expires_at, public_republish_allowed, audit_use_allowed from facts order by created_at desc limit 20;"
psql "$DATABASE_URL" -c "select id, label, public_republish_allowed from evidence order by created_at desc limit 20;"
```

Expected result:

- Every source record points to a registered source profile.
- Every fact has evidence or a clear evidence gap.
- Facts have freshness metadata.
- Public flags match source permissions.
- Re-running the same ingestion command does not create duplicate logical records.

## Step 6: Add Confidence, Freshness, And The Completeness Gate

The paid audit flow must not charge unless critical facts are fresh enough and confident enough. The current completeness gate already blocks on missing dates, route/origin, top constraint, unresolved area, and low accommodation match confidence. Extend it to query the fact graph.

Add deterministic checks for:

- Required fact types for the requested audit.
- Fact freshness by type.
- Fact confidence threshold.
- Source permission eligibility for paid audits.
- Critical conflicts.
- Required targeted refresh jobs.
- User-followup questions when evidence can realistically unblock the audit.

Initial required fact types:

- Weather for the travel dates or travel month.
- Arrival route facts for the selected origin or route.
- Accommodation area resolution when an accommodation name is provided.
- Area/service facts for the user's top constraint.

Payment rule:

- Run targeted refresh before Stripe Checkout.
- Recompute completeness after refresh.
- Allow checkout only when `checkoutEligible` is true.
- Return clear blocking reasons instead of charging when critical facts are missing, stale, conflicted, or below confidence.

Verification:

```sh
bun test src/app/api/audit/checkout/route.test.ts
bun test src/server/audit/domain.test.ts
bun test src/server/providers/source-governance.test.ts
```

Expected result: checkout remains blocked when critical facts are missing or stale, and only fresh permitted evidence can make an audit payment-eligible.

## Step 7: Provision Cloud Postgres After The Local Slice Works

Provision cloud Postgres only after the local Compose slice can:

- Run migrations.
- Seed source profiles and taxonomy.
- Ingest one adapter.
- Store normalized records, facts, and evidence.
- Score source credibility and fact confidence.
- Detect or tolerate conflicts.
- Run the completeness gate before checkout.
- Generate at least one public or internal fact-backed surface from the same data.

Use the same Postgres major version selected for Compose Postgres. The local stack uses Postgres 16, so provision a Postgres 16-compatible managed database unless there is a deliberate reason to change both local and cloud together.

Cloud setup requirements:

- Dedicated database per environment.
- Server-only `DATABASE_URL`.
- SSL configured according to provider requirements.
- Automated backups enabled.
- Point-in-time recovery enabled if available.
- Separate credentials for app runtime and migrations if the provider supports it.
- No test or demo secrets in production env vars.

Do not migrate cloud first. Cloud should receive a schema that already survived local ingestion and audit-gate validation.

## Step 8: Run Migrations Against Cloud And Promote The Pipeline

Promotion should be boring: the same schema and scripts that passed locally run against the cloud `DATABASE_URL`.

Promotion sequence:

1. Set the cloud `DATABASE_URL` in the deployment environment.
2. Run migrations against the cloud database.
3. Run stable seed data.
4. Run the first adapter with conservative provider budgets.
5. Inspect source records, facts, evidence, confidence scores, and refresh jobs.
6. Run checkout/completeness tests against a staging deployment or staging database.
7. Enable scheduled refresh only after the manual ingestion run is clean.
8. Keep public page generation behind visibility gates until source permissions and confidence are verified.

Verification queries:

```sh
psql "$DATABASE_URL" -c "select count(*) from source_profiles;"
psql "$DATABASE_URL" -c "select fact_type, confidence_label, count(*) from facts group by fact_type, confidence_label order by fact_type, confidence_label;"
psql "$DATABASE_URL" -c "select result_status, count(*) from refresh_jobs group by result_status;"
```

Promotion gates:

- No source with `allowed_use = 'disallowed'` has source records.
- No private user-submitted evidence is public-republishable.
- Critical facts needed for checkout have `audit_use_allowed = true`.
- Public pages use only public-republishable facts.
- Refresh jobs are idempotent and have bounded retry behavior.
- Provider failures are observable through logs or health checks.

## First Vertical Slice

The first useful end-to-end slice should be small:

- Local Compose app and Postgres stack running.
- Initial schema migrated.
- Siargao taxonomy seeded.
- Open-Meteo or official transport source profile seeded.
- One adapter inserts one normalized source record.
- The adapter creates one or more atomic facts and evidence rows.
- Freshness and confidence are computed.
- The completeness gate can use those facts to allow or block checkout.
- Public output is generated only when `public_republish_allowed` and confidence gates pass.

Do not expand to Google Places, Tripadvisor, Agoda, or broad public web ingestion until source terms, storage rights, citation rights, and republication rights are explicitly modeled in `source_profiles` and `source_permissions`.

## Rollback And Cleanup

For local Compose Postgres, reset only the local development volumes when you intentionally want a clean database:

```sh
bun run stack:down:volumes
```

For cloud Postgres, do not reset or drop data as a normal development tactic. Use migrations, backups, and environment-specific databases.

## Done Criteria

This phase is complete when:

- Docker Compose Postgres is the local integration database.
- Migrations run against both local Compose Postgres and cloud Postgres.
- Stable seed data is idempotent.
- One permitted adapter populates source records, facts, and evidence.
- Confidence and freshness are stored and inspectable.
- The completeness gate blocks payment when critical facts are missing or stale.
- Cloud Postgres uses the same major version and schema as local.
- Public facts remain permission-gated.

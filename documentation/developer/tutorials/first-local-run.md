# First Local Run

This tutorial gets a fresh checkout to a working local app with seeded test data.

## Prerequisites

- Bun
- A shell that can run the scripts in `package.json`
- No external Postgres service is required for the test migration and seed commands; they use PGlite.

## Steps

1. Install dependencies.

```sh
bun install
```

2. Create a local environment file.

```sh
cp .env.example .env.local
```

Keep placeholder secrets in local development unless you are testing a real provider. The test and browser suites use mocked or synthetic data for the release-candidate path.

3. Run the local test migration and seed commands.

```sh
bun run db:migrate:test
bun run db:seed:test
```

The seed command loads Siargao taxonomy, route records, and source profiles for official transport, Open-Meteo-style weather, and user-submitted evidence.

4. Start the app.

```sh
bun run dev
```

For database-backed chat behavior, start Postgres, migrate/seed it, and run the host dev server:

```sh
bun run dev:up
```

5. Open the main QA surfaces.

- `/`
- `/chat`
- `/audits/audit_123/status?state=awaiting_payment`
- `/audits/demo/report`
- `/admin/diagnostics`
- `/accommodations/example-surf-stay`
- `/accommodations/example-surf-stay/llm.md`
- `/api/public/accommodations/example-surf-stay.json`
- `/sitemap.xml`
- `/llms.txt`
- `/robots.txt`

## Expected Result

The landing page renders the Ask Siargao prompt, weather, suggestion, trust, and feature-card sections. The `/chat` workspace renders the assistant mockup with desktop and mobile layouts. The sample report renders with evidence IDs and limitations, public pages expose only republishable facts, and private audit/admin routes remain marked for noindex behavior.

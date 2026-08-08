# Developer Documentation

Use these pages when working on the Ask Siargao codebase.

- [First local run](tutorials/first-local-run.md): install dependencies, prepare local env, seed the test database, and start the app.
- [Build the data pipeline with local Postgres](how-to-guides/build-the-data-pipeline-with-local-postgres.md): use Docker Compose Postgres before cloud Postgres to validate migrations, seed data, ingestion, confidence, freshness, and audit gating.
- [Operate the production database](how-to-guides/operate-the-production-database.md): provision, monitor, maintain, back up, and restore the production Postgres database.
- [Run release-candidate QA](how-to-guides/run-release-candidate-qa.md): validate the release candidate across product, security, public, and operational surfaces.
- [Extend a Reality Check kind](how-to-guides/extend-a-reality-check-kind.md): add or change an on-demand decision category without weakening evidence ordering, artifact selection, compatibility, or privacy.
- [Environment reference](reference/environment.md): environment variables read by the app.
- [Script reference](reference/scripts.md): Bun scripts and quality gates.
- [Routes and surfaces reference](reference/routes-and-surfaces.md): app pages, API routes, public machine-readable surfaces, and private surfaces.
- [Reality Check contract reference](reference/reality-check-contract.md): kinds, verdicts, proposal fields, validation reasons, source states, and public summary compatibility.
- [Database authorization reference](reference/database-authorization.md): production database roles, grants, and runtime/migration credential boundaries.
- [Demo data reference](reference/demo-data.md): synthetic and permitted local QA fixtures.
- [Clerk auth and account lifecycle](reference/clerk-auth-session-chat-history-requirements.md): as-built sign-in, session, profile, webhook, closure, monitoring, and rollback behavior.
- [Audit lifecycle and boundaries](explanation/audit-lifecycle-and-boundaries.md): how intake, payment, generation, public data, and privacy boundaries fit together.
- [Database row-level security decision](explanation/database-row-level-security-decision.md): why table RLS is deferred and what must be tested before activation.
- [Chat agent routing and source governance](explanation/chat-agent-routing-and-source-governance.md): how model-owned tool choice, provider failures, artifacts, and source-label validation fit together.
- [On-demand Reality Check lifecycle](explanation/on-demand-reality-check-lifecycle.md): how explicit requests, evidence ordering, validation, public projection, persistence, and provider failure form one synchronous chat turn.
- [Siargao chatbot data pipeline](explanation/siargao-chatbot-data-pipeline.md): product direction and lazy fact acquisition model for the chat-first tour-operator assistant.
- [Web research layer](explanation/web-research-layer.md): background on public-web evidence, source scoring, provider failure, and how `research_web` complements Places, weather, and memory.

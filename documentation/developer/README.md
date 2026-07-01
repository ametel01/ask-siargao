# Developer Documentation

Use these pages when working on the Ask Siargao codebase.

- [First local run](tutorials/first-local-run.md): install dependencies, prepare local env, seed the test database, and start the app.
- [Build the data pipeline with local Postgres](how-to-guides/build-the-data-pipeline-with-local-postgres.md): use Docker Compose Postgres before cloud Postgres to validate migrations, seed data, ingestion, confidence, freshness, and audit gating.
- [Run release-candidate QA](how-to-guides/run-release-candidate-qa.md): validate the release candidate across product, security, public, and operational surfaces.
- [Environment reference](reference/environment.md): environment variables read by the app.
- [Script reference](reference/scripts.md): Bun scripts and quality gates.
- [Routes and surfaces reference](reference/routes-and-surfaces.md): app pages, API routes, public machine-readable surfaces, and private surfaces.
- [Demo data reference](reference/demo-data.md): synthetic and permitted local QA fixtures.
- [Clerk auth, session, chat history, profile, and rating requirements](reference/clerk-auth-session-chat-history-requirements.md): technical requirements for authenticated user state and persisted chat features.
- [Audit lifecycle and boundaries](explanation/audit-lifecycle-and-boundaries.md): how intake, payment, generation, public data, and privacy boundaries fit together.
- [Chat agent routing and source governance](explanation/chat-agent-routing-and-source-governance.md): how model-owned tool choice, provider failures, artifacts, and source-label validation fit together.
- [Siargao chatbot data pipeline](explanation/siargao-chatbot-data-pipeline.md): product direction and lazy fact acquisition model for the chat-first tour-operator assistant.
- [Web research layer](explanation/web-research-layer.md): background on public-web evidence, source scoring, provider failure, and how `research_web` complements Places, weather, and memory.

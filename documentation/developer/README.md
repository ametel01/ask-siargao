# Developer Documentation

Use these pages when working on the Ask Siargao codebase.

- [First local run](tutorials/first-local-run.md): install dependencies, prepare local env, seed the test database, and start the app.
- [Build the data pipeline with local Postgres](how-to-guides/build-the-data-pipeline-with-local-postgres.md): use Docker Compose Postgres before cloud Postgres to validate migrations, seed data, ingestion, confidence, freshness, and audit gating.
- [Run Siargao field research](how-to-guides/run-siargao-field-research.md): collect standardized first-hand observations from an iPad, run a Del Carmen-based baseline itinerary, and prepare private reviewable batches without treating uploads as facts.
- [Use the offline field ingestion desk](how-to-guides/use-offline-field-ingestion-desk.md): transfer iPad exports explicitly, validate them without internet access, resolve local conflicts and permission blocks, and export a record-only staging envelope without writing to PostgreSQL.
- [Operate the production database](how-to-guides/operate-the-production-database.md): provision, monitor, maintain, back up, and restore the production Postgres database.
- [Run release-candidate QA](how-to-guides/run-release-candidate-qa.md): validate the release candidate across product, security, public, and operational surfaces.
- [Launch the free product](how-to-guides/launch-free-product.md): authorize Free Controlled Beta and promote it to General Free Availability under explicit traffic, cost, monitoring, and rollback controls.
- [Launch Trip Pass](how-to-guides/launch-trip-pass.md): authorize the mandatory Checkout Canary and later General Paid Availability using exact-candidate evidence and independent approval.
- [Extend a Reality Check kind](how-to-guides/extend-a-reality-check-kind.md): add or change an on-demand decision category without weakening evidence ordering, artifact selection, compatibility, or privacy.
- [Environment reference](reference/environment.md): environment variables read by the app.
- [Script reference](reference/scripts.md): Bun scripts and quality gates.
- [Routes and surfaces reference](reference/routes-and-surfaces.md): app pages, API routes, public machine-readable surfaces, and private surfaces.
- [Reality Check contract reference](reference/reality-check-contract.md): kinds, verdicts, proposal fields, validation reasons, source states, and public summary compatibility.
- [Database authorization reference](reference/database-authorization.md): production database roles, grants, and runtime/migration credential boundaries.
- [Free Controlled Beta accountability](reference/free-controlled-beta-accountability.md): assigned launch-preparation owners, approved spending limits, and the independent-approver blocker.
- [Production vendor register](reference/production-vendor-register.md): production suppliers, data categories, regions, retention, contract evidence, deletion routes, incident contacts, and secret-rotation state.
- [Planning guide analytics](reference/planning-guide-analytics.md): privacy-safe guide views, Reality Check click handoffs, event fields, and PostHog views.
- [Field research data model](reference/field-research-data-model.md): proposed capture, batch, evidence, consent, review, admission, and editorial-link tables for governed first-hand observations.
- [Siargao fieldwork official source pack](reference/siargao-fieldwork-source-pack-2026-08-16.md): dated official anchors, unresolved field questions, safety and protected-area boundaries, and iPad capability references for the first Del Carmen-based campaign.
- [Monitoring and recovery drill — 2026-08-11](reference/monitoring-and-recovery-drill-2026-08-11.md): Sentry, emergency-stop, rollback, PlanetScale restore, RPO/RTO, and rotation evidence plus remaining launch blockers.
- [Exact-candidate evidence — 2026-08-11](reference/exact-candidate-evidence-2026-08-11.md): Foundation, provider, capacity, headroom, circuit, health, Cron, rollback, restore, and alert results for commit `4b03367c604344fa0514510bdcedc635cb15f7bf`.
- [Demo data reference](reference/demo-data.md): synthetic and permitted local QA fixtures.
- [Clerk auth and account lifecycle](reference/clerk-auth-session-chat-history-requirements.md): as-built sign-in, session, profile, webhook, closure, monitoring, and rollback behavior.
- [Audit lifecycle and boundaries](explanation/audit-lifecycle-and-boundaries.md): how intake, payment, generation, public data, and privacy boundaries fit together.
- [Database row-level security decision](explanation/database-row-level-security-decision.md): why table RLS is deferred and what must be tested before activation.
- [Chat agent routing and source governance](explanation/chat-agent-routing-and-source-governance.md): how model-owned tool choice, provider failures, artifacts, and source-label validation fit together.
- [Improving AI answer quality beyond general assistants](explanation/improving-ai-answer-quality-beyond-general-assistants.md): prioritized gaps and product investments for making Siargao answers measurably better than general-assistant responses.
- [Qualified Discovery strategy](explanation/qualified-discovery-strategy.md): approved product identity, editorial trust, search representation, privacy-safe attribution, and evidence-gated visibility rollout.
- [On-demand Reality Check lifecycle](explanation/on-demand-reality-check-lifecycle.md): how explicit requests, evidence ordering, validation, public projection, persistence, and provider failure form one synchronous chat turn.
- [Siargao chatbot data pipeline](explanation/siargao-chatbot-data-pipeline.md): product direction and lazy fact acquisition model for the chat-first tour-operator assistant.
- [Web research layer](explanation/web-research-layer.md): background on public-web evidence, source scoring, provider failure, and how `research_web` complements Places, weather, and memory.
- [Production deployment infrastructure assessment](explanation/production-deployment-infrastructure-assessment-2026-08-10.md): required web, data, job, provider, monitoring, and recovery infrastructure plus the current production-readiness boundary.
- [Whole-application production-readiness assessment](explanation/whole-application-production-readiness-assessment-2026-08-09.md): point-in-time readiness of the free product, Trip Pass, security, monitoring, features, and release evidence.

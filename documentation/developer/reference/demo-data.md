# Demo Data Reference

Release-candidate QA uses synthetic or permitted local fixtures.

## Local Test Database

`bun run db:seed:test` inserts:

- Siargao areas from `src/server/audit/destinations/siargao/taxonomy.ts`
- Siargao routes from the same taxonomy module
- Source profiles for official transport, Open-Meteo-style weather, and user-submitted evidence

## UI Fixtures

- `/audits/demo/report` renders `sampleReport` from `src/server/audit/sample-report.ts`.
- Public pages use the fixture `PublicPageRepository` from `src/server/public-pages/public-content.ts`, built from persisted-page-shaped records with public evidence bundle IDs and source fact IDs.
- Admin diagnostics use `createSampleDiagnosticsSnapshot` from `src/server/admin/diagnostics.ts`.
- `releaseCandidateDemoScenario` in `src/server/qa/release-candidate-demo.ts` lists the release-candidate QA paths and fixture boundaries.

## First Provider Ingestion Slice

The first provider ingestion slice uses local verified accommodation records from the public tourism directory profile. The source type is `official`, the allowed use is `public_republish`, raw provider payload storage is not allowed, public republication is allowed, and the freshness window is 30 days.

This slice creates governed accommodation-area facts and public evidence labels through `SourceRegistry`, `normalizeSourceRecord`, `createGovernedFact`, and `createGovernedEvidence`. It can improve paid-audit completeness only when the resolved accommodation candidate is audit-eligible and at least medium confidence. Low-confidence, disallowed, or weak-match candidates remain blocked and require user follow-up evidence.

## Data Boundary

The demo fixtures are not provider scrapes. Public fixtures must use republishable facts and critical public evidence. Private audit fixtures may include user-submitted evidence labels, but public pages must not expose private paid audit data, raw provider payloads, traveler inputs, or restricted evidence.

# Demo Data Reference

Release-candidate QA uses synthetic or permitted local fixtures.

## Local Test Database

`bun run db:seed:test` inserts:

- Siargao areas from `src/server/audit/destinations/siargao/taxonomy.ts`
- Siargao routes from the same taxonomy module
- Source profiles for official transport, Open-Meteo-style weather, and user-submitted evidence

## UI Fixtures

- `/audits/audit_123/report` renders `sampleReport` from `src/server/audit/sample-report.ts`.
- Public pages use `publicKnowledgePages` from `src/server/public-pages/public-content.ts`.
- Admin diagnostics use `createSampleDiagnosticsSnapshot` from `src/server/admin/diagnostics.ts`.
- `releaseCandidateDemoScenario` in `src/server/qa/release-candidate-demo.ts` lists the release-candidate QA paths and fixture boundaries.

## Data Boundary

The demo fixtures are not provider scrapes. Public fixtures must use republishable facts and critical public evidence. Private audit fixtures may include user-submitted evidence labels, but public pages must not expose private paid audit data, raw provider payloads, traveler inputs, or restricted evidence.

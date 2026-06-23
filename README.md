# Siargao Portal

Siargao Portal is a Next.js App Router application for the Siargao Trip Risk Audit: a paid, evidence-backed feasibility audit that charges only after the system can complete the report to the promised standard.

Current implementation covers the landing and intake flow, completeness gating, Stripe Checkout boundaries, mocked audit generation and reviewer contracts, final report rendering, public knowledge pages, admin diagnostics, observability hooks, privacy controls, rate limits, and release-candidate QA notes.

## Documentation

- [Developer documentation](documentation/developer/README.md)
- [Release-candidate QA checklist](documentation/developer/how-to-guides/run-release-candidate-qa.md)
- [Environment reference](documentation/developer/reference/environment.md)
- [Routes and surfaces reference](documentation/developer/reference/routes-and-surfaces.md)

## Local Entry Points

Use the developer docs for the full local run path. The short version is:

```sh
bun install
cp .env.example .env.local
bun run db:migrate:test
bun run db:seed:test
bun run dev
```

Quality gates:

```sh
bun run format
bun run lint
bun run typecheck
bun test
bun run build
bun run test:e2e
```

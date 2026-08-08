# Ask Siargao

Ask Siargao is a Next.js App Router application for on-demand Siargao Reality Checks. Travelers
submit an accommodation, itinerary, immediate plan, surf session, or disrupted plan, and the app
returns a structured keep/change/avoid/needs-confirmation decision using request-time evidence,
governed local knowledge, and explicit source limits. Ordinary Siargao travel questions remain
supported, while the chat scope guard politely declines clearly unrelated topics.

The root experience presents the Ask Siargao landing page and links into the interactive assistant at
`/chat`. Reality Checks run only after explicit message submission; opening the app does not start
agent work. The codebase still includes earlier audit/report surfaces and a free-to-paid Trip Pass
allowance around the same request-driven chat product.

## Documentation

- [Developer documentation](documentation/developer/README.md)
- [Trip Pass user reference](documentation/user/reference/trip-pass.md)
- [Release-candidate QA checklist](documentation/developer/how-to-guides/run-release-candidate-qa.md)
- [Environment reference](documentation/developer/reference/environment.md)
- [Routes and surfaces reference](documentation/developer/reference/routes-and-surfaces.md)
- [Reality Check contract](documentation/developer/reference/reality-check-contract.md)
- [On-demand Reality Check lifecycle](documentation/developer/explanation/on-demand-reality-check-lifecycle.md)

## Local Entry Points

Use the developer docs for the full local run path. The short version is:

Use Bun `1.3.13`, matching `package.json` and CI.

```sh
bun install
cp .env.example .env
bun run db:migrate:test
bun run db:seed:test
bun run dev
```

Primary browser surfaces:

- `/`: Ask Siargao landing page.
- `/chat`: interactive Ask Siargao assistant and on-demand Reality Check workspace.
- `/audits/demo/report`: legacy synthetic audit report fixture.
- `/admin/diagnostics`: local operator diagnostics.

Quality gates:

```sh
bun run verify
bun run verify:ci
```

`bun run verify` is the fast non-mutating local check. `bun run verify:ci` mirrors the full CI release gate, including test database validation, build, and Playwright. Run `bun run format` only when you want Biome to write formatting fixes.

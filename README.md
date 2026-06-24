# Ask Siargao

Ask Siargao is a Next.js App Router application for a chat-first Siargao tour-operator assistant. Travelers paste a trip plan or ask practical questions, and the app answers with fresh local data, normalized facts, confidence, and source-aware constraints.

The root experience now presents the Ask Siargao landing page and links into a static assistant workspace at `/chat`. The codebase still includes earlier audit/report surfaces while the broader product direction shifts toward a free preview chat plus a paid Siargao Trip Pass with bounded live data refreshes.

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

Primary browser surfaces:

- `/`: Ask Siargao landing page.
- `/chat`: Ask Siargao assistant workspace mockup.
- `/audits/demo/report`: legacy synthetic audit report fixture.
- `/admin/diagnostics`: local operator diagnostics.

Quality gates:

```sh
bun run lint
bun run typecheck --incremental false
bun test
bun run db:migrate:test
bun run db:seed:test
bun run build
bun run test:e2e
```

`bun run lint` is the non-mutating Biome check used by CI. Run `bun run format` only when you want Biome to write formatting fixes.

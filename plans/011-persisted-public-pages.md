# Plan 011: Generate public pages from persisted governed facts

> **Executor instructions**: Follow this plan step by step. This is a direction/spike plan: prefer a narrow vertical slice over a broad rewrite. Run every verification command and confirm the expected result before moving to the next step. If anything in the "STOP conditions" section occurs, stop and report. When done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 43b43ca..HEAD -- src/server/public-pages src/app/llms.txt/route.ts src/app/sitemap.xml/route.ts src/app/api/public src/app/accommodations src/app/areas src/app/routes src/app/operators src/app/risks src/server/db/schema.ts docs/PRD.md documentation/developer/explanation/audit-lifecycle-and-boundaries.md`
> If any in-scope file changed since this plan was written, compare the "Current state" excerpts against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M/L
- **Risk**: MED
- **Depends on**: `plans/001-drizzle-schema-parity.md`, `plans/006-governed-public-eligibility.md`
- **Category**: direction
- **Planned at**: commit `43b43ca`, 2026-06-23

## Why this matters

Public answer-engine visibility is a first-class product strategy, but current public pages are five static fixture records. The docs say public human pages, LLM Markdown, JSON APIs, JSON-LD, sitemap, and `llms.txt` should come from normalized public fact records. This plan creates the first persisted governed public-page generation path without compromising no-cloaking or private-data boundaries.

## Current State

- `src/server/public-pages/public-content.ts` owns static public pages and output builders.
- Public routes call `renderPublicHumanPage`, `publicMarkdownResponse`, and `publicJsonResponse`.
- `src/app/llms.txt/route.ts` and `src/app/sitemap.xml/route.ts` use builders from the static array.
- SQL migration already has `public_pages`, `public_evidence_bundles`, and `agent_readable_snapshots`.

Relevant excerpts:

```ts
// src/server/public-pages/public-content.ts:44
export const publicKnowledgePages: PublicKnowledgePage[] = [
```

```ts
// src/app/llms.txt/route.ts:4
return new Response(buildLlmsTxt(), {
```

```sql
-- drizzle/0000_initial_schema.sql:322
CREATE TABLE IF NOT EXISTS public_pages (
```

```md
<!-- documentation/developer/explanation/audit-lifecycle-and-boundaries.md:15 -->
Public accommodation, area, route, operator, and risk pages are generated from normalized public fact records.
```

Product constraints:

- Public pages may include only facts allowed for public republication.
- Human HTML, LLM Markdown, JSON APIs, JSON-LD, sitemap, and `llms.txt` must not materially diverge.
- Public pages must not expose private audit data, raw provider payloads, non-republishable facts, low-confidence facts, or weak entity matches.

## Commands You Will Need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Public tests | `bun test src/server/public-pages/public-content.test.ts` | exit 0 |
| E2E | `bun run test:e2e` | exit 0 |
| Typecheck | `bun run typecheck --incremental false` | exit 0 |
| Full tests | `bun test` | exit 0 |

## Scope

**In scope**:

- `src/server/public-pages/`
- `src/app/llms.txt/route.ts`
- `src/app/sitemap.xml/route.ts`
- `src/app/api/public/**`
- Public page route files under `src/app/accommodations`, `src/app/areas`, `src/app/routes`, `src/app/operators`, `src/app/risks`
- Tests for public page generation
- Developer docs for the new generation path

**Out of scope**:

- Real provider ingestion; plan 010 covers that.
- Redesigning public page UI.
- Publishing private paid reports.
- Adding a crawler or scheduled refresh worker.
- Broad SEO/content strategy beyond one persisted vertical slice.

## Git Workflow

- Branch: `advisor/011-persisted-public-pages`
- Commit message style: `feat: generate public pages from governed facts`
- Do not push or open a PR unless instructed.

## Steps

### Step 1: Define a repository-backed public page source

Create a public-page repository interface that can return `PublicKnowledgePage` records from persisted `public_pages`, `public_evidence_bundles`, facts, and evidence. Keep a fixture-backed implementation for tests or local demo only if needed.

The route/builders should depend on the interface, not directly on a static array.

**Verify**: `bun run typecheck --incremental false` -> exit 0.

### Step 2: Build one vertical persisted fixture

Seed or construct one public page family from governed facts, preferably the existing `accommodations/example-surf-stay` fixture. The path should produce the same data for:

- human page
- LLM Markdown
- JSON API
- JSON-LD
- sitemap
- `llms.txt`

The same underlying facts must drive every format.

**Verify**: `bun test src/server/public-pages/public-content.test.ts` -> exit 0 after tests are updated.

### Step 3: Enforce eligibility before output

Use the eligibility logic from plan 006. Ensure repository-backed pages exclude:

- private user data
- raw provider payloads
- non-republishable facts/evidence
- low-confidence facts
- weak entity matches

Add tests with blocked facts to prove they do not reach any output builder.

**Verify**: `bun test src/server/public-pages/public-content.test.ts` -> exit 0.

### Step 4: Preserve route behavior and e2e coverage

Update public routes to use the repository-backed source. Keep current public URLs working:

- `/accommodations/example-surf-stay`
- `/accommodations/example-surf-stay/llm.md`
- `/api/public/accommodations/example-surf-stay.json`
- `/sitemap.xml`
- `/llms.txt`

Update Playwright tests only as needed to match the new data source.

**Verify**: `bun run test:e2e` -> exit 0.

### Step 5: Document the generation boundary

Update developer docs to explain:

- where persisted public pages come from
- how eligibility is enforced
- how fixture/demo pages differ from production generated pages
- how no-cloaking is maintained across output formats

**Verify**: `rg -n "public pages|agent-readable|governed facts" documentation/developer docs` -> docs mention the persisted generation path.

### Step 6: Run gates

**Verify**:

- `bun run lint` -> exit 0
- `bun run typecheck --incremental false` -> exit 0
- `bun test` -> exit 0
- `bun run test:e2e` -> exit 0

## Test Plan

Extend `src/server/public-pages/public-content.test.ts` to prove all formats are generated from the same fact set. Keep the Playwright public-surface test in `tests/e2e/root.e2e.ts` as the browser/API smoke test.

## Done Criteria

- [ ] At least one public page is generated from persisted governed facts rather than only the static array.
- [ ] Human, Markdown, JSON, JSON-LD, sitemap, and `llms.txt` use the same underlying facts.
- [ ] Eligibility blocks private, restricted, raw, low-confidence, and weak-match facts before output.
- [ ] Existing public URLs continue to work.
- [ ] `bun run lint`, `bun run typecheck --incremental false`, `bun test`, and `bun run test:e2e` exit 0.
- [ ] No files outside the in-scope list are modified.
- [ ] `plans/README.md` status row updated.

## STOP Conditions

Stop and report back if:

- Plan 001 has not added typed schema for public-page tables.
- Plan 006 has not established governed public eligibility.
- The only way to make a public page is to expose non-republishable source content.
- The work expands into a full refresh/worker system.
- Verification fails twice after reasonable fix attempts.

## Maintenance Notes

This plan should leave a narrow vertical slice, not a full content platform. Reviewers should inspect no-cloaking, eligibility, and private-data boundaries before approving.


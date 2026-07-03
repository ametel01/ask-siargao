# Database Hardening Progress

This file tracks the production database readiness work from issue #61 through issue #72. Update
it after each completed step with validation results, commit references when available, current
status, and the next implementation step.

## Sources

- GitHub issue sequence: #61 through #72.
- Source plan: `PLAN.md`, generated from the July 3, 2026 production database readiness brief.
- Changelog policy: `CHANGELOG.md` follows Keep a Changelog 1.0.0 and is updated only for
  validated functional changes.

## Current Status

- Current step: #61 Initialize database hardening progress tracking.
- Status: complete.
- Next step: #62 Make database migrations ledger-backed.
- Last updated: 2026-07-03.

## Step Checklist

| Issue | Step | Status | Dependency state | Notes |
| --- | --- | --- | --- | --- |
| #61 | Initialize database hardening progress tracking | Complete | Unblocked root step | Created this progress tracker and verified the existing changelog structure. |
| #62 | Make database migrations ledger-backed | Pending | Ready; #61 complete | Next implementation step. |
| #63 | Guard historical bootstrap migration behavior | Blocked | Blocked by #62; #61 complete | Must build on the ledger-backed migration runner. |
| #64 | Add database constraints and foreign key indexes | Blocked | Blocked by #62; #61 complete | Requires production-safe migrations first. |
| #65 | Add hot path indexes and index audit guidance | Blocked | Blocked by #62 and #64; #61 complete | Depends on constraint/index groundwork. |
| #66 | Bound database-backed list queries | Blocked | Blocked by #65; #61 complete | Depends on hot-path index work. |
| #67 | Normalize public page evidence relationships | Blocked | Blocked by #62 and #64; #61 complete | Requires migration and constraint groundwork. |
| #68 | Batch saved-trip and provider write paths | Blocked | Blocked by #64; #61 complete | Depends on database constraint/index groundwork. |
| #69 | Batch Google Places retention cleanup | Blocked | Blocked by #65; #61 complete | Depends on hot-path index work. |
| #70 | Define production database connection options | Pending | Ready; #61 complete | Can proceed after tracking setup. |
| #71 | Document database authorization boundaries | Blocked | Blocked by #62; #61 complete | Requires migration posture before role/grant documentation. |
| #72 | Add database operations runbook | Blocked | Blocked by #65, #69, #70, and #71; #61 complete | Final runbook depends on earlier operational controls. |

## Validation Evidence

- `CHANGELOG.md` inspection: Existing file contains `# Changelog`, a Keep a Changelog 1.0.0
  preamble, an `## [Unreleased]` section, and no empty category headings.
- `PROGRESS.md` inspection: This file lists every database hardening issue from #61 through #72,
  marks #61 complete, identifies #62 as the next step, and records later blockers from the GitHub
  dependency graph.
- `bun run lint`: Passed after installing missing local dependencies with `bun install`.
  - First attempt: failed before linting because `node_modules` was absent and `biome` was not
    found.
  - Subsequent attempts passed, with Biome checking 285 files and reporting no fixes applied.

## Update Log

- 2026-07-03: Completed #61 tracking setup and lint validation. No `CHANGELOG.md` entry was added
  because this step is non-functional tracking scaffolding.

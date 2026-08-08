# Trip Pass Migration Coordination

Issue #145 reserves the migration sequence for the Auth and Trip Pass Production Readiness
milestone. The latest published immutable migration before operations is
`0015_paid_answer_retention_retry.sql`; do not edit `drizzle/0000_initial_schema.sql` through that
file. Operations findings, repair audit, paging delivery, and generic worker leases use additive
`0016_operational_findings_and_repair.sql`.

## Reserved Sequence

| Migration | Owner | Scope |
| --- | --- | --- |
| `0009` | #147 | Identity caches plus expand-first closure tombstone, operation, and write-barrier state. |
| `0010` | #148 | Product Family checkout reservation/invariant and consent state. |
| `0011` | #149 | Normalized Stripe inbox and expanded Order lifecycle. |
| `0012` | #151 | Terminal Account Closure orchestration, Retained Commerce Evidence, and cleanup state. |
| `0013` | #152 | Refund, dispute, Paid After Closure, and retry state. |
| `0014` | #153 | Paid Answer Reservation and retention-expiry state. |
| `0015` | #153 | Paid Answer retention retry scheduling metadata, constraints, and due-work index. |
| `0016` | #154 | Opaque operations findings, Repair Action audit, Sentry delivery, and durable provider-neutral worker leases. |
| `0016_preflight` | #154 | Late-discovered duplicate-Finding convergence that sorts before immutable `0017`; safe as a no-op on ledgers already through `0017`. |
| `0017` | #154 | Stable incident lifecycles and database-time Sentry delivery leases, added without rewriting `0016`. |
| `0018` | #154 | Repair command identity/indexes and monotonic reconciliation observation fencing, added without rewriting `0016` or `0017`. |

Issues #155-#156 must not reuse migrations owned by #154. Any newly discovered schema need is
coordinator-assigned after this reserved sequence instead of being folded into an applied or
already-reserved file. The next available coordinator-assigned number is `0019`.

The migration ledger validates every known filename/checksum independently so an additive preflight
can be discovered after a database recorded `0017`. On a database stopped at `0016`, lexical order
runs the preflight before `0017`; on a database already through `0017`, the same preflight detects
the incident columns and no-ops before `0018`. Unknown files and checksum drift still fail closed.

## Expand-First Rules

All SQL files are additive and immutable once introduced. Application code must tolerate old and new
rows during rolling deployment, including nullable columns, dual-read/write transitions, and
retryable background work.

Destructive cleanup, physical purge, constraint tightening that can reject existing rows, and legacy
data removal require a later separately reviewed migration or bounded worker. Rollback means a
compatible code rollback plus forward repair; do not reverse privacy, payment, entitlement, purge, or
commerce-evidence records.

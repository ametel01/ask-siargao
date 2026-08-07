# Trip Pass Migration Coordination

Issue #145 reserves the migration sequence for the Auth and Trip Pass Production Readiness
milestone. The latest applied migration is `0008_trip_pass_commerce_ledger.sql`; do not edit
`drizzle/0000_initial_schema.sql` through `drizzle/0008_trip_pass_commerce_ledger.sql`.

## Reserved Sequence

| Migration | Owner | Scope |
| --- | --- | --- |
| `0009` | #147 | Identity caches plus expand-first closure tombstone, operation, and write-barrier state. |
| `0010` | #148 | Product Family checkout reservation/invariant and consent state. |
| `0011` | #149 | Normalized Stripe inbox and expanded Order lifecycle. |
| `0012` | #152 | Refund, dispute, Paid After Closure, and retry state. |
| `0013` | #153 | Paid Answer Reservation and retention-expiry state. |

Issues #146, #150, #151, and #154-#156 must not independently guess, reserve, or reuse a migration
number. Issue #151 consumes the expand-first state introduced by #147. Any newly discovered schema
need is coordinator-assigned after this reserved sequence instead of being folded into an applied or
already-reserved file.

## Expand-First Rules

All SQL files are additive and immutable once introduced. Application code must tolerate old and new
rows during rolling deployment, including nullable columns, dual-read/write transitions, and
retryable background work.

Destructive cleanup, physical purge, constraint tightening that can reject existing rows, and legacy
data removal require a later separately reviewed migration or bounded worker. Rollback means a
compatible code rollback plus forward repair; do not reverse privacy, payment, entitlement, purge, or
commerce-evidence records.

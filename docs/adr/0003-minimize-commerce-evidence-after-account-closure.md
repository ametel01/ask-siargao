# Minimize commerce evidence after account closure

After Account Closure, Ask Siargao will retain only account-detached commerce facts needed for
accounting, chargebacks, and Stripe reconciliation: product and policy versions, consent evidence,
amount/currency, lifecycle status and timestamps, refund/dispute outcomes, required Stripe
object/event identifiers, and aggregate Usage Meter totals. Email, Clerk linkage, Stripe Customer
ID, request identifiers and hashes, provider request identifiers, per-request usage history, and raw
Stripe payloads will be removed; per-request details also expire for active accounts after an
approved operational window. Every retained record receives a versioned Commerce Retention Policy
and explicit purge deadline; production commerce has no indefinite-retention fallback, while
durations remain subject to privacy, legal, and accounting approval. Legacy Trip Risk Audit inputs,
runs, reports, and diagnostics follow the Erasable Product Data policy, while legacy payments follow
this minimized boundary after Operators inventory existing records and approve a backed-up
migration. Immutable backups are not selectively edited, but remain access-restricted, expire on an
approved maximum schedule, and cannot serve restored production traffic until Closure Tombstones
and expired-retention purges have been reapplied.

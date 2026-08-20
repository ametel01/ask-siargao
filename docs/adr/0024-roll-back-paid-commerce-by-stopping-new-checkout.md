# Roll back paid commerce by stopping new checkout and converging forward

Paid Commerce Rollback sets `TRIP_PASS_CHECKOUT_MODE=off`, which stops only new Trip Pass Orders and
Checkout Attempts. Verified access, signed webhook ingestion, refunds, Account Closure work,
Commerce Reconciliation, retention purge, and audited repair continue forward. Rollback never
reactivates Stripe, deletes durable evidence, reverses migrations, or changes already-verified
access merely because new checkout is unavailable.

# Identify payment event receipts from normalized facts

Because the active Payment Authority does not document a unique webhook delivery ID, Ask Siargao
identifies each verified Payment Event Receipt with a deterministic fingerprint of the provider,
event name, object identity, provider update time, status, amount, and refunded amount. The system
persists that fingerprint and normalized facts before acknowledging delivery, never retains the raw
payload, deduplicates exact retries, and treats later lifecycle changes as distinct receipts; this
supersedes the Stripe Event ID dependency in ADR-0004.

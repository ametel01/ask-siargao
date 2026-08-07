# Meter paid answers by durable result

Ask Siargao will reserve one Travel Answer Usage Meter unit before paid answer generation and
finalize it only after a complete, policy-compliant assistant answer is durably stored. Terminal
failures and safety refusals release the Paid Answer Reservation, while a stored answer counts even
if delivery is interrupted and remains retrievable through the same idempotency key. This accepts
temporary allowance holds and a recovery process for stale reservations to prevent concurrent
overspend without charging for requests that produce no durable product value.

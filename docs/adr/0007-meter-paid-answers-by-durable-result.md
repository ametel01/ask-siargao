# Meter paid answers by durable result

Ask Siargao will reserve one Travel Answer Usage Meter unit before paid answer generation and
finalize it only after a complete, policy-compliant assistant answer is durably stored. Terminal
failures and safety refusals release the Paid Answer Reservation, while a stored answer counts even
if delivery is interrupted and remains retrievable through the same idempotency key. This accepts
temporary allowance holds and a recovery process for stale reservations to prevent concurrent
overspend without charging for requests that produce no durable product value.

The `durable-travel-answer` module owns this invariant through one domain seam. It checks exposure
and idempotency, selects free or paid allowance, generates and assembles the public turn, stores the
Travel Answer, settles or releases its reservation, and returns any durable replay. The HTTP chat
adapter may parse requests, frame JSON or NDJSON delivery, and record transport latency, but it does
not coordinate those domain steps.

Paid settlement and assistant-history storage remain one database transaction. The stored response
body is the replay source of truth, so retrying an idempotency key neither regenerates the answer nor
increments the Usage Meter. Free answers may retain deferred assistant-history storage because they
do not convert a Paid Answer Reservation into Usage.

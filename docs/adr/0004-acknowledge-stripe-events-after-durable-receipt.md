# Acknowledge Stripe events after durable receipt

Ask Siargao will acknowledge a verified Stripe event after its versioned normalized, unique ledger
record is durably committed, not after all business state has been applied. Events with missing
prerequisites remain pending for internal retry and targeted Stripe retrieval; unsupported event
shapes remain blocked and Operator-visible rather than silently applied or ignored. Signature
failures or failures to persist return non-success, while immediate state application commits the
event outcome, Trip Pass Order, Trip Pass, Trip Pass Grant, and Usage Meters atomically. This
prevents provider retry storms without acknowledging events that exist only in memory.

Provider retrieval is not part of the application transaction. A worker first claims the durable
inbox row, resolves the authoritative Stripe object without holding database locks, then revalidates
the same unexpired claim while atomically applying the fact and marking the inbox row applied. A
crash or claim takeover discards the stale resolution and leaves the durable receipt replayable.

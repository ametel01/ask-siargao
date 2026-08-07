# Acknowledge Stripe events after durable receipt

Ask Siargao will acknowledge a verified Stripe event after its versioned normalized, unique ledger
record is durably committed, not after all business state has been applied. Events with missing
prerequisites remain pending for internal retry and targeted Stripe retrieval; unsupported event
shapes remain blocked and Operator-visible rather than silently applied or ignored. Signature
failures or failures to persist return non-success, while immediate state application commits the
event outcome, Trip Pass Order, Trip Pass, Trip Pass Grant, and Usage Meters atomically. This
prevents provider retry storms without acknowledging events that exist only in memory.

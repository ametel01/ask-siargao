# Separate Stripe payment authority from Trip Pass access authority

Stripe is authoritative for payment facts, while Ask Siargao's database is authoritative for Trip
Pass access. A browser return or client-observed payment state never activates access; Trip Pass
Activation occurs only when a verified Stripe event is durably and atomically applied, accepting
that a paid customer may briefly wait for webhook retry or audited reconciliation in exchange for a
single replay-safe access boundary.

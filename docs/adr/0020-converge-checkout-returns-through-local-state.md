# Converge checkout returns through verified local and provider state

A checkout browser return is non-authoritative and shows Checkout Confirmation while polling only
Ask Siargao's local Order state. Verified webhooks remain the primary activation path; if local paid
evidence is still absent after a ten-second grace period, the server performs at most one bounded
provider lookup. The checkout confirmation redirect supplies Lemon Squeezy's documented `order_id`
and unguessable `order_identifier` link variables. The authenticated endpoint retrieves that exact
Order, cross-checks both identities, binds the already owner-scoped local Order, and persists the
normalized fact through the same durable receipt boundary used by webhooks and reconciliation.

The Lemon Squeezy Orders API does not expose checkout custom data or a Checkout ID, so recovery
never lists or guesses Orders. Webhook `meta.custom_data` remains the primary correlation path.
Receipt correlation and payment application remain separate states, and the return endpoint reports
`applied` only when the local Order has an accepted Payment Fact. Browser data never asserts payment
state, the provider Order ID can be consumed only once, and repeated client polling never fans out
into provider calls.

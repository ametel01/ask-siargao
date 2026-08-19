# Converge checkout returns through signature-verified local state

A checkout browser return is non-authoritative and shows Checkout Confirmation while polling only
Ask Siargao's local Order state. Verified webhooks remain the primary activation path; if local paid
evidence is still absent after a ten-second grace period, the server may perform one bounded lookup
for a signature-verified local Payment Event Receipt correlated by webhook `meta.custom_data`. If a
pending receipt exists, it is applied through the same durable inbox boundary used by the worker.

The Lemon Squeezy Orders API does not expose checkout custom data or a Checkout ID, so browser
returns never trigger Order-list correlation or provider reads. Receipt correlation and payment
application remain separate states, and the return endpoint reports `applied` only when the local
Order has an accepted Payment Fact. Browser data never activates access, and repeated client
polling never fans out into provider calls.

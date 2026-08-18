# Converge checkout returns through local state and bounded provider lookup

A checkout browser return is non-authoritative and shows Checkout Confirmation while polling only
Ask Siargao's local Order state. Verified webhooks remain the primary activation path; if local paid
evidence is still absent after a ten-second grace period, the server may enqueue one bounded Payment
Authority lookup for that Order and apply its normalized verified facts through the same durable
inbox boundary. Browser data never activates access, and repeated client polling never fans out into
unbounded provider calls.

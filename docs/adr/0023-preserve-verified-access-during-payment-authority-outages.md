# Preserve verified access during Payment Authority outages

When Lemon Squeezy cannot provide authoritative facts, Ask Siargao fails closed for new checkout and
Trip Pass Activation, keeps free functionality available, and durably retries refunds and Commerce
Reconciliation while paging the Operator. Already-verified active Trip Passes continue from the
local access ledger until their normal expiry or a later verified lifecycle fact changes them; a
provider outage alone never invents payment, refund, suspension, or revocation state.

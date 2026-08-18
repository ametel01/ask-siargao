# Use Lemon Squeezy behind a provider-neutral commerce boundary

Lemon Squeezy is the only active Merchant of Record for Trip Pass commerce, superseding the direct
Stripe launch choice in ADR-0006. Ask Siargao keeps Orders, payment facts, refunds, reconciliation,
and access rules provider-neutral while isolating Lemon Squeezy API resources, signatures, and
identifiers in one adapter. The public `/api/payments/lemon-squeezy/webhook` route verifies the
provider signature before immediately normalizing facts into the neutral durable inbox; this
accepts a modest boundary cost now to avoid rebuilding the access model around another provider's
vocabulary and lifecycle.

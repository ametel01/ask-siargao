# Launch only direct Stripe Trip Pass commerce

The production launch will expose direct Stripe Checkout for the Trip Pass Product as its only
commerce surface, with Ask Siargao retaining access authority. Legacy Trip Risk Audit checkout
cannot be enabled in production, although historical support/report access may remain where
required, and Clerk Billing is deferred until a recurring membership product is designed; either
change requires a separate reviewed plan rather than an environment toggle.

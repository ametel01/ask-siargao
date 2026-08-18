# Separate Trip Pass Orders, Checkout Attempts, and Payment Facts

A Trip Pass Order represents one purchase intent and can own multiple expiring Checkout Attempts and
multiple Payment Facts, while accepting at most one paid fact for one Trip Pass Grant. This replaces
the provider-shaped one-Order/one-session/one-payment assumption so ambiguous checkout creation can
be retried safely and every additional verified payment can be refunded without granting duplicate
access. Order, Checkout Attempt, Payment Fact, and Trip Pass state transition independently; no
single provider-shaped status may stand in for all four lifecycles. Bounded technical checkout
retries before the shared expiry stay on the same Order, while a deliberate purchase after expiry
creates a new Order and cannot revive the expired purchase intent.

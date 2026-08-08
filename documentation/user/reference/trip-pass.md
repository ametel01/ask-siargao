# Siargao Trip Pass

The Siargao Trip Pass is a one-time USD 9.99 purchase for 150 successful chat answers during a
14-day (336-hour) access window. Stripe is the authority for the amount and currency. Ask Siargao's
ledger is the authority for access and remaining answers. A pass is neither a subscription nor an
automatic renewal.

Checkout is currently **off**. The app may show availability information, but it cannot create a
Checkout Session until an eligible human completes the launch process and explicitly changes the
rollout mode.

The in-product [Trip Pass terms, privacy, and refund summary](/legal/trip-pass) is the public policy
surface shown before checkout.

## States users can see

- **Pending payment:** Stripe has not delivered authoritative paid evidence, so access is not active.
- **Active:** a verified payment event activated the pass. A browser redirect alone cannot do this.
- **Refund Review:** refund facts and access do not yet have a safe terminal result. Access fails
  closed while an Operator investigates.
- **Disputed:** a Stripe dispute suspends access until authoritative resolution is applied.
- **Paid After Closure:** payment arrived after Account Closure won the race. No access is granted;
  a durable worker pursues a full refund.
- **Expired, refunded, or closed:** access is unavailable for the corresponding terminal reason.

Repeated delivery of the same Stripe event is safe. A partial refund is recorded cumulatively and
does not by itself invent a proportional access rule. A full refund revokes access through the
authoritative payment lifecycle.

## Privacy and support

Ask Siargao stores normalized commerce facts, not raw Stripe webhook payloads. Retained facts are
minimized and governed by the versioned privacy, refund, terms, and retention policies captured at
checkout. For help, use the product support channel; support staff should not ask for full payment
URLs, provider payloads, or credentials.

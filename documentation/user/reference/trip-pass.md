# Siargao Trip Pass

The Siargao Trip Pass is a one-time, tax-inclusive USD 9.99 purchase for 150 successful chat answers
during a 14-day (336-hour) access window. Lemon Squeezy is the Payment Authority for the amount,
currency, payment, and refund facts. Ask Siargao's ledger is the authority for access and remaining
answers. A pass is neither a subscription nor an automatic renewal.

Before checkout, Ask Siargao displays the USD 9.99 tax-inclusive total, confirms that the purchase
does not subscribe or renew, identifies Lemon Squeezy as the payment and receipt provider, explains
the expected `LEMSQZY*` bank-statement appearance, and links the Ask Siargao support/refund route.

Checkout is currently **off**. The app may show availability information, but it cannot create a
provider checkout until an eligible human completes the launch process and explicitly changes the
rollout mode. Turning checkout off affects only new purchases: existing verified access and required
payment, refund, closure, reconciliation, and retention work continue.

The in-product [Trip Pass terms, privacy, and refund summary](/legal/trip-pass) is the public policy
surface shown before checkout.

## States users can see

- **Pending payment:** the Payment Authority has not delivered authoritative paid evidence, so
  access is not active.
- **Active:** a verified payment event activated the pass. A browser redirect alone cannot do this.
- **Refund Review:** refund facts and access do not yet have a safe terminal result. Access and Usage
  Meters remain unchanged for up to 24 hours while an Operator investigates. If review remains
  unresolved, Ask Siargao pursues refunding the remaining amount and revokes access only after the
  full refund is verified.
- **Payment suspended:** a verified fraudulent or disputed payment temporarily suspends access. A
  later authoritative paid outcome restores access only until the original expiry.
- **Paid After Closure:** payment arrived after Account Closure won the race. No access is granted;
  a durable worker pursues a full refund.
- **Expired, refunded, or closed:** access is unavailable for the corresponding terminal reason.

Repeated delivery of the same payment fact is safe. A partial refund enters a paged Refund Review
without changing access or Usage Meters. Review ends within 24 hours with either unchanged access or
a full refund and terminal revocation. A full refund revokes access through the authoritative
payment lifecycle.

## Privacy and support

Ask Siargao stores normalized commerce facts, not raw provider webhook payloads. Retained facts are
minimized and governed by the versioned privacy, refund, terms, and retention policies captured at
checkout. For help, use the product support channel; support staff should not ask for full payment
URLs, provider payloads, or credentials. Ask Siargao supports product access and Usage Meters through
`support@asksiargao.com`; Lemon Squeezy provides the transaction, receipt, payment-method, tax, and
chargeback boundary. Email alone never proves Order ownership.

If Lemon Squeezy is unavailable, Ask Siargao stops new checkout and activation rather than guessing
payment state. Free functionality and already-verified active Trip Pass access continue while
refund and reconciliation work retries durably.

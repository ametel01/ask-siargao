# Refund payments completed after account closure

If verified payment succeeds after an Account Closure write barrier, Ask Siargao will record Paid
After Closure, create no Trip Pass, and initiate an idempotent full refund that remains retryable and
Operator-visible until Stripe confirms it. Closure first attempts to expire every open Checkout
Session, but it never delays the privacy write barrier for provider confirmation; this accepts a
bounded automated outbound-payment workflow to prevent either resurrecting a closed account or
retaining money for access that cannot be delivered.

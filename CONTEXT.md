# Ask Siargao

Ask Siargao provides travel guidance and time-bounded paid access to enhanced answer allowances.

## Language

**Ask Siargao Account**:
The durable ownership boundary for a person's product data and Trip Passes. An email address is an
attribute, not proof that two accounts have the same owner.
_Avoid_: User, Clerk user

**Account Closure**:
The terminal end of an Ask Siargao Account's ownership and access. Registering again with the same
email creates a distinct account and does not restore the closed account's data or Trip Passes.
_Avoid_: Temporary deletion, deactivation

**Closure Operation**:
The durable, retryable process that completes an Account Closure after account access and public
sharing have been terminated.
_Avoid_: Delete request, background cleanup

**Closure Tombstone**:
A terminal, time-bounded denial marker containing a versioned keyed hash of the closed account's
Clerk user ID. It prevents stale sessions or lifecycle events from recreating the account without
retaining readable identity.
_Avoid_: Deleted user, archived account

**Erasable Product Data**:
Traveler-created profile, chat, rating, saved-planning, and shared-plan content that is permanently
removed from the active system on Account Closure. It is not retained for analytics or model
training.
_Avoid_: Anonymized product content, retained history

**Retained Commerce Evidence**:
Account-detached payment, lifecycle, policy-consent, reconciliation, and aggregate service-delivery
facts kept for an approved accounting or dispute period. It excludes identity attributes, product
content, per-request usage history, and raw provider payloads.
_Avoid_: Customer record, raw payment event

**Retention Policy**:
A versioned, approved rule that states why a data class is retained, its maximum lifetime, and its
explicit purge deadline. Production data has no indefinite-retention fallback.
_Avoid_: Permanent retention, cleanup default

**Commerce Retention Policy**:
The Retention Policy applied to Retained Commerce Evidence for accounting, dispute, and
reconciliation purposes.
_Avoid_: Customer retention policy, payment archive

**Operator**:
A named person explicitly authorized to inspect diagnostics or perform audited recovery work.
Possession of a shared access token does not establish Operator identity.
_Avoid_: Admin token, support user

**Reconciliation Finding**:
A recorded mismatch between Ask Siargao's commerce state and authoritative payment facts. Detecting
a finding does not mutate commerce or access state.
_Avoid_: Repair, automatic fix

**Repair Action**:
An idempotent, Operator-authorized mutation that resolves a Reconciliation Finding outside normal
verified-event application.
_Avoid_: Event retry, reconciliation

**Trip Pass Product**:
A versioned commercial offer that defines a Trip Pass's price, currency, duration, and answer
allowances.
_Avoid_: Offer, plan, SKU

**Trip Pass Product Family**:
All versions and prices of the time-bounded Trip Pass offer. No-stacking eligibility is enforced
across the family rather than per version or Stripe Price.
_Avoid_: Product version, Stripe Price

**Trip Pass Order**:
A record of one attempt to purchase a Trip Pass Product and its payment lifecycle.
_Avoid_: Checkout, purchase record

**Effective Pending Order**:
A Trip Pass Order whose Stripe Checkout Session can still accept payment. It blocks creation of
another payable order for the same account and Trip Pass Product Family.
_Avoid_: Recent order, locally pending order

**Checkout Canary**:
A live production checkout available only to explicitly allowlisted internal accounts while global
checkout remains disabled. It uses the normal commerce and access path without bypasses.
_Avoid_: Test-mode checkout, manual activation

**Pending Stripe Event**:
A verified, normalized Stripe event that has been durably received but cannot yet be applied because
a prerequisite is missing. It is acknowledged to Stripe and retried within Ask Siargao.
_Avoid_: Failed event, ignored event

**Paid After Closure**:
A verified payment completed after the account's closure write barrier. It creates no Trip Pass and
requires an idempotent, retryable full refund.
_Avoid_: Late activation, orphaned payment

**Trip Pass**:
A time-bounded access entitlement held by one person and created only after authoritative
activation. Its term is measured as exact elapsed UTC time from Trip Pass Activation.
_Avoid_: Subscription, order, purchase

**Exhausted Trip Pass**:
A Trip Pass whose primary travel-answer Usage Meter has been fully consumed before expiry. It grants
no further paid access and does not block purchase of a new Trip Pass Product.
_Avoid_: Active pass, expired pass

**Trip Pass Activation**:
The creation of a Trip Pass after verified payment facts are durably applied to Ask Siargao's access
state.
_Avoid_: Checkout success, browser return, payment redirect

**Refund Review**:
The Operator-owned state for a partial or nonterminal refund. The associated Trip Pass and Usage
Meters remain unchanged until a final reviewed outcome is recorded.
_Avoid_: Automatic proration, refund suspension

**Dispute Suspension**:
The temporary removal of Trip Pass access while a payment dispute is open. A merchant win restores
access only through the Trip Pass's original expiry and does not extend its term.
_Avoid_: Revocation, paused expiry

**Trip Pass Grant**:
An immutable provenance record linking a Trip Pass to the Order or Operator action that created it
and the product terms applied.
_Avoid_: Entitlement, activation

**Usage Meter**:
An allowance counter attached to a Trip Pass for one category of metered use.
_Avoid_: Quota, balance

**Travel Answer**:
A complete, policy-compliant assistant answer durably stored for an Ask Siargao Account. It counts
once even if client delivery is interrupted and is retrievable through the same idempotency key.
_Avoid_: Request, model call, tool result

**Paid Answer Reservation**:
A temporary hold on one Travel Answer unit while an answer is generated. It becomes Usage only when
the Travel Answer is durably stored; otherwise it is released.
_Avoid_: Charged request, pending answer

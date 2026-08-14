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

**Production Readiness**:
A release-lane state reached only when its capabilities are implemented, deployed and configured,
monitored, recoverable, and verified for the exact release candidate.
_Avoid_: Code complete, launch approved

**Implementation Status**:
The code-completeness classification of a capability: Not Implemented, Partial, or Implemented. It
does not establish Production Readiness or Launch Authorization.
_Avoid_: Readiness, launch status

**Foundation Gate Status**:
The evidence state showing that every required repository check passed for one exact candidate.
Passing does not establish Production Readiness.
_Avoid_: Engineering readiness, production-ready

**Prospective Candidate**:
A clean immutable pre-merge commit that has passed its required local and continuous-integration
checks but is not yet the trusted-main Release Candidate.
_Avoid_: Release Candidate, branch

**Release Candidate**:
The immutable trusted-main commit deployed to the protected environment and used for all Release
Evidence. A changed commit or relevant configuration creates a different candidate.
_Avoid_: Prospective Candidate, latest main

**Protected Staging**:
A stable, access-controlled non-production deployment of one exact Release Candidate with isolated
test data and provider resources. It can produce Release Evidence but cannot mutate production.
_Avoid_: Untrusted preview, production clone

**Launch Authorization**:
The decision by an eligible non-author human approver to expose one release lane after reviewing its
current evidence and residual risks. It is distinct from Production Readiness.
_Avoid_: Engineering readiness, merge approval

**Evidence Owner**:
The named person who assembles and attests the Release Evidence for one release lane. This person
does not grant Launch Authorization.
_Avoid_: Launch Approver, Operator

**Launch Approver**:
The named person who independently reviews Release Evidence and grants or denies Launch
Authorization. This person is neither the candidate author nor the Operator changing exposure.
_Avoid_: Evidence Owner, PR reviewer

**Residual Risk Acceptance**:
A documented, time-bounded Launch Authorization exception approved by an eligible non-author human.
It cannot waive privacy deletion, authentication bypass, money/access divergence, or unrecoverable
data-loss risk.
_Avoid_: Informal waiver, acknowledged finding

**Free Controlled Beta**:
The independently authorized release lane that exposes public knowledge and authenticated free chat
under bounded usage, traffic, cost, monitoring, and rollback controls while Trip Pass checkout
remains globally disabled.
_Avoid_: Production launch, paid beta

**Beta Cohort**:
The invitation-controlled set of Ask Siargao Accounts allowed to request Travel Answers during the
Free Controlled Beta. Public knowledge remains available outside the cohort.
_Avoid_: Waitlist, all registered users

**Continuous Travel Answer Availability**:
The operating rule that Ask Siargao accepts new Travel Answers at all hours unless an emergency stop,
traffic limit, or cost circuit closes exposure. It does not imply continuous human support.
_Avoid_: Staffed Exposure Window, business hours

**General Free Availability**:
The independently authorized release lane that removes beta traffic caps while retaining the free
allowance, cost circuit, monitoring, rollback controls, and globally disabled Trip Pass checkout.
_Avoid_: Free Controlled Beta, General Paid Availability

**Recovery Evidence**:
Observed proof that a release lane can be restored or rolled back within its approved objectives. A
runbook without a successful exercise is not Recovery Evidence.
_Avoid_: Recovery plan, untested runbook

**Release Evidence**:
Immutable, time-bounded proof tied to the exact release candidate and relevant deployment or
provider configuration. Expired evidence revokes Production Readiness.
_Avoid_: Latest green run, historical proof

**Shared Trip Link**:
A revocable public capability for one selected trip plan. It expires after 30 days by default and
does not grant access to its owner's Ask Siargao Account.
_Avoid_: Public account, permanent share

**General Paid Availability**:
The independently authorized release lane that exposes Trip Pass checkout beyond the Checkout
Canary allowlist after successful canary evidence.
_Avoid_: Checkout Canary, code complete

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
checkout remains disabled. It uses the normal commerce and access path without bypasses and is
required before General Paid Availability.
_Avoid_: Test-mode checkout, manual activation

**Checkout Mode**:
The `off`, `canary`, or `on` production exposure state for new Trip Pass Orders. An invalid value is
not a mode: deployment is rejected, while runtime behavior preserves the free product and forces
checkout off.
_Avoid_: Feature flag, payment state

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

**Agent Turn Recovery**:
The bounded attempt to recover an interrupted or invalid answer-generation turn before it can
become a Travel Answer.
_Avoid_: Travel Answer recovery, repair pipeline

**Limited Answer Candidate**:
An answer-generation result that satisfies mandatory recovery integrity requirements while missing
one or more optional quality goals. It is not a Travel Answer until durable admission succeeds.
_Avoid_: Degraded Travel Answer, terminal fallback, completed with limits

**Travel Answer**:
A complete, policy-compliant assistant answer durably stored for an Ask Siargao Account. It counts
once even if client delivery is interrupted and is retrievable through the same idempotency key.
_Avoid_: Request, model call, tool result

**Paid Answer Reservation**:
A temporary hold on one Travel Answer unit while an answer is generated. It becomes Usage only when
the Travel Answer is durably stored; otherwise it is released.
_Avoid_: Charged request, pending answer

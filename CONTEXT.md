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
reconciliation purposes. Its working Philippine accounting period is five years from the applicable
tax-return deadline or later filing date, extended only while a relevant audit, refund, dispute, or
claim remains unresolved; launch requires professional confirmation of the owner's actual tax
jurisdiction and obligations.
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
A versioned commercial offer that defines a Trip Pass's tax-inclusive customer price, currency,
duration, and answer allowances. Changing any commercial term creates a new Product version and
Payment Authority Variant; an Order's referenced version never changes.
_Avoid_: Offer, plan, SKU

**Trip Pass Product Family**:
All versions and prices of the time-bounded Trip Pass offer. No-stacking eligibility is enforced
across the family rather than per version or provider Variant.
_Avoid_: Product version, provider Variant

**Trip Pass Order**:
A record of one intent to purchase a Trip Pass Product. It can contain multiple Checkout Attempts
and Payment Facts but can accept at most one payment for one Trip Pass Grant. Technical checkout
retries before the shared expiry stay on the Order; a deliberate purchase after expiry creates a new
Order.
_Avoid_: Checkout, purchase record

**Payment Authority**:
The external commerce system authoritative for whether a Trip Pass Order was paid or refunded. It
does not grant or revoke Trip Pass access directly.
_Avoid_: Access authority, checkout page

**Payment Authority Outage**:
A period when new checkout, payment verification, refund, or reconciliation calls cannot obtain
authoritative provider facts. New commerce and activation fail closed, free functionality remains
available, and already-verified Trip Pass access continues while durable recovery retries and pages
the Operator.
_Avoid_: Unpaid access, global outage, pass revocation

**Provider Order Reference**:
The opaque Trip Pass Order ID shared with the Payment Authority and returned with verified payment
facts. It identifies an Order, not an Ask Siargao Account or external identity.
_Avoid_: Account ID, Clerk user ID, customer identifier

**Checkout Attempt**:
One expiring provider checkout created for a Trip Pass Order. Multiple attempts may exist, but only
a durably recorded checkout URL is exposed to the purchaser. Its lifecycle is independent from the
Order, Payment Fact, and Trip Pass lifecycles.
_Avoid_: Trip Pass Order, browser visit

**Checkout Confirmation**:
The non-authoritative browser state shown after a purchaser returns from checkout. It polls only
Ask Siargao's local Order state and, after a ten-second webhook grace period, may enqueue one bounded
Payment Authority lookup. It never activates access from browser data.
_Avoid_: Checkout success, payment confirmation, activation

**Payment Fact**:
A normalized authoritative statement about one provider payment associated with a Trip Pass Order.
Only the first accepted paid fact can create a Trip Pass Grant. Its lifecycle is independent from
the Order, Checkout Attempt, and Trip Pass lifecycles.
_Avoid_: Checkout Attempt, Trip Pass, raw provider payload

**Payment Event Receipt**:
A durable, privacy-minimized record of one verified Payment Authority fact, identified by a
deterministic fingerprint. It contains normalized facts rather than a raw provider payload.
_Avoid_: Raw webhook, provider event archive

**Commerce Reconciliation**:
The read-only comparison of local commerce state with authoritative Payment Authority facts. It
prioritizes active and nonterminal Orders at least every five minutes and performs a bounded daily
sweep of Orders still under the Commerce Retention Policy; it records Findings but never repairs.
_Avoid_: Repair, webhook retry, database correction

**Effective Pending Order**:
A Trip Pass Order whose provider checkout can still accept payment before its configured expiry. It
blocks creation of another payable order for the same account and Trip Pass Product Family.
_Avoid_: Recent order, locally pending order, cancelled browser return

**Checkout Canary**:
A live production checkout available only to explicitly allowlisted internal accounts while global
checkout remains disabled. It uses the normal commerce and access path without bypasses and is
required before General Paid Availability.
_Avoid_: Test-mode checkout, manual activation

**Checkout Mode**:
The `off`, `canary`, or `on` production exposure state for new Trip Pass Orders. An invalid value is
not a mode: deployment is rejected, while runtime behavior preserves the free product and forces
checkout off. `off` stops only new Order and Checkout Attempt creation; verified access, webhook
ingestion, refunds, closure work, reconciliation, retention purge, and audited repair continue.
_Avoid_: Feature flag, payment state

**Paid Commerce Rollback**:
The operation that sets Checkout Mode to `off` and converges existing commerce forward. It never
reactivates Stripe, deletes evidence, stops lifecycle workers, or reverses durable migrations.
_Avoid_: Provider fallback, payment rollback, data reset

**Payment Credential Rotation**:
A mode-isolated overlap-and-verify replacement of Payment Authority API keys or webhook secrets.
Current and replacement credentials coexist only for a bounded verification window; revocation
follows exact-candidate proof, and any production credential change invalidates affected Release
Evidence.
_Avoid_: In-place secret edit, unverified revocation, shared test/live key

**Pending Payment Event**:
A Payment Event Receipt that cannot yet be applied because a prerequisite is missing. It is
acknowledged to the provider and retried within Ask Siargao.
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
Meters remain unchanged for at most 24 hours until a final reviewed outcome is recorded. If the
deadline passes unresolved, Ask Siargao pursues refunding the remaining amount and revokes access
only after verified full-refund evidence.
_Avoid_: Automatic proration, refund suspension

**Payment Suspension**:
The temporary removal of Trip Pass access after a verified fraudulent or disputed payment fact. A
later authoritative paid outcome restores access only through the Trip Pass's original expiry and
does not extend its term.
_Avoid_: Revocation, paused expiry, Refund Review

**Refund Operation**:
An idempotent request initiated through the browser-based, fresh-MFA Operator workflow and executed
against the Payment Authority by the deployed server. Access changes only after verified refund
facts; a provider-dashboard refund is an emergency or provider-initiated path that must converge
through a verified event or Commerce Reconciliation.
_Avoid_: Manual database refund, access toggle, unverified dashboard action

**Commerce Support Boundary**:
Ask Siargao owns product, access, Usage Meter, and refund-request support through
`support@asksiargao.com`; the Payment Authority owns the customer-facing transaction, receipt, payment
method, tax, and chargeback boundary. An authenticated Account or opaque local Order reference can
locate support state, but email alone never proves ownership.
_Avoid_: Shared support ownership, email identity, provider access support

**Trip Pass Grant**:
An immutable provenance record linking a Trip Pass to the Order or Operator action that created it
and the product terms applied.
_Avoid_: Entitlement, activation

**Usage Meter**:
An allowance counter attached to a Trip Pass for one category of metered use.
_Avoid_: Quota, balance

**Siargao Trip Copilot**:
The product category for Ask Siargao: an AI-powered travel assistant that reality-checks Siargao
decisions against current evidence, traveler constraints, and explicit limitations.
_Avoid_: Generic AI travel assistant, itinerary generator, chat-first product, booking service

**Accountable Editor**:
The named person publicly responsible for Ask Siargao's editorial method, corrections, and content
claims. The role does not by itself establish local experience or independent review.
_Avoid_: Editorial Desk, Local Knowledge Review, anonymous author

**Evidence-Led Editorial Guidance**:
Public travel-planning content whose claims are supported by disclosed sources, review dates, and
limitations. It does not imply review by a locally experienced person unless that reviewer is named.
_Avoid_: Local Knowledge Review, anonymous local expertise

**Live Evidence**:
Evidence retrieved from an external source during the current request with its retrieval time
available. It does not guarantee that the source itself is accurate or complete.
_Avoid_: Current evidence, real-time truth, safety confirmation

**Current Evidence**:
Evidence reviewed within the declared freshness window appropriate to its claim. It may be current
without having been retrieved during the current request.
_Avoid_: Live evidence, timeless fact, recently updated

**Field Observation**:
An immutable, atomic record of what an identified observer saw, measured, paid, experienced, or was
told at a stated place, time, method, and set of conditions. It is not a publishable Fact until it
passes review and Fact Admission.
_Avoid_: Live Field Data, local truth, field fact

**Field Batch**:
A versioned, hashed, idempotent upload containing Field Visits, Field Observations, statements,
route runs, and private evidence-asset references from one offline capture export.
_Avoid_: Database dump, fact import, photo upload

**Fact Admission**:
The governed review decision that maps an approved Field Observation into a Source Record, Fact,
and permitted Evidence while preserving provenance, freshness, corrections, and withdrawal.
_Avoid_: Upload, synchronization, automatic publication

**First-Hand Checked Fact**:
A Current Evidence Fact whose provenance includes an admitted Field Observation. The label remains
bounded by the observation's time, conditions, review, and expiry and is distinct from cache
freshness.
_Avoid_: Fresh cache, live truth, guaranteed local knowledge

**Siargao-Specific Planning Context**:
Governed island-specific knowledge used to interpret travel evidence and constraints. It does not
imply that Ask Siargao's staff are locally based.
_Avoid_: Local staff knowledge, live evidence, generic travel advice

**Reality Check**:
The evaluation method that tests a proposed Siargao plan or decision against relevant evidence,
traveler constraints, uncertainty, and practical fallbacks.
_Avoid_: Travel Answer, chat action, booking confirmation

**Worked Reality Check**:
An ungated, hand-authored editorial example based on a realistic synthetic scenario that
demonstrates a Reality Check through its question, evidence, time-bounded recommendation,
limitations, and fallback. It is never a republished Travel Answer.
_Avoid_: Customer answer, testimonial, generic guide

**Guide Publication Date**:
The date an editorial guide first becomes public. It does not change after publication.
_Avoid_: Evidence check date, last updated

**Guide Modification Date**:
The date an editorial guide's recommendation or substantive content most recently changed.
_Avoid_: Typographical edit date, evidence check date

**Evidence Check Date**:
The date time-sensitive claims and cited evidence in editorial content were most recently reviewed.
It may change without a substantive content change.
_Avoid_: Guide modification date, generic last updated

**Visibility Owner**:
The named person responsible for the discovery baseline, monthly evidence review, and prioritization
of search, external-reference, and qualified-discovery work.
_Avoid_: SEO team, content owner

**Visibility Journey**:
A short-lived, privacy-safe correlation boundary that connects public discovery and content actions
to chat acceptance, Reality Check completion, and Travel Answer admission.
_Avoid_: Ask Siargao Account, advertising profile, prompt history

**Qualified Discovery**:
A visit attributable to search or an external reference that results in an admitted Travel Answer
within the same Visibility Journey.
_Avoid_: Page impression, crawler request, brand search

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

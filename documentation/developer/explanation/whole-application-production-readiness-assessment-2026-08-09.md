# Whole-Application Production-Readiness Assessment

This immutable assessment records the repository-backed production-readiness position on
2026-08-09. It covers the free product, paid Trip Pass, security, monitoring, feature completeness,
and release evidence. It is historical audit evidence, not a live launch checklist, Launch
Authorization, or an implementation plan. Current release gates remain in the
[release-candidate QA guide](../how-to-guides/run-release-candidate-qa.md) and
[free-product](../how-to-guides/launch-free-product.md) and
[Trip Pass](../how-to-guides/launch-trip-pass.md) launch guides.

## Verdict

Production Readiness is evaluated independently for four release lanes: Free Controlled Beta,
General Free Availability, Checkout Canary, and General Paid Availability. A capability is not
Production Ready merely because its code is implemented; it must also be deployed and configured,
monitored, recoverable, and verified for the exact release candidate.

Repository verification is Foundation Gate Status, not “engineering readiness.” The pre-merge
commit is a Prospective Candidate. Only an immutable trusted-main commit deployed to the protected
environment is the Release Candidate. A merge, rebase, commit change, or relevant configuration
change creates a new candidate and invalidates affected Release Evidence.

The assessment uses three independent statuses. Implementation Status is `Not Implemented`,
`Partial`, or `Implemented`; Production Readiness is `Not Ready` or `Ready`; Launch Authorization is
`Not Authorized` or `Authorized`. Conditions and missing evidence belong in the assessment, not in
hybrid labels such as “conditional no-go.”

| Release lane | Implementation Status | Production Readiness | Launch Authorization | Assessment |
| --- | --- | --- | --- | --- |
| Free Controlled Beta | Partial | Not Ready | Not Authorized | The core product is mostly implemented, but shared security and release blockers remain |
| General Free Availability | Partial | Not Ready | Not Authorized | Free-beta evidence, uncapped operational capacity, and independent authorization do not exist |
| Checkout Canary | Partial | Not Ready | Not Authorized | Substantial Trip Pass code exists, but paid operational and provider prerequisites are incomplete |
| General Paid Availability | Partial | Not Ready | Not Authorized | Canary evidence, monitored operation, and independent authorization do not exist |

The following accountable launch inputs are explicitly `UNASSIGNED`:

- daily provider and model spend cap;
- Evidence Owner;
- Launch Approver;
- exposure Operator;
- rollback owner;
- security and privacy incident owner; and
- cost owner.

This is a settled blocking state, not missing audit research. Free Controlled Beta remains Not Ready
without an approved spend cap. Every release lane remains Not Authorized without named accountable
people, and no person may self-approve by combining the Launch Approver role with candidate author,
Evidence Owner, or exposure Operator.

Production Readiness and Launch Authorization are separate conclusions. Closing engineering gates
does not expose a release lane automatically. Only an eligible non-author human approver may grant
Launch Authorization or record a time-bounded Residual Risk Acceptance. Privacy deletion,
authentication bypass, money/access divergence, and unrecoverable data-loss risks are not waivable.

The Evidence Owner assembles exact-candidate evidence. A distinct Launch Approver independently
reviews that evidence and cannot be the candidate author or the Operator changing exposure. Unused
Launch Authorization expires after 24 hours and is revoked immediately by a new Release Candidate,
expired evidence, or discovery of a non-waivable risk.

The Free Controlled Beta means public landing and knowledge pages plus authenticated free chat under
the existing allowance. It also requires an explicit traffic budget, monitored error and cost
thresholds, and server-side reversible exposure controls. Calling a release “controlled” without
enforceable exposure and rollback boundaries does not satisfy this lane.

## Blocker scope by release lane

The following findings block every release lane:

- privacy-origin protection and applicable authentication or data-loss findings;
- authenticated PostgreSQL and encrypted Redis transport;
- removal of raw Places queries from durable logs;
- removal of synthetic fixture fallback from production public pages;
- a bounded Clerk webhook body before signature verification;
- immutable pins for CI actions and service images; and
- exact-candidate verification for the lane being authorized.

The Free Controlled Beta also requires verified free-allowance integrity, chat and provider
availability, privacy deletion, cost limits, and free-product rollback controls.

General Free Availability retains the free allowance, cost circuit, monitoring, rollback controls,
and globally disabled checkout boundary while removing beta traffic caps. It requires successful
Free Controlled Beta evidence and a separate Launch Authorization.

If Shared Trip Links are enabled, their 30-day default expiry and revocation behavior are also an
all-lane gate.

The Checkout Canary and General Paid Availability additionally require payment alert delivery,
deployed scheduler operation, protected provider QA, bounded reconciliation, refund handling,
backup Recovery Evidence, and money/access correctness. General Paid Availability additionally
requires successful canary evidence and demonstrated operational capacity.

Web research is part of the all-lane security baseline whenever it is enabled. Until externally
derived content is structurally marked as untrusted and covered by adversarial prompt-injection
tests, the Free Controlled Beta must keep web research disabled and use approved structured
providers instead.

## Launch blockers

### Destructive privacy actions lack origin protection

The authenticated privacy endpoint can delete chat history, saved planning data, or location
context without the same-origin validation already used by account closure. Because it accepts a
JSON body independently of its content type, a malicious same-site origin could submit a request
using the victim's Clerk session cookie.

- Evidence: [`privacy-route.ts`](../../../src/app/api/me/privacy/privacy-route.ts)
- Required outcome: reuse the mutation-origin guard and cover cross-origin and missing-header cases.

### Production database permissions omit operational tables

The production authorization template generates ownership and runtime grants from
`applicationTables`, but that inventory omits the reconciliation, finding, repair, alert-delivery,
worker-task, and observation tables introduced by later migrations. A database provisioned with the
documented least-privilege flow can therefore deny normal production workers access to required
operational state.

- Evidence: [`authorization-boundaries.ts`](../../../src/server/db/authorization-boundaries.ts)
- Related guidance: [Database authorization](../reference/database-authorization.md)
- Required outcome: complete the canonical table inventory, add a schema-alignment regression, and
  provide an idempotent repair for already-provisioned databases.

### Production data transports are not authenticated strongly enough by default

PostgreSQL production connections default to SSL mode `require`. In the installed driver this
encrypts traffic without verifying the server certificate. Redis accepts any non-empty `REDIS_URL`,
including plaintext `redis://`, as a valid production shared store.

- Evidence: [`connection-options.ts`](../../../src/server/db/connection-options.ts)
- Evidence: [`redis-command-client.ts`](../../../src/server/security/redis-command-client.ts)
- Required outcome: use hostname- and certificate-verified PostgreSQL TLS and require `rediss://` in
  production, with explicitly reviewed exceptions where necessary.

### Documented paging conditions do not all reach Sentry

The code defines a broad operational condition and severity matrix, but runtime delivery is wired
primarily for reconciliation findings and repeated generic worker failures. Stripe inbox,
account-closure, and paid-after-closure refund paths can persist page-worthy state without sending a
corresponding Sentry event. The Sentry HTTP sink also has no request timeout, so a stalled transport
can outlive alert and task leases.

- Evidence: [`sentry-alerts.ts`](../../../src/server/operations/sentry-alerts.ts)
- Evidence: [`run-operational-worker.ts`](../../../src/server/operations/run-operational-worker.ts)
- Required outcome: dispatch every documented durable page transition through one deduplicated,
  timeout-bounded alert path and test each condition end to end.

### Google Places queries enter durable logs

The Places chat and cache paths log the raw search query. These queries are derived from traveler
messages and can include accommodation names, accessibility needs, or other travel intent. This
contradicts the documented observability boundary that prohibits raw tool arguments in logs.

- Evidence: [`google-places-chat.ts`](../../../src/server/providers/google-places-chat.ts)
- Evidence: [`google-places-chat-cache.ts`](../../../src/server/providers/google-places-chat-cache.ts)
- Required outcome: retain only safe categorical fields, bounded lengths, or non-reversible
  diagnostic identifiers.

### The dependency audit is red and is not a CI gate

The audit observed 23 advisories: 12 high, 10 moderate, and one low. Most were transitive chains
rooted in `shadcn` and Clerk UI. Static inspection did not prove that the affected paths are
runtime-exploitable, so these are dependency findings requiring reachability triage rather than
confirmed application vulnerabilities. The ordinary CI workflow does not run `bun audit`.

An unexplained high or critical advisory blocks a release lane. A documented reachability
determination may support a time-bounded Residual Risk Acceptance only when the affected path is
demonstrably non-runtime or non-exploitable. New high and critical advisories should fail CI; every
accepted baseline exception requires an owner and expiry.

- Evidence: [`package.json`](../../../package.json)
- Evidence: [`ci.yml`](../../../.github/workflows/ci.yml)
- Required outcome: triage reachability, update or constrain affected dependencies, and add an
  auditable CI policy with only documented, expiring exceptions.

### The current candidate lacks immutable release evidence

At assessment time, local `main` was three commits ahead of `upstream/main` and the worktree had
user-owned modifications and untracked files. The current local candidate therefore had no exact-SHA
CI run, protected Clerk and Stripe release-candidate evidence, or production deployment evidence.
The latest observed green upstream CI belonged to an older commit.

- Required outcome: freeze one clean candidate SHA, run the full CI and real-service lanes for that
  SHA, deploy that SHA to the protected environment, run both provider-QA lanes, and attach the
  immutable evidence required by the launch guide.

### Malformed checkout mode can fail the free product

The launch and environment documentation state that malformed checkout configuration resolves to
`off`, while the catalog parser throws and the free-chat cost policy reads the same configuration.
Deployment validation should reject any value other than `off`, `canary`, or `on`. If an invalid
value is nevertheless encountered at runtime, checkout must resolve to `off`, an Operator must be
paged, and free chat must remain available.

- Evidence: [`catalog.ts`](../../../src/server/trip-pass/catalog.ts)
- Evidence: [Environment reference](../reference/environment.md)
- Required outcome: enforce strict deployment validation and fail-safe runtime behavior with chat,
  checkout-presentation, and alert regressions.

## Additional security hardening

The launch blockers are not the entire security backlog. The audit also found the following
high-confidence hardening opportunities:

- Bound Clerk webhook bodies before signature verification, matching the streamed size limit already
  applied to Stripe webhooks. This is an all-lane blocker.
- Introduce a report-only Content Security Policy before the Free Controlled Beta and enforce the
  tested policy before the Checkout Canary.
- Give Shared Trip Links a bounded default expiry before enabling sharing in any release lane.
- Pin ordinary CI actions and service images immutably before any Launch Authorization, matching the
  protected provider workflow.
- Reconcile the deferred RLS decision with the expanded set of user-owned commerce and closure tables.

The deferred RLS documentation drift does not itself block runtime launch. Legacy report-token
handling becomes non-blocking only after the legacy routes are proven unreachable.

These gaps coexist with strong existing controls: unknown routes fail closed at the Clerk perimeter;
Stripe and Clerk webhooks are signed; Stripe processing uses a durable inbox; production rate
limiting fails closed without a healthy shared store; repair execution requires an allowlist and
fresh MFA; telemetry is event-allowlisted and redacted; and share tokens are generated with strong
randomness and stored only as hashes.

## Monitoring and operational readiness

The application has useful operational foundations:

- Database-time worker claims use leases, tokens, and fenced completion updates.
- Reconciliation performs authoritative provider lookup before recording findings.
- Alert deliveries use durable unique keys and deterministic Sentry event identities.
- Repair is separated from reconciliation and protected by origin, identity, fresh-MFA,
  confirmation, and idempotency checks.
- The production database guide defines monitoring signals, recovery objectives, restore drills, and
  incident handling.

The operator experience remains incomplete:

- Live diagnostics populate several sections with empty data and do not render the worker state they
  already load. See [`diagnostics.ts`](../../../src/server/admin/diagnostics.ts) and
  [`AdminDiagnosticsPage.tsx`](../../../src/features/admin/AdminDiagnosticsPage.tsx).
- No application health or readiness endpoint was found.
- Reconciliation creates one global task that scans every order serially under a fixed lease, without
  cursor pagination or lease renewal. See
  [`live-reconciliation.ts`](../../../src/server/operations/live-reconciliation.ts).
- Repository evidence does not prove a deployed scheduler, Sentry routing and ownership, PostHog
  dashboards, database backups and point-in-time recovery, restore drills, or rollback ownership.

The last group is an evidence boundary rather than proof that the external controls are absent. They
must be verified in the deployment environment before launch.

Recovery Evidence must come from a successful exercise, not the existence of a runbook. Every lane
requires an observed application rollback before its first Launch Authorization and at least
quarterly thereafter, plus a successful database restore drill within the previous 30 days. Paid
lanes also require observed replay or reconciliation evidence for Stripe events, refunds, Account
Closure obligations, and money/access mismatches.

CI and protected provider QA must identify the exact deployed candidate SHA. Provider QA must be
rerun after any relevant provider-configuration change. When rollback, restore, or provider evidence
expires, Production Readiness is revoked even if no new code has been deployed.

Before Free Controlled Beta authorization, live monitoring must cover authentication, chat
success/failure, provider failure, answer latency, rate-limit and shared-store health, database
health, provider and model cost, privacy operations, and alert delivery. Each signal requires a named
owner and a tested alert route. A health/readiness surface is part of this minimum evidence.

## Feature completeness

| Capability | Implementation Status | Assessment |
| --- | --- | --- |
| Core chat agent and structured Reality Checks | Implemented | Tool calling, evidence planning, validation, and structured decisions exist |
| History, profile, ratings, privacy, and account closure | Implemented | Authenticated persistent flows and terminal closure behavior exist |
| Places recommendations | Implemented | Live and cached retrieval, governed fields, normalization, and persistence exist |
| Weather, marine, tide, and surf | Implemented | Current-condition retrieval and explicit limitation states exist |
| Itineraries, cards, geolocation, save, and share | Implemented | User-facing planning and artifact flows exist |
| Free 10-answer, seven-day allowance | Implemented in code | Production still depends on the documented HMAC and shared-store configuration |
| Trip Pass payment, access, meter, webhook, and repair | Partial and disabled | Substantial code exists; checkout remains off and scheduler evidence is absent |
| Current nightlife | Partial | The embedded event corpus passed its review deadlines and is not a beta launch claim |
| Property-level quiet, family, and remote-work fit | Partial | Identity and area context work; property-level qualities remain deliberately unverified |
| Public knowledge pages | Partial | Governed database content exists, but production can silently fall back to demo fixtures |
| Legacy paid audit | Partial retirement | Checkout is retired while intake can still advertise payment readiness |
| Native mobile, booking management, and multi-destination expansion | Out of scope | Documented non-goals, not blockers for the current web product |

Two product gaps deserve explicit attention:

1. The nightlife corpus contains June 2026 verification dates and July 2026 review deadlines. Once
   expired, the dedicated tool filters those records and can return `no_events`; it does not initiate
   a refresh itself. This does not block the Free Controlled Beta if expired facts are never
   presented as current, the capability is shown as temporarily unavailable, and product claims do
   not promise current nightlife coverage. See
   [`nightlife-events.ts`](../../../src/server/chat/nightlife-events.ts).
2. Production public pages wrap database-backed catalogs with a fixture fallback. A database outage
   or empty catalog can therefore return cacheable synthetic content such as “Example Surf Stay”
   instead of an explicit empty or unavailable state. Fixtures belong only in development and test.
   A successful empty production query should return an explicit empty state or `404`; a database
   failure should return a scrubbed, non-cacheable `503` and emit an operational alert. See
   [`public-catalog.ts`](../../../src/server/public-pages/public-catalog.ts).

The legacy paid-audit product should be retired coherently. Every public entry point should return an
explicit retirement response, intake should stop advertising payment readiness, and retained records
should follow their existing retention policy. Legacy capability-token findings become
non-launch-blocking only after the relevant routes are proven unreachable.

New Shared Trip Links should expire after 30 days by default, display their expiry, and remain
immediately revocable. Existing non-expiring links should receive a 30-day sunset from the migration
rather than retaining indefinite access.

## Verification observed

The following evidence was observed during the read-only audit:

- Biome lint passed.
- TypeScript typechecking passed.
- Focused release-contract tests passed: 44 tests, zero failures.
- The full Bun suite passed 1,460 tests and failed one test.
- The remaining failure was a missing-secret subprocess test affected by Bun reloading local
  environment files. Lower-level missing-field validation tests passed, so this is evidence of a
  non-hermetic test rather than evidence that production accepts a missing Clerk secret.
- `bun audit` failed with the advisory counts recorded above.
- Full current-candidate build, functional Playwright, production-performance, protected provider,
  and deployment validation were not established.

The test database helper also uses one fixed `.tmp/pglite-step3` path. Concurrent verification
processes can remove each other's database and generate misleading migration failures. This does not
establish a production migration defect, but it makes the local release gate unsafe under concurrent
agents or test processes.

## Resolution tracking

After the confirmed grilling session, this assessment remains a record of the 2026-08-09 evidence
and the decisions used to interpret it. Remediation status belongs in GitHub issues or an umbrella
production-readiness issue. No live issue links existed when this snapshot was captured; future
tracking should link back to the relevant finding rather than rewriting it as fixed here.

Live remediation should use one umbrella production-readiness issue with one child issue per
independently verifiable finding. Each child records affected release lanes, owner, non-waivable
status, acceptance evidence, and dependency relationships. Unrelated security, operations, and
feature work should not share one implementation issue.

## Release disposition at assessment time

All four release lanes lacked complete exact-candidate evidence at assessment time. Checkout should
remain globally off.

The Free Controlled Beta can be reconsidered independently after, at minimum:

- origin protection is applied to destructive privacy mutations;
- operational database ownership and grants are repaired;
- PostgreSQL and Redis production transport requirements are hardened;
- raw Places query logging and production demo-data fallback are removed;
- documented alert conditions are delivered through a bounded, tested paging path; and
- one clean candidate receives exact-SHA CI, browser, real-service, deployment, and operational
  evidence.

Its initial exposure is limited to 100 new Ask Siargao Accounts and 1,000 Travel Answers per day.
Cost alerts fire at 70% of the approved daily provider and model budget, and new Travel Answers stop
at 100%. Exposure rolls back when the five-minute server-error rate remains above 2% for ten minutes
and stops immediately for an authentication, privacy, or data-integrity incident. The absolute daily
provider and model budget is explicitly `UNASSIGNED`.

Promotion to General Free Availability requires 14 consecutive observation days, at least 250
distinct Ask Siargao Accounts, at least 1,000 completed Travel Answers, less than 1% server errors
over the full window, no authentication, privacy, or data-integrity incident, no unresolved
high-severity provider or application incident, cost within the approved budget, successfully
exercised alert and rollback paths, and a separate Launch Authorization.

The Checkout Canary additionally requires deployed and monitored workers, protected Clerk and
Stripe QA, verified backup and recovery operations, completed alert ownership, and independent
Launch Authorization. It is mandatory before General Paid Availability and requires seven
consecutive observation days, three successful real-money internal Trip Pass Orders across distinct
accounts, one successful full refund, zero unresolved money/access mismatches, no missed page-worthy
alert, workers within their documented cadence, and no high-severity incident. General Paid
Availability additionally requires successful canary evidence and a separate Launch Authorization
decision.

The former local aggregate was not a true CI-equivalent gate because it omitted the real
PostgreSQL and Redis lanes. That gap is now closed: `verify:foundation:local` names the eight-gate
local aggregate, while `verify:foundation` provisions or targets disposable PostgreSQL and Redis
services and runs every Foundation Gate requirement. CI and documentation use the same vocabulary.

The live release-candidate QA, free-product launch, and Trip Pass launch guides contain the settled
policies. This dated assessment remains historical evidence linked from those guides.

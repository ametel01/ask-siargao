# Launch the Free Product

Use this runbook to authorize the Free Controlled Beta and later promote it to General Free
Availability. Both lanes keep Trip Pass checkout globally `off`. Following the runbook does not grant
Launch Authorization by itself.

The [2026-08-09 production-readiness assessment](../explanation/whole-application-production-readiness-assessment-2026-08-09.md)
records the historical evidence and decisions behind this policy.

## Release contract

The free experience provides ten Travel Answers over seven days. The initial Free Controlled Beta
exposes the public landing page plus authenticated free chat under explicit traffic, cost,
monitoring, and rollback controls. Governed knowledge routes remain fail-closed and outside the
initial launch scope until at least one production page has passed the existing evidence,
republishability, confidence, and freshness gates. General Free Availability removes beta traffic
caps while retaining the free allowance, cost circuit, monitoring, rollback controls, and
checkout-off boundary.

Do not start either lane while the daily provider and model budget or any required accountable role
is `UNASSIGNED`.

## 1. Close the all-lane blockers

Before preparing a Release Candidate, verify that:

- destructive privacy mutations enforce the shared same-origin policy;
- production PostgreSQL verifies server identity and production Redis uses encrypted transport;
- raw Google Places queries do not enter durable logs;
- production public pages never substitute synthetic fixtures for missing or failed governed data,
  and unpublished knowledge routes return unavailable/not found rather than entering beta scope;
- Clerk webhooks reject oversized declared and streamed bodies before verification;
- every application response carries the tested report-only Content Security Policy;
- CI actions and service images are pinned immutably; and
- every enabled Shared Trip Link expires after 30 days by default and remains revocable.

The initial report-only CSP is an enforcement rehearsal inspected during controlled browser QA. It
does not accept browser violation reports at an application endpoint, avoiding a new
attacker-controlled ingestion surface. Add a bounded, privacy-reviewed reporting endpoint before
promoting the policy to enforcement if production violation telemetry becomes a requirement.

If web research has not gained an explicit untrusted-content boundary and adversarial
prompt-injection coverage, keep it disabled. Approved structured providers may remain enabled.
Expired nightlife facts must never be presented as current; describe nightlife as temporarily
unavailable until governed freshness evidence exists.

## 2. Establish candidate evidence

Follow [Run Release-Candidate QA](run-release-candidate-qa.md). Use one exact trusted-main SHA and
protected deployment identity for every gate and receipt. A changed SHA, migration ledger, or
relevant provider configuration invalidates affected evidence.

Require an exercised application rollback before first authorization and at least quarterly
thereafter. Require a successful database restore drill within the previous 30 days.

## 3. Assign budget and accountable people

Start from the current
[Free Controlled Beta accountability record](../reference/free-controlled-beta-accountability.md),
then copy its assignments and limits into the dedicated free-release GitHub issue. Update the record
and issue together when an owner, limit, or approver changes.

Record the following in the dedicated free-release GitHub issue:

- the approved daily provider and model spend cap and currency;
- Evidence Owner;
- Launch Approver;
- exposure Operator;
- rollback owner;
- security and privacy incident owner; and
- cost owner.

The Launch Approver cannot be the candidate author, Evidence Owner, or exposure Operator. Unused
Launch Authorization expires after 24 hours and is revoked by a new candidate, expired evidence, or
a newly discovered non-waivable risk.

## 4. Verify monitoring and rollback

Provide a health/readiness surface and live monitoring for:

- authentication;
- chat success and failure;
- provider failure;
- answer latency;
- rate-limit and shared-store health;
- database health;
- provider and model cost;
- privacy operations; and
- alert delivery.

Every signal requires a named owner and a tested alert route. Exercise rollback before requesting
Launch Authorization. Privacy deletion, authentication bypass, data-integrity, and unrecoverable
data-loss risks cannot be waived.

## 5. Authorize the Free Controlled Beta

The Launch Approver reviews the exact-candidate evidence and records the decision. Only after valid
authorization may the exposure Operator enable the beta controls.

Enforce these initial limits:

- no more than 100 new Ask Siargao Accounts per day;
- no more than 1,000 Travel Answers per day;
- alert at 70% of the approved daily provider and model budget;
- stop new Travel Answers at 100% of that budget;
- roll back when the five-minute server-error rate remains above 2% for ten minutes; and
- stop immediately for an authentication, privacy, or data-integrity incident.

Keep Trip Pass checkout globally `off` throughout the beta.

Do not count unavailable knowledge routes as launched beta surfaces. Add them to the exposure scope
only after production publishing evidence proves the same governed page through its human, LLM,
JSON, sitemap, and index representations.

## 6. Promote to General Free Availability

Request a new Launch Authorization only after the beta has produced:

- 14 consecutive observation days;
- at least 250 distinct Ask Siargao Accounts;
- at least 1,000 completed Travel Answers;
- less than 1% server errors over the full observation window;
- no authentication, privacy, or data-integrity incident;
- no unresolved high-severity provider or application incident;
- cost within the approved budget; and
- successfully exercised alert and rollback paths.

General Free Availability removes the beta traffic caps. It does not remove the free allowance,
cost circuit, monitoring, rollback controls, or checkout-off boundary.

## Roll back

Disable new Travel Answers through the server-side exposure control while preserving access to
account data, privacy actions, and truthful service-status messaging. Keep Trip Pass checkout `off`.
Record the trigger, exact candidate, metrics, alert evidence, and recovery result in the free-release
issue before considering another authorization.

# Production Deployment Infrastructure Assessment

This point-in-time assessment records the infrastructure required to deploy Ask Siargao from
commit `5ab8673` on 2026-08-10. It describes the deployment topology supported by the repository and
the remaining boundary between a deployable protected environment and authorized public production
traffic. It does not grant Production Readiness or Launch Authorization.

## Conclusion

The selected Free Controlled Beta topology is:

> Vercel web tier, managed PostgreSQL, managed Redis, and a scheduled Bun job runtime, supplemented
> by Clerk, model and data providers, Sentry, and, when paid checkout launches, Stripe.

For the Free Controlled Beta, the selected services are Vercel Pro with a `staging` Custom
Environment, PlanetScale Postgres, paid Redis Cloud Essentials, authenticated Vercel Cron adapters,
Sentry Cloud, and PostHog Cloud.

The first deployment outcome is Protected Staging followed by the independently authorized Free
Controlled Beta. Live Stripe production resources and paid checkout are outside this infrastructure
decision; Stripe test resources remain part of Protected Staging provider QA. The repository can
support Protected Staging after environment-specific resources and secrets are provisioned. It
should not receive public production traffic until the launch blockers listed below are resolved and
exact-candidate release evidence is complete.

The launch uses fully managed stateful services and does not preserve self-hosting portability. Its
fixed infrastructure ceiling is USD 300 per month, excluding model, Google Places, and Stripe usage.
The daily variable-spend ceiling is USD 25, initially allocated as USD 10 for model calls and USD 15
for Google Places.
[ADR 0009](../../../docs/adr/0009-launch-free-beta-on-managed-vercel-infrastructure.md) records the
platform, operating-model, region, and recovery trade-off.
[ADR 0010](../../../docs/adr/0010-use-planetscale-and-redis-cloud-for-production-state.md) records the
managed-state provider and consistency trade-off.
[ADR 0011](../../../docs/adr/0011-operate-free-beta-within-a-staffed-exposure-window.md) records the
availability and scheduled-execution trade-off.
[ADR 0012](../../../docs/adr/0012-accept-authenticated-public-data-endpoints-for-free-beta.md)
records the public state-service endpoint risk and compensating controls.

## Required topology

| Layer | Requirement | Repository boundary |
| --- | --- | --- |
| Web application | A Vercel project running the Next.js application as Node.js functions | Vercel is the selected launch platform. Deployment validation binds protected Clerk environments to a stable Vercel project ID and exact production and staging origins. |
| Environments | Production and a `staging` Vercel Custom Environment in one Vercel Pro project, plus untrusted previews | Protected Staging has a stable domain, environment-specific secrets, and independent state and test-provider resources. Untrusted previews receive no protected credentials. |
| Database | Separate PostgreSQL 17 PlanetScale databases in Singapore for production and Protected Staging | Runtime traffic uses the included local PgBouncer on port 6432 with a pool size of two; controlled migrations use direct port 5432 endpoints with a CLI pool size of one. |
| Shared control state | Separate paid Redis Cloud Essentials databases in Singapore for production and Protected Staging | Production starts with a 1 GB multi-zone subscription. TLS, replication, AOF persistence every second, and `noeviction` protect atomic control state. |
| Background execution | Authenticated Vercel Cron route adapters invoking bounded durable work | PostgreSQL leases and retries retain durable job state. A separate worker platform is deferred unless measured duration or cadence exceeds Vercel limits. |
| Secret storage | A restricted 1Password production vault as human authority and environment-scoped Vercel variables for runtime delivery | Provider, database, Redis, signing, HMAC, and encryption secrets remain server-only, distinct by environment, MFA-protected, and covered by 90-day rotation exercises. |
| Monitoring | Sentry Cloud for operational delivery and paging; PostHog Cloud for product analytics only | Launch monitoring covers authentication, chat, provider failures, latency, Redis, PostgreSQL, privacy operations, worker backlog, cost, and alert delivery. Analytics does not replace operational alerts. |
| Network perimeter | Production and protected-staging HTTPS domains, managed DNS/TLS, and reversible WAF rules | Clerk trusts exact origins only. Vercel WAF begins in log mode before any challenge promotion. |
| Recovery | Automated backups, point-in-time recovery, and an isolated restore target | Production targets are an RPO of 15 minutes or better, an RTO of four hours, at least seven days of backup retention, and a monthly restore drill. |

The [environment reference](../reference/environment.md) is the authoritative inventory of runtime
configuration. The [production database guide](../how-to-guides/operate-the-production-database.md)
defines database provisioning, monitoring, maintenance, and recovery requirements.

## Web and region placement

Vercel Pro is the selected launch platform for the web tier. One Vercel project contains production
and a `staging` Custom Environment with a stable staging domain, environment-scoped variables, and
explicit branch tracking. The launch accepts platform coupling rather than funding a self-hosting
portability layer, and the Clerk deployment contract already checks Vercel-provided project and
target-environment identity. Protected Staging resources cannot mutate production data. Untrusted
preview deployments receive no Clerk, database, Redis, or provider credentials.

Vercel functions, PostgreSQL, Redis, and the scheduled job runtime use Singapore as their primary
region or are placed as close to it as the selected providers allow. No current contractual,
regulatory, investor, or customer data-location requirement has been identified. This does not claim
Philippine data residency, and provider selection must not imply one. Vercel functions otherwise
default to Washington, D.C. See Vercel's
[function region guidance](https://vercel.com/docs/functions/configuring-functions/region).

The database client creates one module-global connection pool per warm runtime instance and currently
defaults to ten connections. Serverless instances can multiply that number, so production uses
PlanetScale's local PgBouncer endpoint on port 6432 with `DATABASE_POOL_SIZE=2`; controlled migrations
use the direct endpoint on port 5432 with `DATABASE_CLI_POOL_SIZE=1`. Tune these only from observed
concurrency and database limits. See Vercel's
[connection pooling guidance](https://vercel.com/kb/guide/connection-pooling-with-functions).

## Operating and recovery constraints

The [Free Controlled Beta accountability record](../reference/free-controlled-beta-accountability.md)
assigns Alex Metelli as Operator, Evidence Owner, rollback owner, security and privacy incident owner,
and cost owner. The Launch Approver remains `UNASSIGNED` because the launch contract requires an
eligible non-author human; this is an administrative launch blocker, not a code or infrastructure
finding.

The launch assumes one named Operator staffed from 08:00 through 22:00 Philippine time every day,
with a 30-minute page-acknowledgement objective. A server-enforced Staffed Exposure Window accepts new
Travel Answers only from 00:00 through 14:00 UTC. Account access and privacy operations remain
available outside the window, and an Operator-controlled emergency override can close exposure at any
time. The deployment does not claim 24/7 human coverage.

The existing Free Controlled Beta release contract limits exposure to 100 new Ask Siargao Accounts
and 1,000 Travel Answers per day. It rolls back when the five-minute server-error rate remains above
two percent for ten minutes and stops immediately for authentication, privacy, or data-integrity
incidents. These limits require shared, server-side enforcement rather than dashboard-only
observation.

Clerk production uses Restricted mode for authenticated beta access. Public knowledge remains open,
while Travel Answers are available only to the Beta Cohort. Invitations ramp from 25 on day one to
50 on days two and three, then at most 100 per day, targeting an initial cohort of 300 people.

The Free Controlled Beta service objectives, measured only inside the Staffed Exposure Window, are:

- 99.5 percent application availability;
- p95 first model output within five seconds;
- p95 complete Travel Answer within 30 seconds;
- p95 non-chat API latency below 750 milliseconds; and
- health probe completion below two seconds.

These are operational beta objectives rather than contractual service-level agreements.

The combined model and Google Places variable-spend ceiling is USD 25 per day, initially allocated as
USD 10 for model calls and USD 15 for Google Places. Alerts fire at 70 percent of either allocation,
and new paid provider work stops at 100 percent. The model circuit reserves 2,000 micro-USD per call
against the USD 10 global limit. Google Places uses an application-level, Redis-backed cost-unit
circuit derived from the field-mask SKU, reinforced by provider request quotas and billing alerts;
billing alerts alone are not a hard stop. The historical model-cost baseline is approximately USD
0.001462 per request, and the launch must validate real traffic before increasing either allocation.

The accepted single-region recovery floor is:

- RPO of 15 minutes or better;
- RTO of four hours;
- at least seven days of backup retention;
- monthly restore drills into an isolated environment; and
- a successful restore drill from the previous 30 days before Launch Authorization.

Provider and service-tier selection must satisfy these objectives within the USD 300 monthly fixed
infrastructure ceiling. Protected Staging may use smaller service tiers only when it can rehearse the
same restore procedure.

Recurring service commitments are limited to USD 200 per month, reserving USD 100 for usage growth
or emergency scaling. Alerts fire at 70 and 90 percent of the total monthly ceiling. Any plan change
that would raise recurring commitments above USD 200 requires explicit approval.

## Data infrastructure

Production and Protected Staging use separate PostgreSQL 17 PlanetScale databases in Singapore
rather than branches of one database. Production uses the smallest highly available cluster that
satisfies launch capacity, while Protected Staging may use the smallest single-node cluster. Each
database needs separate credentials mapped to the
repository's authorization roles:

- `ask_siargao_migration` for migrations and controlled schema work;
- `ask_siargao_runtime` for the web application and application-owned jobs; and
- optional `ask_siargao_reporting` credentials for reviewed read-only reporting.

The runtime must use `DATABASE_SSL_MODE=verify-full`, and exact-candidate QA must prove hostname and
certificate verification against PlanetScale before launch. The migration credential must not be
present in the deployed web runtime. The
[database authorization reference](../reference/database-authorization.md) defines the intended
grants.

PlanetScale's default two-day backup retention is insufficient for this launch. Production must add
a custom backup schedule at least every 12 hours with seven-day retention so WAL-backed PITR remains
available from the retained window up to PlanetScale's five-minute recovery buffer. Monthly recovery
drills restore into a new isolated PlanetScale branch, validate the ledger and critical data, and
remove the drill branch after evidence is retained. Protected Staging must rehearse the same restore
procedure even when it uses smaller compute.

Each protected environment uses a separate paid Redis Cloud Essentials subscription in Singapore
with TLS, replication, AOF persistence every second, memory-pressure alerts, and `noeviction`.
Production begins with a 1 GB multi-zone subscription, providing about 512 MB of usable replicated
dataset capacity. Protected Staging may use the smallest paid tier with equivalent semantics. Memory
alerts fire at 70 percent, and scaling is required by 80 percent. These semantics are required because
strict allowance, idempotency, lease, and cost-circuit decisions cannot rely on an eventually
consistent store or silently lose active keys. Redis is shared control state, not the durable system
of record; PostgreSQL remains authoritative for product, commerce, privacy, and operational work.

## Background work

The Free Controlled Beta uses narrowly scoped, authenticated Vercel Cron route adapters. Each adapter
invokes bounded work while PostgreSQL preserves durable leases, retry state, and recovery after a
missed or failed invocation. A separate long-running worker platform is deferred unless observed
duration or required cadence cannot fit the Vercel execution model.

The general operational worker supports:

- Account Closure;
- pending Stripe event application;
- Paid After Closure refunds;
- paid-answer detail retention purge; and
- commerce reconciliation.

The Free Controlled Beta production schedules are:

- Account Closure every minute with a batch size of 25 and 60-second database leases;
- Open-Meteo weather ingestion every three hours;
- Open-Meteo marine ingestion every three hours; and
- Google Places retention pruning daily at 02:30 Philippine time.

Pending Stripe event application, Paid After Closure refunds, paid-answer retention purge, and
commerce reconciliation remain unscheduled in production until Checkout Canary. Protected Staging
exercises their test-mode adapters on demand. Places discovery and enrichment stay lazy rather than
scheduled. Database migration and seed jobs run during controlled releases, and agent-memory sync
runs only when governed memory content changes.

The [script reference](../reference/scripts.md) defines the available commands and their boundaries.
The current repository has no `vercel.json` or authenticated cron route handlers, so those adapters
are a launch prerequisite. Vercel Cron invokes HTTP `GET` routes, shares Vercel Function duration
limits, and does not retry a failed invocation; adapters must therefore stay bounded and leave
unfinished work durably claimable by the next invocation. See Vercel's
[Cron management documentation](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Health, monitoring, and secrets

The application exposes two redacted health contracts:

- `/api/health/live` reports process liveness without dependency checks; and
- `/api/health/ready` performs short, bounded PostgreSQL and Redis probes and returns unavailable when
  either required state service cannot safely support traffic.

External provider availability does not control readiness. Clerk, DeepSeek, Google Places,
Open-Meteo, Sentry, and PostHog failures appear in asynchronous diagnostics and alerts so the app can
degrade deliberately rather than masquerade as a dead process.

Sentry Cloud sends operational alerts to email. Slack and a separately evidenced mobile-delivery
path are deferred because they require capabilities or evidence not available on the Developer
plan. Launch evidence must demonstrate event creation, email delivery, acknowledgement, and
recovery through the real route. PostHog Cloud remains analytics-only and cannot satisfy paging or
health evidence.

The approved zero-cost monitoring design uses the Developer plan's one uptime monitor for
`/api/health/ready` and one Cron monitor for `/api/cron/operations`. Before production exists, the
uptime monitor targets protected staging with a dedicated Vercel automation-bypass header; at
launch, that same monitor moves to the public production readiness URL. Liveness and staging remain
deployment-time smoke checks. The aggregate operations Cron records weather, marine, and Places
pruning schedule state in PostgreSQL and sends one scrubbed page per failed or stale lifecycle, so
independent operational diagnosis does not require three more Sentry Cron monitors. The application
presents a truthful status banner when it is reachable but degraded. A separate hosted public
status page is deferred until General Free Availability.

Scrubbed Sentry events target 30-day retention. Allowlisted PostHog events target 90-day retention
in a US-hosted project, with session replay disabled. The 2026-08-11 vendor review found PostHog
configured for 12-month event retention, so production traffic remains blocked until the setting is
reduced or a privacy-approved variance is recorded. Prompts and message text are prohibited from
both systems. Vercel's short runtime-log window is acceptable only because material operational
events and incidents reach Sentry.

A restricted 1Password production vault is the human source of truth for recovery material and
production secrets. Vercel environment variables deliver runtime values, while provider dashboards
own provider credentials. Production, Protected Staging, and local development use distinct values;
untrusted previews receive none. Human access requires MFA, and a 90-day exercise rotates generated
credentials while verifying ownership, version metadata, rollback material, and application recovery.

## Release and network exposure

Protected Staging tracks `main`. Release Evidence applies to one immutable commit deployed there.
After authorization, production is manually built from that locked SHA; environment separation means
the production build is distinct, so evidence must verify the same Git commit and production
configuration rather than claim byte-identical artifacts.

The canonical origins are `https://asksiargao.com` and `https://staging.asksiargao.com`. Vercel
manages TLS, and preview domains receive no protected credentials. Vercel WAF rules begin in log-only
mode and are promoted to blocking or challenge behavior only after the Operator reviews observed
matches and a rollback path. A rollback must account for Vercel Cron schedules separately because an
instant deployment rollback does not roll cron configuration back automatically.

Vercel Pro reaches public PlanetScale Postgres and Redis Cloud endpoints for the Free Controlled
Beta; fixed egress and private networking are deferred. Compensating controls are verified TLS, distinct
least-privilege credentials for each environment, Redis command restrictions, MFA-protected provider
consoles, disabled administrative APIs, monitored authentication failures, and 90-day credential
rotation exercises. General Free Availability must reconsider fixed egress and provider
allowlisting from observed beta risk and pricing.

## Capacity and launch evidence

Before exposure, the exact Release Candidate must demonstrate twice the documented daily beta
limits, 25 concurrent chat streams, and 20 requests per second across non-model routes. During the
test, database connection use, Redis memory, and Vercel resource consumption remain below 70 percent.
A separate 25-answer canary exercises real production model and data providers without consuming the
load-test volume or weakening the daily cost circuits.

The release issue records the load-test inputs, exact candidate, protected environment, observed
latency, error rate, database and Redis headroom, Vercel consumption, and provider-canary outcome.
Synthetic load evidence cannot replace the real-provider canary, and provider canary traffic cannot
replace the larger deterministic capacity test.

## External services

The free product requires:

- a Clerk production instance and a separate Clerk test instance, including Google OAuth and signed
  webhooks;
- DeepSeek as the intended primary chat model provider;
- Google Places API access;
- Open-Meteo outbound access for weather and marine data;
- Sentry Cloud for operational delivery and paging; and
- PostHog Cloud for product analytics only.

OpenAI is additionally required when OpenAI fallback, audit generation, hosted agent-memory file
search, or hosted web research is enabled. Web research must remain disabled for the Free Controlled
Beta until externally derived content has the required untrusted-content boundary and adversarial
prompt-injection coverage.

Before production data flows, a production vendor register must cover Vercel, PlanetScale, Redis
Cloud, Clerk, Sentry, PostHog, DeepSeek, Google, and every conditionally enabled provider. For each
vendor it records accepted service terms and applicable data-processing agreement, region, data
categories, retention, subprocessors, account owner, billing owner, deletion procedure, and incident
contact. The register is release evidence and must be updated before enabling a new provider or data
category.

The paid Trip Pass additionally requires:

- Stripe live and test-mode resources;
- the approved one-time USD 9.99 Price;
- a signed webhook endpoint at `/api/stripe/webhook`;
- a restricted Stripe key with the required Checkout and refund permissions; and
- monitored reconciliation, refund, dispute, WAF, and paging operations.

`TRIP_PASS_CHECKOUT_MODE` remains `off` until the paid launch gates and independent authorization are
complete.

## Infrastructure not currently required

The codebase does not currently require Kubernetes, object storage, a separate queue broker, a
separate job platform, a self-hosted vector database, or a mail server. PostgreSQL owns durable
application and operational state. Redis owns shared ephemeral control state. Clerk owns
authentication delivery, and optional agent memory uses an OpenAI-hosted vector store.

## Production-readiness boundary

The [whole-application production-readiness assessment](whole-application-production-readiness-assessment-2026-08-09.md)
records all release lanes as Not Ready and Not Authorized. The infrastructure-adjacent code blockers
identified from commit `5ab8673` are closed in the current working tree:

- destructive privacy mutations share a same-origin guard;
- production PostgreSQL requires `verify-full`, and production Redis requires `rediss://`;
- durable Google Places chat logs contain query length, not raw traveler search text;
- production public knowledge fails closed instead of serving fixture-backed content;
- Clerk webhook bodies are bounded before signature verification;
- database grants cover every table created by the migration inventory, including operational state;
- a durable scanner sends every page-worthy state family through the bounded Sentry delivery path;
- the 08:00–22:00 PHT Staffed Exposure Window, emergency off control, 100-Account daily cap, and
  1,000-Travel-Answer daily cap are enforced through shared Redis state;
- model calls stop at USD 10 per day with reservation reconciliation, and every Google Places request
  participates in the USD 15 cost circuit;
- `/api/health/live` and `/api/health/ready` expose redacted liveness and bounded dependency readiness;
- authenticated bounded Vercel Cron adapters and `vercel.json` are committed interfaces;
- high and critical dependency advisories fail ordinary CI, and the two accepted transitive
  exceptions fail closed on their recorded expiry; and
- Shared Trip Links expire within 30 days, support immediate revocation, and existing non-expiring
  links are backfilled by migration.

Hosted web research remains disabled unless the separately reviewed security-boundary flag is
explicitly complete.

The relevant implementation evidence is in
[`privacy-route.ts`](../../../src/app/api/me/privacy/privacy-route.ts),
[`connection-options.ts`](../../../src/server/db/connection-options.ts),
[`redis-command-client.ts`](../../../src/server/security/redis-command-client.ts),
[`google-places-chat.ts`](../../../src/server/providers/google-places-chat.ts),
[`google-places-chat-cache.ts`](../../../src/server/providers/google-places-chat-cache.ts),
[`public-catalog.ts`](../../../src/server/public-pages/public-catalog.ts),
[`clerk-webhook-route.ts`](../../../src/app/api/clerk/webhooks/clerk-webhook-route.ts),
[`authorization-boundaries.ts`](../../../src/server/db/authorization-boundaries.ts),
[`production-exposure.ts`](../../../src/server/operations/production-exposure.ts),
[`health.ts`](../../../src/server/operations/health.ts),
[`vercel-cron.ts`](../../../src/server/operations/vercel-cron.ts), and the
[ordinary CI workflow](../../../.github/workflows/ci.yml).

A clean source tree or successful deployment does not close this boundary. The
[2026-08-11 monitoring and recovery drill](../reference/monitoring-and-recovery-drill-2026-08-11.md)
completed the emergency-stop, application rollback, database restore, RPO/RTO, and representative
secret-rotation exercises. The
[production vendor register](../reference/production-vendor-register.md) now inventories every
active and conditional provider, but it records unresolved legal and retention blockers.
Production Readiness still requires exact-SHA Foundation Gate results, protected Clerk and Stripe
provider QA where applicable, a fully monitored scheduler, the specified capacity test and provider
canary, successful Sentry acknowledgement and email delivery, a working external readiness check,
deployment-time liveness and staging health checks, and
closure of the vendor-register blockers. The
[release-candidate QA guide](../how-to-guides/run-release-candidate-qa.md) defines that evidence, while
the [free-product](../how-to-guides/launch-free-product.md) and
[Trip Pass](../how-to-guides/launch-trip-pass.md) guides define independent Launch Authorization.

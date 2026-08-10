# Production Vendor Register

This register is the production data-flow and supplier inventory for Ask Siargao as of 2026-08-11.
Alex Metelli is the account owner, billing owner, deletion operator, security/privacy owner, and
incident contact for every entry. Adding a provider or a new data category requires updating this
register before data flows.

`Registered` means the operational inventory is complete. `Conditional` means the service must not
receive production data until its stated gate is satisfied. `Blocked` means production traffic must
not start while the finding remains open.

## Runtime and operational providers

| Vendor | Purpose and service state | Region | Data categories | Retention and deletion | Contract and subprocessor record | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Vercel | Pro web runtime, protected staging, production deployment, Cron, WAF, and environment delivery | Functions in `sin1`; provider control plane is global | Application code, deployment metadata, request metadata, runtime logs, encrypted environment variables | Deployments and variables remain until project deletion; runtime logs follow the Pro plan window; delete in project settings and revoke tokens/bypass credentials | [Terms](https://vercel.com/legal/terms), [DPA](https://vercel.com/legal/dpa), and subprocessor register in the [Trust Center](https://security.vercel.com). The DPA applies to Pro use. | Registered |
| PlanetScale | Separate PostgreSQL 17 production and staging databases; production HA; PITR and backups | AWS `ap-southeast-1`, Singapore | Account, chat, provider, public-content, privacy-operation, payment-state, and audit records | Production policy `Ask Siargao 12h 7d` runs every 12 hours with seven-day retention; WAL enables PITR; the 2026-08-11 drill backup expires after 31 days; delete branches and databases in the provider console | Active paid account constitutes service-term acceptance. PlanetScale states that its [DPA covers all plans](https://planetscale.com/docs/security); obtain the exact DPA and subprocessor export from Organization Settings → Legal before launch. | Blocked: legal export missing |
| Redis Cloud | Separate paid production and staging control-state subscriptions; TLS, AOF every second, and `noeviction` | Singapore | Pseudonymous quota keys, rate limits, idempotency reservations, exposure counters, and cost-circuit state | Key TTLs are application bounded; AOF and provider backups follow the subscription; flush/delete only during an approved incident or account teardown | [Cloud Agreement](https://redis.io/legal/cloud-tos/), [DPA](https://redis.io/legal/data-processing-addendum-dpa/), and [subprocessors](https://redis.io/legal/subprocessors/). | Registered |
| Clerk | Production and test identity instances, sessions, profiles, Google OAuth, and signed webhooks | Provider-managed/global; no Singapore locality evidence is recorded | Email, name/profile fields, external identity references, session metadata, and closure state | Application closure starts immediate revocation and deletion; Clerk's DPA states deletion within 90 days after termination | [Legal terms](https://clerk.com/legal), [DPA](https://clerk.com/legal/dpa), and [subprocessors](https://clerk.com/legal/subprocessors). | Registered; record instance region if Clerk exposes one |
| Sentry | Developer-plan operational error delivery, email paging, one aggregate Cron monitor, and one readiness uptime monitor; Slack deferred | US organization | Scrubbed error and operational metadata only; prompts, email addresses, cookies, provider payloads, and precise coordinates are prohibited | Application target is 30 days; delete events/project in Sentry and revoke DSN/auth tokens | [Terms](https://sentry.io/terms/), [DPA](https://sentry.io/legal/dpa/), and [subprocessors](https://sentry.io/legal/subprocessors/). Sentry terms prohibit Personal Data unless a DPA has been entered. | Conditional: free monitor capacity is sufficient; retain DPA evidence before Personal Data is permitted |
| PostHog | US Cloud product analytics; session replay disabled | US Cloud | Allowlisted product events and pseudonymous identifiers only; no prompts or message text | Actual project setting is 12 months (`event_retention_months=12`); session recording is disabled and its unused retention setting is 30 days; delete persons/events/project through PostHog | [Terms](https://posthog.com/terms), [DPA](https://posthog.com/dpa), and [subprocessors](https://posthog.com/subprocessors). | Blocked: reduce event retention to the approved 90 days or approve the 12-month variance |
| DeepSeek | Primary chat model API | China/provider-managed | Traveler prompt and context sent for inference after application minimization; generated answer; token and cost metadata | The application does not durably log raw prompt text, but provider retention/deletion terms for downstream API data are not evidenced | [Open Platform terms](https://cdn.deepseek.com/policies/en-US/deepseek-open-platform-terms-of-service.html) and [privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html). No executed DPA or complete subprocessor register is on file. | Blocked: privacy/legal approval and DPA-equivalent evidence missing |
| Google Maps Platform | Places search and details | Provider-managed/global | Search text and location context are transmitted to Google; durable logs retain only bounded metadata and governed Places fields | Application caches and prunes Places data under the repository policy; provider contractual retention restrictions govern downloaded content | [Google Cloud terms directory](https://cloud.google.com/product-terms), [Cloud DPA](https://cloud.google.com/terms/data-processing-addendum), and [subprocessors](https://cloud.google.com/terms/subprocessors). | Registered; Places policy remains mandatory |
| Open-Meteo | Weather and marine forecasts | Switzerland/provider-managed API | Coordinates, requested forecast fields, server IP, and request metadata; no account identity | Application retention follows source-governance rules; Open-Meteo says individual API logs are deleted after 90 days | [Terms and privacy](https://open-meteo.com/en/terms). Free API use is non-commercial only; paid API is required for commercial use. No separate DPA is published. | Conditional: confirm beta is non-commercial or buy an API plan |
| 1Password | Restricted human authority for production and staging secrets | Account-selected 1Password region; exact region not exported | Credentials, secret metadata, recovery material, ownership, and rotation notes | Retain active and explicitly approved rollback versions only; delete retired items after grace periods and empty trash under the incident policy | [Terms](https://1password.com/legal/terms-of-service/), [DPA](https://1password.com/legal/dpa/), and [subprocessors](https://support.1password.com/subprocessors/). | Registered; desktop-authorized CLI access verified 2026-08-11 |

## Conditional paid and fallback providers

| Vendor | Enablement boundary | Region and data | Retention and deletion | Contract record | Status |
| --- | --- | --- | --- | --- | --- |
| OpenAI | Keep fallback, audit generation, hosted memory, and web research disabled unless separately authorized | Provider-managed/global; prompts, outputs, vector-store content, and API metadata if enabled | API Customer Data is normally retained for no more than 30 days; delete vector stores/files explicitly | [Services Agreement](https://openai.com/policies/services-agreement/), [DPA](https://openai.com/policies/data-processing-addendum/), and [subprocessors](https://openai.com/policies/sub-processor-list/). | Conditional; currently disabled |
| Stripe | Test mode is staging QA only. No live Price, live key, or live webhook may be enabled yet | Singapore account with global payment processing; test customer, Checkout, refund, dispute, and webhook data | Test resources remain until deleted; live financial records would follow Stripe and legal retention requirements | [Services Agreement](https://stripe.com/legal/ssa), [DPA](https://stripe.com/en-sg/legal/dpa), and [service providers](https://stripe.com/legal/service-providers). | Conditional; live Stripe prohibited |

## Account, billing, deletion, and incident routing

| Vendor | Account and billing route | Deletion route | Incident and status route |
| --- | --- | --- | --- |
| Vercel | `ametel01s-projects` team | Project Settings → General; revoke project tokens and bypass credentials first | Vercel Support and [status](https://www.vercel-status.com/) |
| PlanetScale | `alex-metelli` organization | Branch/database Settings; verify no active application credential before deletion | PlanetScale Support and [status](https://www.planetscalestatus.com/) |
| Redis Cloud | Ask Siargao production/staging subscriptions | Flush only by incident approval; delete the subscription after endpoint detachment | Redis Support and [status](https://status.redis.io/) |
| Clerk | Ask Siargao production and test instances | Delete users through closure workflow; delete instance only after export and webhook shutdown | Clerk Support and [status](https://status.clerk.com/) |
| Sentry | `ametel01` / `ask-siargao` | Delete project or organization data in Sentry; revoke auth tokens and client keys | `support@sentry.io` and [status](https://status.sentry.io/) |
| PostHog | Project `550375`, `Ask Siargao` | Delete persons/events first when required; project deletion is the terminal route | PostHog Support and [status](https://status.posthog.com/) |
| DeepSeek | Platform API account | Revoke API key and request provider-side account/data deletion | `api-service@deepseek.com` and `privacy@deepseek.com` |
| Google | Google Cloud project that owns the Places API key | Revoke keys, disable APIs, delete cached governed data, then close the project | Google Cloud Support and [status](https://status.cloud.google.com/) |
| Open-Meteo | Free API or paid subscription account | Stop calls and request account deletion at `info@open-meteo.com` | `info@open-meteo.com` |
| 1Password | Ask Siargao Production and Ask Siargao Staging vaults | Archive retired items, empty trash only after rollback grace, then delete vault/account | 1Password Support and [status](https://status.1password.com/) |
| OpenAI | Conditional API organization | Revoke keys; delete files/vector stores and organization data before closure | OpenAI Support and [status](https://status.openai.com/) |
| Stripe | Test-mode account; live mode not authorized | Delete test objects where supported, roll keys, remove webhooks, then close account | Stripe Support and [status](https://status.stripe.com/) |

## Secret classes and 90-day exercise

| Secret class | Authority | Rotation rule | Last exercise | Next due |
| --- | --- | --- | --- | --- |
| Vercel automation bypass | Vercel project | Revoke and regenerate; redeploy the environment-selected value; verify protected probes | 2026-08-11, two credentials rotated | 2026-11-09 |
| Vercel Cron bearer | Vercel staging environment; restricted staging vault | Generate a new high-entropy value, update both authorities, redeploy, verify authenticated 200, and retire the prior value | 2026-08-11, staging value rotated and synchronized | 2026-11-09 |
| PlanetScale runtime, migration, and reporting roles | PlanetScale; references in 1Password | Create replacement least-privilege roles, deploy, verify separation, revoke old roles | Credential separation verified 2026-08-11; no full credential replacement in this drill | 2026-11-09 |
| Redis URLs | Redis Cloud; 1Password | Create replacement credentials, update one environment, verify TLS and counters, revoke old credentials | Not rotated in this drill | Before production traffic or 2026-11-09, whichever is earlier |
| Clerk secret and webhook keys | Clerk; 1Password | Add replacement, deploy, verify auth/webhook, remove prior key | Not rotated in this drill | Before production traffic or 2026-11-09 |
| DeepSeek, Google, OpenAI, and Stripe keys | Provider; 1Password | Replace by environment, run provider canary, revoke prior key | Not rotated in this drill | Before each provider is authorized, then every 90 days |
| Application HMAC and encryption keys | 1Password | Versioned deployment with documented grace and rollback; never overwrite without compatibility review | Ownership recorded; replacement not exercised | Before production traffic or 2026-11-09 |
| Sentry DSN and PostHog project key | Provider project | Public ingestion identifiers are not authentication secrets; rotate on abuse or project transfer | Scope reviewed 2026-08-11 | Review every 90 days |

The 2026-08-11 rotation exercised an actual generated credential family without printing the new
values. Post-rotation Vercel protected probes passed and the current staging deployment was built
with the regenerated environment-selected credential. The exercise does not claim that every
provider credential was replaced.

## Open launch blockers

1. Export and retain the PlanetScale DPA, subprocessor list, and service-term acceptance record from
   Organization Settings → Legal.
2. Execute or retain evidence of the Sentry DPA before any event can contain Personal Data.
3. Resolve the DeepSeek downstream API privacy and DPA gap, or replace the production model provider.
4. Reduce PostHog event retention from 12 months to 90 days, or record a privacy-approved variance.
5. Confirm non-commercial Open-Meteo eligibility or purchase the appropriate commercial API plan.

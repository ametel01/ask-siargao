# Routes And Surfaces Reference

## Product Pages

| Route | Purpose | Indexing |
| --- | --- | --- |
| `/` | Landing page and audit intake form | Public |
| `/audits/[auditRequestId]/status` | Post-checkout processing/status page | Private audit surface |
| `/audits/[auditRequestId]/report?token=...` | Signed-token paid report delivery for published, paid, reviewer-approved audits | `x-robots-tag: noindex, nofollow` |
| `/audits/demo/report` | Synthetic report fixture for local QA only | `x-robots-tag: noindex, nofollow` |
| `/admin/diagnostics` | Operator diagnostics console | `x-robots-tag: noindex, nofollow` |

## Audit APIs

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/audit/intake` | `POST` | Validate intake, resolve accommodation context, run completeness gate, and return preview risk when eligible | Intake rate limit |
| `/api/audit/checkout` | `POST` | Create Stripe Checkout only for complete, eligible audits | Checkout rate limit |
| `/api/stripe/webhook` | `POST` | Verify Stripe webhook signatures and record payment success | Provider-call rate limit and webhook secret |

## Public Knowledge Surfaces

Each public page family is generated from the same `PublicKnowledgePage` fact records.

| Family | Human Route | LLM Markdown Route | JSON Route |
| --- | --- | --- | --- |
| Accommodations | `/accommodations/[slug]` | `/accommodations/[slug]/llm.md` | `/api/public/accommodations/[slug].json` |
| Areas | `/areas/[slug]` | `/areas/[slug]/llm.md` | `/api/public/areas/[slug].json` |
| Routes | `/routes/[slug]` | `/routes/[slug]/llm.md` | `/api/public/routes/[slug].json` |
| Operators | `/operators/[slug]` | `/operators/[slug]/llm.md` | `/api/public/operators/[slug].json` |
| Risks | `/risks/[slug]` | `/risks/[slug]/llm.md` | `/api/public/risks/[slug].json` |

Public index routes:

- `/api/public/entities`
- `/api/public/evidence`
- `/api/public/risk-preview`
- `/sitemap.xml`
- `/llms.txt`
- `/robots.txt`

Public APIs use the `public_api` rate-limit policy. Public eligibility blocks private user data, raw provider payloads, non-republishable facts, low-confidence facts, and weak entity matches.

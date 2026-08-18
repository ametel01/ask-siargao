# Routes And Surfaces Reference

## Clerk Perimeter Inventory

`src/server/auth/clerk-route-policy.ts` is the executable source of truth for the Clerk proxy
perimeter. Its inventory is source-derived and currently covers all 63 live
`src/app/**/page.tsx` and `src/app/**/route.ts` runtime surfaces. Every entry has exactly one base
classification:

| Classification | Routes |
| --- | --- |
| `protected` | `/settings`, `/profile`, `/admin/diagnostics`, `/audits/[auditRequestId]/status`, `/api/me/**`, `/api/chat/threads/**`, and `/api/chat/ratings` |
| `externally_verified` | `/api/clerk/webhooks`, `/api/stripe/webhook` (legacy evidence), and `/api/payments/lemon-squeezy/webhook` |
| `public` | `/`, `/chat`, sign-in/sign-up, public knowledge pages, LLM/robots/sitemap routes, signed report/share delivery, retired audit intake/checkout tombstones, anonymous chat/save/share APIs, public JSON APIs, and `/audits/demo/report` in its non-production QA context |

Unknown application paths matched by `src/proxy.ts` are denied. Supplemental policies such as rate
limits, signed report/share tokens, admin token checks, non-production QA availability, and
resource ownership remain handler-level authorities; they do not replace the base classification.

## Product Pages

| Route | Purpose | Indexing |
| --- | --- | --- |
| `/` | Ask Siargao chat-first landing page | Public |
| `/chat` | Ask Siargao assistant workspace with anonymous chat, signed-in chat history, and on-demand accommodation, itinerary, immediate-plan, surf-session, and disruption Reality Checks | Public |
| `/legal/privacy` | Public controlled-beta privacy notice covering model-provider, location, account, storage, and operational data flows | Public |
| `/trips/shared/[token]` | Public shared saved-trip plan with selected cards/itineraries only | `noindex, nofollow` metadata |
| `/settings` | Signed-in traveler trip brief with structured current-trip and durable-preference controls, private chat and saved-planning summaries, granular privacy actions, and terminal Account Closure with signed recent-factor reverification | Private authenticated surface |
| `/profile` | Compatibility alias that renders the signed-in traveler trip brief | Private authenticated surface |
| `/audits/[auditRequestId]/status` | Post-checkout processing/status page | Private audit surface |
| `/audits/[auditRequestId]/report?token=...` | Signed-token paid report delivery for published, paid, reviewer-approved audits | `x-robots-tag: noindex, nofollow` |
| `/audits/demo/report` | Synthetic report fixture for local QA only | `x-robots-tag: noindex, nofollow` |
| `/admin/diagnostics` | Operator diagnostics console | `x-robots-tag: noindex, nofollow` |

## Audit APIs

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/audit/intake` | `POST` | Return the stable `410` retirement tombstone; this route cannot create or advertise a payment-ready audit | Intake rate limit |
| `/api/audit/checkout` | `POST` | Return the stable `410` retirement tombstone without invoking the legacy payment lifecycle | Checkout rate limit |
| `/api/stripe/webhook` | `POST` | Bound and verify Stripe webhook signatures, commit a normalized versioned event receipt, then apply or retry payment state | Webhook secret; verified processing is independent of Redis/provider-call rate limits |
| `/api/payments/lemon-squeezy/webhook` | `POST` | Bound and verify the Lemon Squeezy signature, persist a fingerprinted normalized Payment Event Receipt, then apply or retry provider-neutral Trip Pass payment facts | `X-Signature` plus Lemon Squeezy webhook secret; raw payloads are not retained |

## Auth APIs

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/clerk/webhooks` | `POST` | Verify Clerk webhook signatures and sync local user identity cache rows for user create, update, and delete events | Public at the Clerk proxy layer; Clerk webhook signature required |
| `/api/me/profile` | `GET`, `PATCH` | Return a browser-safe traveler identity/profile DTO and read or partially update owner-scoped profile details; structured preference writes use stable bounded values and preserve legacy values until deliberately changed | Clerk-authenticated user only |
| `/api/me/privacy` | `POST` | Execute strict confirmed privacy actions for the current user: delete all owned chat history from active product tables, delete all owned saved planning data while invalidating affected public share snapshots, or clear stored area/accommodation context | Clerk-authenticated user only; ownership is derived from Clerk auth only |
| `/api/me/account-closure` | `POST` | Commit terminal Account Closure, revoke active sharing/access/Trip Pass use, and enqueue independently retryable provider deletion, local erasure, and commerce minimization | Clerk-authenticated user only; exact `CLOSE MY ACCOUNT` confirmation, same-origin request, and Clerk-signed second-factor age of at most five minutes |

## Chat APIs

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/chat` | `POST` | Validate an explicitly submitted chat turn, run the Ask Siargao agent, return selected public artifacts and optional server-validated Reality Check summaries, and persist owner-scoped thread/messages when a Clerk session is present. A usable terminal fallback returns `200` with `completionStatus: "completed_with_limits"` and a budget-exhausted, invalid-response, or provider-unavailable `terminationReason` instead of a generation error. | Public for anonymous stateless chat; Clerk-authenticated requests persist owned turns. Production DeepSeek requests require the exact current model-provider acknowledgement cookie before rate limiting or model access; missing or stale consent returns `428`. |
| `/api/chat/threads` | `GET`, `POST` | List the current user's non-deleted chat threads newest first or create an empty owned thread | Clerk-authenticated user only |
| `/api/chat/threads/[threadId]` | `GET`, `PATCH`, `DELETE` | Hydrate an owned chat thread with messages, rename or archive it, or soft-delete it | Clerk-authenticated owner only; cross-user access returns `404` |
| `/api/chat/ratings` | `PUT` | Create or update the current user's rating for an owned assistant message | Clerk-authenticated owner only; cross-user access returns `404` and user-message targets return `400` |
| `/api/privacy/model-provider-consent` | `GET`, `POST` | Report the current model-provider acknowledgement status or record the exact current version in a bounded HttpOnly cookie | Public read; write requires the shared same-origin mutation policy and an exact versioned request body |

Authenticated chat persistence stores user and assistant-visible message content, public sources,
selected public artifacts, redacted tool-call summaries without raw arguments, and browser-location
context summaries without exact coordinates.

Qualifying explicit requests can return one entry in `decisionSummaries` with `kind`, `verdict`,
`subject`, `bestAction`, `basis`, optional fallback/avoid/timing/area fields, and server-derived
public sources. Its ID and sources are server-owned; model-referenced evidence call IDs are not
public. Older summaries without `kind`, `verdict`, or `subject` remain valid. Selected cards and
itineraries stay in their existing response arrays and are filtered independently. Loading `/chat`
or a prompt deep link does not submit `POST /api/chat`.

`POST /api/me/privacy` with `delete_chat_history` physically removes the authenticated user's
ratings, messages, and threads from active chat tables, including archived and soft-deleted threads.
The request body never accepts a user ID; malformed action or confirmation fields return `400`, and
unauthenticated requests return `401`.

## Saved Trip Sharing APIs

The `/chat` workspace lets unauthenticated travelers save recommendation cards and itinerary
artifacts locally, then sync only selected saved items when creating a share link. Local browser
state uses an anonymous `local_trip_*` ID; the server hashes that client trip key before storing
saved items.

| Route | Method | Purpose | Protection |
| --- | --- | --- | --- |
| `/api/trips/saved?tripId=...` | `GET` | List non-deleted saved items for an anonymous local trip or an owned signed-in trip | Public API rate limit; owned trip keys require matching Clerk user |
| `/api/trips/saved` | `GET` | List the current signed-in user's latest saved trip without requiring `tripId` | Clerk-authenticated user only |
| `/api/trips/saved` | `POST` | Upsert selected saved card/itinerary/note artifacts and associate them with the current user when signed in | Public API rate limit; signed-in local-trip migration only claims unowned or already owned trips |
| `/api/trips/saved/[itemId]` | `DELETE` | Soft-delete a saved item by anonymous trip ownership or current signed-in user ownership | Public API rate limit; cross-user owned trips return `404` |
| `/api/trips/share` | `POST` | Create a public share token for selected saved item IDs after verifying anonymous or signed-in ownership | Public API rate limit; cross-user owned trips return `404` |
| `/api/trips/share/[token]` | `GET` | Return a shared plan DTO for a valid, non-expired, non-deleted token | Public API rate limit |

Shared plans render only selected saved artifacts, safe map links, sanitized source summaries,
source labels, confidence/freshness metadata, checked-source details, governed traveler-safe
`notChecked` source context, and public display caveats. Public `notChecked` rows describe source
coverage limits that are safe for travelers to see, such as source-specific topics that were not
verified before sharing. They are distinct from private/internal verification-gap caveats: saved
cards, itinerary stops, and skip notes filter internal caveats before public rendering.

Save/share schemas reject full chat messages/transcripts, client geolocation and exact coordinates,
raw tool calls or arguments, raw provider payloads, private source observations, Google review
fields/text/author data, owner IDs, profile details, and secret tokens. Expired or deleted share
tokens return a generic unavailable/not-found response without exposing token status.

`POST /api/me/privacy` with `delete_saved_planning_data` removes every saved trip owned by the
authenticated user, its saved items, and all affected `shared_trip_plans` snapshots and token hashes
in one transaction. Anonymous trips and another user's trips or shares are not affected. Previously
issued affected share URLs resolve through the existing generic unavailable/not-found response.

## Authenticated Data Privacy Checklist

- Chat history stores user and assistant-visible message content, public sources, selected public
  artifacts, redacted tool-call summaries, and browser-location summaries only.
- Chat history does not persist exact browser coordinates, raw provider payloads, non-public Google
  review text, or Google review author attribution.
- Chat thread, rating, profile, and authenticated saved-trip routes derive ownership from Clerk
  auth, never request body user IDs.
- Cross-user chat thread, message rating, saved-trip delete, and saved-trip share attempts return
  `404`.
- Public shared-trip links expose only selected public saved artifacts, sanitized source labels and
  summaries, checked-source details, governed traveler-safe `notChecked` source context, and public
  display caveats; they do not include owner IDs, profile details, chat transcripts, browser
  geolocation, raw provider payloads, private source observations, Google review text/author data,
  secret tokens, or exact coordinates.
- Privacy actions are transactional and repeat-safe. Successful and failed attempts emit sanitized
  server audit evidence containing only action type, actor reference, request ID, timestamp, outcome,
  and coarse counts. Audit evidence must not include message text, saved artifact payloads, share
  tokens or hashes, profile free text, exact coordinates, raw provider/tool data, or confirmation
  phrases.
- Location privacy distinguishes one-request browser geolocation, in-memory trip-session
  geolocation, and stored coarse area/accommodation context. Clearing stored location context removes
  only profile `currentArea` and `accommodation` plus the current browser's matching local trip
  context after server success; unrelated profile fields and marketing consent are preserved.
- Granular privacy controls delete active product records only. Terminal Account Closure additionally
  creates an opaque tombstone, removes readable product data asynchronously, and retains only
  policy-versioned minimal commerce evidence until its configured expiry. Backup restore traffic is
  fail-closed until the privacy reapplication snapshot and closure watermark pass the restore guard.

## Public Knowledge Surfaces

Each public page family is generated from the same repository-backed `PublicKnowledgePage` governed
facts. The local demo repository is built from persisted-page-shaped fixtures. Production reads the
same shape from governed public page and evidence rows first. When that query succeeds but has no
eligible pages, production serves a five-page code-backed baseline from the product-maintained Ask
Siargao local guide. Database errors still fail closed, and production never serves the synthetic
demo fixture catalog.
The code source of truth for current families and path derivation is `src/server/public-pages/public-surface-registry.ts`; update that registry before changing this table.

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
- `/api/public/weather/siargao`
- `/sitemap.xml`
- `/llms.txt`
- `/robots.txt`

Public APIs use the `public_api` rate-limit policy. Public eligibility blocks private user data, raw provider payloads, non-republishable facts, low-confidence facts, and weak entity matches.

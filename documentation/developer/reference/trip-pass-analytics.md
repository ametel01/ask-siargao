# Trip Pass Analytics

Trip Pass analytics measure launch funnel and quota friction. They are operational evidence only:
payment, entitlement, usage, refund, and dispute authority remains in Lemon Squeezy verification and the
server database ledger.

## Sink

Server events use `trackServerEvent` and a timeout-bounded PostHog-compatible capture sink when
`NEXT_PUBLIC_POSTHOG_KEY` is configured. Sink failures are logged and do not fail checkout, webhook,
chat, or quota responses. Tests can inject a sink without enabling live network delivery.

Client pricing views are sent only from the landing pricing section through
`POST /api/observability/events`. Its Trip Pass branch accepts only `trip_pass_pricing_viewed` with
`surface=landing`; the browser beacon honors `navigator.doNotTrack`. The same endpoint also has a
separate, strictly validated [planning-guide analytics](planning-guide-analytics.md) contract.

## Event Matrix

| Event | Source | Safe fields |
| --- | --- | --- |
| `trip_pass_pricing_viewed` | Landing pricing section | `productCode`, `productVersion`, `surface`, `status` |
| `trip_pass_checkout_started` | Authenticated settings checkout route | `productCode`, `productVersion`, `surface`, `status`, `checkoutAvailable`, `reason` |
| `trip_pass_checkout_failed` | Checkout route or verified Payment Authority failure | `applicationStatus`, `eventType`, `reason`, `status` |
| `trip_pass_activated` | Verified Lemon Squeezy webhook | `productCode`, `productVersion`, `eventType`, `applicationStatus`, `action`, `status` |
| `trip_pass_refund_transition` | Verified refund webhook | `eventType`, `applicationStatus`, `action`, `status` |
| `trip_pass_dispute_transition` | Verified dispute webhook | `eventType`, `applicationStatus`, `action`, `status` |
| `trip_pass_expired` | Verified checkout expiry webhook | `eventType`, `applicationStatus`, `action`, `status` |
| `trip_pass_meter_warning` | Paid usage settlement near limits | `meterType`, `used`, `limit`, `remaining`, `status` |
| `trip_pass_meter_exhausted` | Paid usage reservation or settlement denial | `meterType`, `used`, `limit`, `remaining`, `reason`, `status` |
| `trip_pass_free_allowance_blocked` | Anonymous/free allowance guard | `status`, `reason`, coarse actor key versions |
| `llm_cost_recorded` | Completed agent turn | call counts, token totals, cache totals, mode/fallback/cost/latency projections |

The allowlist also reserves names for cached fallback, provider budget warning/exhaustion, identity
challenge, reset velocity, and reconciliation failure so later support tooling can use the same
privacy contract.

## Prohibited Fields

Analytics payloads must not contain prompts, message text, email, raw user IDs, raw IP, precise
coordinates, cookies, idempotency keys, Stripe IDs, checkout session IDs, payment intent IDs,
webhook bodies, provider payloads, secrets, tokens, or upstream request IDs. The event helper applies
the shared redactor first, then drops prohibited keys and non-allowlisted fields before sink
delivery.

## Suggested PostHog Views

- Pricing-to-checkout: count `trip_pass_pricing_viewed` and `trip_pass_checkout_started` by day.
- Checkout-to-activation: count `trip_pass_checkout_started`, `trip_pass_checkout_failed`, and
  `trip_pass_activated` by `applicationStatus`.
- Meter friction: count `trip_pass_meter_warning` and `trip_pass_meter_exhausted` by `meterType`.
- Free-limit friction: count `trip_pass_free_allowance_blocked` by `status` and `reason`.
- Cost per answer: average `totalModeledCostUsd`, `callCount`, and cache-hit/cache-miss token totals
  from `llm_cost_recorded`.
- Fallback share: count `llm_cost_recorded` where `fallbackUsed=true`, grouped by model and mode.

# Trip Pass Perimeter Rules

This runbook keeps perimeter controls monitorable and reversible. Product allowance remains enforced
by the application quota store; WAF rules only reduce obvious automated load before it reaches the
app.

## Initial Log-Mode Rules

Create these Vercel WAF rules in log mode first:

| Rule | Match | Action | Notes |
| --- | --- | --- | --- |
| `chat-high-rate` | path starts `/api/chat` and high request rate by IP or JA4 | log | Promote to challenge only after application `trip_pass_free_allowance_blocked` events confirm abuse. |
| `checkout-high-rate` | path starts `/api/me/trip-pass/checkout` or `/api/audit/checkout` and high rate by IP or JA4 | log | Never bypass Stripe/webhook server checks; this is edge throttling only. |
| `auth-entry-high-rate` | path starts `/sign-in`, `/sign-up`, or Clerk auth entry routes and high rate by IP or JA4 | log | Use challenge before deny so shared networks can still authenticate. |
| `spoofed-forwarded-headers` | direct traffic with untrusted `x-forwarded-for` or `x-real-ip` patterns | log | Application code ignores these unless trusted ingress is configured. |

## Promotion Criteria

Promote log to challenge when all are true:

- The same IP or JA4 produces repeated `challenge_required` outcomes or idempotency conflicts.
- The traffic has low successful completion value, such as repeated denied allowance or checkout
  attempts.
- Normal shared-network traffic remains below the account/fresh-trip velocity thresholds.

Promote challenge to deny only for clearly non-browser automation that keeps retrying after
challenge. Deny rules need a 24-hour expiry and an owner in the incident notes.

## Rollback

Rollback is immediate:

1. Set the WAF rule action back to log.
2. Confirm `/api/chat`, checkout, and auth entry requests reach the app.
3. Check app telemetry for normal successful requests and no spike in `challenge_required` results.

## Verification

Before promotion, record:

- Vercel rule IDs, match expression, action, owner, and expiry.
- A sample of WAF log-mode matches without raw prompt, email, cookie, or precise location data.
- Matching app telemetry counts for `trip_pass_free_allowance_blocked`, idempotency conflicts, and
  cost-circuit blocks.

-- Preserve historical Stripe evidence in the provider-neutral receipt ledger before
-- the legacy Stripe inbox is retired. This is additive and idempotent.

ALTER TABLE trip_pass_payment_event_receipts
  DROP CONSTRAINT IF EXISTS trip_pass_payment_event_receipts_provider_check;

ALTER TABLE trip_pass_payment_event_receipts
  ADD CONSTRAINT trip_pass_payment_event_receipts_provider_check CHECK (
    provider IN ('lemon_squeezy', 'stripe')
  );

INSERT INTO trip_pass_payment_event_receipts (
  id, fingerprint, provider, event_name, object_id, provider_updated_at,
  order_id, provider_order_id, status, amount_total_minor, currency,
  normalized_facts_json, attempt_count, applied_at, created_at, updated_at
)
SELECT
  'stripe_payment_receipt_' || md5(e.stripe_event_id),
  md5(concat('stripe', E'\n', e.stripe_event_id, E'\n', e.event_type)),
  'stripe', e.event_type, e.stripe_event_id, coalesce(e.updated_at, e.received_at),
  e.order_id, e.payment_intent_id,
  e.status, e.amount_total_minor, e.currency,
  coalesce(e.normalized_facts_json, '{}'::jsonb), e.attempt_count,
  e.applied_at, e.created_at, e.updated_at
FROM trip_pass_stripe_events e
ON CONFLICT (fingerprint) DO NOTHING;

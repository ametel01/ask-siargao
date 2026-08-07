-- Rollback strategy: keep this expand-first reservation/consent state in place, disable
-- Trip Pass checkout with TRIP_PASS_CHECKOUT_MODE=off, and apply forward repair for
-- malformed order rows. Do not drop retained commerce evidence in production rollback.

ALTER TABLE trip_pass_orders
  ADD COLUMN product_family text,
  ADD COLUMN checkout_session_expires_at timestamptz,
  ADD COLUMN checkout_session_status text,
  ADD COLUMN checkout_cancellation_confirmed_at timestamptz,
  ADD COLUMN terms_policy_version text,
  ADD COLUMN refund_policy_version text,
  ADD COLUMN privacy_policy_version text,
  ADD COLUMN retention_policy_version text,
  ADD COLUMN terms_consent_presented_at timestamptz;

UPDATE trip_pass_orders
SET product_family = 'siargao_trip_pass'
WHERE product_family IS NULL
  AND product_code IN ('siargao_trip_pass_14d_v1', 'siargao_trip_pass_14d_v2');

UPDATE trip_pass_orders
SET product_family = product_code
WHERE product_family IS NULL;

ALTER TABLE trip_pass_orders
  ALTER COLUMN product_family SET NOT NULL,
  ALTER COLUMN product_family SET DEFAULT 'siargao_trip_pass',
  ADD CONSTRAINT trip_pass_orders_product_family_check CHECK (product_family <> ''),
  ADD CONSTRAINT trip_pass_orders_checkout_session_status_check CHECK (
    checkout_session_status IS NULL OR checkout_session_status IN ('open', 'complete', 'expired')
  );

CREATE INDEX trip_pass_orders_user_family_effective_pending_idx
  ON trip_pass_orders(user_id, product_family, status, created_at)
  WHERE status IN ('pending', 'checkout_created');

CREATE INDEX trip_pass_orders_product_family_idx
  ON trip_pass_orders(product_family);

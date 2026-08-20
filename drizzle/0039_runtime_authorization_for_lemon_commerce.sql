-- Production roles were provisioned before these Lemon Squeezy and reconciliation tables existed.
-- A LOGIN member of ask_siargao_migration does not use that group role's default privileges unless
-- it explicitly SET ROLE, so repair both ownership and runtime DML access additively.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ask_siargao_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE
        trip_pass_checkout_attempts,
        trip_pass_payment_event_receipts,
        trip_pass_payment_facts,
        trip_pass_refund_operations,
        operational_reconciliation_cursors,
        operator_refund_actions
      TO ask_siargao_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ask_siargao_migration') THEN
    ALTER TABLE trip_pass_checkout_attempts OWNER TO ask_siargao_migration;
    ALTER TABLE trip_pass_payment_event_receipts OWNER TO ask_siargao_migration;
    ALTER TABLE trip_pass_payment_facts OWNER TO ask_siargao_migration;
    ALTER TABLE trip_pass_refund_operations OWNER TO ask_siargao_migration;
    ALTER TABLE operational_reconciliation_cursors OWNER TO ask_siargao_migration;
    ALTER TABLE operator_refund_actions OWNER TO ask_siargao_migration;
  END IF;
END
$$;

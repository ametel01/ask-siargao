ALTER TABLE operator_repair_actions
  DROP CONSTRAINT IF EXISTS operator_repair_actions_action_check;

ALTER TABLE operator_repair_actions
  ADD CONSTRAINT operator_repair_actions_action_check CHECK (
    action_type IN (
      'grant_missing_trip_pass', 'initialize_missing_meters', 'release_stale_reservation',
      'manual_commerce_transition', 'goodwill_grant', 'account_recovery', 'refund_trip_pass'
    )
  );

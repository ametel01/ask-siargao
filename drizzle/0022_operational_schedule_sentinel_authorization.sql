DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ask_siargao_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE operational_schedule_states
      TO ask_siargao_runtime;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ask_siargao_migration') THEN
    ALTER TABLE operational_schedule_states OWNER TO ask_siargao_migration;
  END IF;
END
$$;

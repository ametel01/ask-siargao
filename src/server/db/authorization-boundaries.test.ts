import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  applicationTables,
  buildDatabaseAuthorizationRepairSql,
  buildDatabaseAuthorizationSql,
  defaultReportingTables,
  userOwnedTables,
} from "@/server/db/authorization-boundaries";
import { listMigrationPaths } from "@/server/db/migration-files";

describe("database authorization boundaries", () => {
  test("generates separated migration, runtime, and reporting role grants", () => {
    const sql = buildDatabaseAuthorizationSql();

    expect(sql).toContain('CREATE ROLE "ask_siargao_migration" NOLOGIN;');
    expect(sql).toContain('CREATE ROLE "ask_siargao_runtime" NOLOGIN;');
    expect(sql).toContain('CREATE ROLE "ask_siargao_reporting" NOLOGIN;');
    expect(sql).toContain('GRANT CREATE ON SCHEMA "public" TO "ask_siargao_migration";');
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "users", "account_closure_tombstones"',
    );
    expect(sql).toContain('TO "ask_siargao_runtime";');
    expect(sql).toContain('GRANT SELECT ON TABLE "areas", "routes"');
    expect(sql).toContain('TO "ask_siargao_reporting";');
    expect(sql).not.toContain(
      'ALTER DEFAULT PRIVILEGES FOR ROLE "ask_siargao_migration" IN SCHEMA "public" GRANT SELECT ON TABLES TO "ask_siargao_reporting";',
    );
    expect(sql).not.toMatch(/\bSUPERUSER\b/i);
    expect(sql).not.toMatch(/\bCREATEDB\b/i);
    expect(sql).not.toMatch(/\bCREATEROLE\b/i);
  });

  test("revokes public defaults and keeps the migration ledger out of runtime grants", () => {
    const sql = buildDatabaseAuthorizationSql();

    expect(sql).toContain('REVOKE ALL ON DATABASE "ask_siargao" FROM PUBLIC;');
    expect(sql).toContain('REVOKE ALL ON SCHEMA "public" FROM PUBLIC;');
    expect(sql).toContain('REVOKE CREATE ON SCHEMA "public" FROM PUBLIC;');
    expect(sql).toContain('REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM PUBLIC;');
    expect(sql).toContain('REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM PUBLIC;');
    expect(sql).toContain('"schema_migrations" OWNER TO "ask_siargao_migration";');
    expect(sql).not.toContain('"schema_migrations" TO "ask_siargao_runtime"');
  });

  test("documents the current application, reporting, and user-owned table sets", () => {
    expect(applicationTables).toContain("chat_threads");
    expect(applicationTables).toContain("audit_reports");
    expect(applicationTables).toContain("paid_answer_reservations");
    expect(applicationTables).toContain("provider_health_checks");
    expect(applicationTables).toContain("trip_pass_stripe_events");
    expect(applicationTables).toContain("operational_reconciliation_runs");
    expect(applicationTables).toContain("operational_findings");
    expect(applicationTables).toContain("operational_reconciliation_cursors");
    expect(applicationTables).toContain("operator_repair_actions");
    expect(applicationTables).toContain("operational_alert_deliveries");
    expect(applicationTables).toContain("operational_worker_tasks");
    expect(applicationTables).toContain("operational_reconciliation_observations");
    expect(applicationTables).toContain("operational_schedule_states");
    expect(applicationTables).not.toContain("schema_migrations");

    expect(defaultReportingTables).toContain("public_pages");
    expect(defaultReportingTables).not.toContain("users");
    expect(defaultReportingTables).not.toContain("payments");

    expect(userOwnedTables).toEqual([
      "users",
      "account_closure_tombstones",
      "account_closure_operations",
      "account_closure_steps",
      "account_closure_provider_subjects",
      "account_closure_checkout_sessions",
      "account_closure_refund_obligations",
      "account_closure_write_barriers",
      "retained_commerce_evidence",
      "user_profiles",
      "chat_threads",
      "chat_messages",
      "chat_response_ratings",
      "saved_trips",
      "saved_trip_items",
      "shared_trip_plans",
      "trip_passes",
      "trip_usage_meters",
      "trip_pass_orders",
      "trip_pass_grants",
      "trip_pass_refund_facts",
      "trip_pass_dispute_facts",
      "trip_usage_events",
      "paid_answer_reservations",
    ]);
  });

  test("grants runtime access to every application table created by migrations", async () => {
    const migrationSql = await Promise.all(
      (await listMigrationPaths()).map((migrationPath) => readFile(migrationPath, "utf8")),
    );
    const migratedTables = migrationSql.flatMap((sql) =>
      Array.from(
        sql.matchAll(/create\s+table(?:\s+if\s+not\s+exists)?\s+([a-z_][a-z0-9_]*)/gi),
        (match) => match[1],
      ),
    );

    const grantedTables: string[] = [...applicationTables];
    expect(grantedTables.sort()).toEqual([...new Set(migratedTables)].sort());
  });

  test("rejects unsafe SQL identifiers instead of interpolating them", () => {
    expect(() =>
      buildDatabaseAuthorizationSql({
        runtimeRole: 'runtime"; grant all on schema public to x; --',
      }),
    ).toThrow(/Unsafe SQL identifier/);
  });

  test("generates an idempotent repair for already-provisioned operational tables", () => {
    const sql = buildDatabaseAuthorizationRepairSql();

    expect(sql).toContain(
      'ALTER TABLE "operational_reconciliation_observations" OWNER TO "ask_siargao_migration";',
    );
    expect(sql).toContain(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "operational_alert_deliveries" TO "ask_siargao_runtime";',
    );
    expect(sql).not.toContain("CREATE ROLE");
  });
});

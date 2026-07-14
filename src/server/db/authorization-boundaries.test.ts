import { describe, expect, test } from "bun:test";

import {
  applicationTables,
  buildDatabaseAuthorizationSql,
  defaultReportingTables,
  userOwnedTables,
} from "@/server/db/authorization-boundaries";

describe("database authorization boundaries", () => {
  test("generates separated migration, runtime, and reporting role grants", () => {
    const sql = buildDatabaseAuthorizationSql();

    expect(sql).toContain('CREATE ROLE "ask_siargao_migration" NOLOGIN;');
    expect(sql).toContain('CREATE ROLE "ask_siargao_runtime" NOLOGIN;');
    expect(sql).toContain('CREATE ROLE "ask_siargao_reporting" NOLOGIN;');
    expect(sql).toContain('GRANT CREATE ON SCHEMA "public" TO "ask_siargao_migration";');
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "users", "user_profiles"');
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
    expect(applicationTables).toContain("provider_health_checks");
    expect(applicationTables).not.toContain("schema_migrations");

    expect(defaultReportingTables).toContain("public_pages");
    expect(defaultReportingTables).not.toContain("users");
    expect(defaultReportingTables).not.toContain("payments");

    expect(userOwnedTables).toEqual([
      "users",
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
      "trip_usage_events",
    ]);
  });

  test("rejects unsafe SQL identifiers instead of interpolating them", () => {
    expect(() =>
      buildDatabaseAuthorizationSql({
        runtimeRole: 'runtime"; grant all on schema public to x; --',
      }),
    ).toThrow(/Unsafe SQL identifier/);
  });
});

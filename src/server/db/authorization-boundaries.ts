export type DatabaseAuthorizationTemplateOptions = {
  databaseName?: string;
  schemaName?: string;
  migrationRole?: string;
  runtimeRole?: string;
  reportingRole?: string;
  reportingTables?: readonly string[];
};

export const applicationTables = [
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
  "areas",
  "routes",
  "providers",
  "source_profiles",
  "source_permissions",
  "entities",
  "accommodations",
  "raw_snapshots",
  "source_records",
  "google_places",
  "google_place_snapshots",
  "google_place_details",
  "google_place_reviews",
  "candidate_entities",
  "entity_matches",
  "facts",
  "evidence",
  "reviews",
  "fact_confidence_scores",
  "source_credibility_scores",
  "fact_conflicts",
  "audit_requests",
  "audit_inputs",
  "audit_runs",
  "audit_completeness_checks",
  "payments",
  "payment_events",
  "audit_reports",
  "refresh_jobs",
  "public_evidence_bundles",
  "public_pages",
  "agent_readable_snapshots",
  "llm_runs",
  "llm_tool_calls",
  "reviewer_results",
  "provider_health_checks",
  "public_page_generation_jobs",
] as const;

export const userOwnedTables = [
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
] as const;

export const defaultReportingTables = [
  "areas",
  "routes",
  "providers",
  "source_profiles",
  "source_permissions",
  "entities",
  "accommodations",
  "facts",
  "evidence",
  "reviews",
  "fact_confidence_scores",
  "source_credibility_scores",
  "fact_conflicts",
  "public_evidence_bundles",
  "public_pages",
  "agent_readable_snapshots",
  "provider_health_checks",
  "public_page_generation_jobs",
] as const;

const ledgerTable = "schema_migrations";

export function buildDatabaseAuthorizationSql(options: DatabaseAuthorizationTemplateOptions = {}) {
  const databaseName = quoteIdentifier(options.databaseName ?? "ask_siargao");
  const schemaName = quoteIdentifier(options.schemaName ?? "public");
  const migrationRole = quoteIdentifier(options.migrationRole ?? "ask_siargao_migration");
  const runtimeRole = quoteIdentifier(options.runtimeRole ?? "ask_siargao_runtime");
  const reportingRole = quoteIdentifier(options.reportingRole ?? "ask_siargao_reporting");
  const runtimeTables = applicationTables.map(quoteIdentifier).join(", ");
  const migratorTableOwnershipSql = [...applicationTables, ledgerTable]
    .map((table) => `ALTER TABLE ${quoteIdentifier(table)} OWNER TO ${migrationRole};`)
    .join("\n");
  const reportingTables = (options.reportingTables ?? defaultReportingTables)
    .map(quoteIdentifier)
    .join(", ");

  return [
    "-- Ask Siargao production database authorization template.",
    "-- Run as the provider bootstrap owner after migrations have created the current schema.",
    "-- Create LOGIN roles separately, grant them to these group roles, and store credentials in the provider secret store.",
    `CREATE ROLE ${migrationRole} NOLOGIN;`,
    `CREATE ROLE ${runtimeRole} NOLOGIN;`,
    `CREATE ROLE ${reportingRole} NOLOGIN;`,
    "",
    `REVOKE ALL ON DATABASE ${databaseName} FROM PUBLIC;`,
    `REVOKE ALL ON SCHEMA ${schemaName} FROM PUBLIC;`,
    `REVOKE CREATE ON SCHEMA ${schemaName} FROM PUBLIC;`,
    `REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaName} FROM PUBLIC;`,
    `REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} FROM PUBLIC;`,
    "",
    `GRANT CONNECT ON DATABASE ${databaseName} TO ${migrationRole}, ${runtimeRole}, ${reportingRole};`,
    `GRANT USAGE ON SCHEMA ${schemaName} TO ${migrationRole}, ${runtimeRole}, ${reportingRole};`,
    `GRANT CREATE ON SCHEMA ${schemaName} TO ${migrationRole};`,
    "",
    migratorTableOwnershipSql,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE ${runtimeTables} TO ${runtimeRole};`,
    `GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA ${schemaName} TO ${runtimeRole};`,
    `GRANT SELECT ON TABLE ${reportingTables} TO ${reportingRole};`,
    `GRANT SELECT ON ALL SEQUENCES IN SCHEMA ${schemaName} TO ${reportingRole};`,
    "",
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrationRole} IN SCHEMA ${schemaName} REVOKE ALL ON TABLES FROM PUBLIC;`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrationRole} IN SCHEMA ${schemaName} REVOKE ALL ON SEQUENCES FROM PUBLIC;`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrationRole} IN SCHEMA ${schemaName} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtimeRole};`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrationRole} IN SCHEMA ${schemaName} GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO ${runtimeRole};`,
  ].join("\n");
}

function quoteIdentifier(identifier: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`);
  }

  return `"${identifier}"`;
}

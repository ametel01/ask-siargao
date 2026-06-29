import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { getTableName } from "drizzle-orm";

import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import {
  accommodations,
  agentReadableSnapshots,
  areas,
  auditCompletenessChecks,
  auditInputs,
  auditReports,
  auditRequests,
  auditRuns,
  candidateEntities,
  chatMessages,
  chatResponseRatings,
  chatThreads,
  entities,
  entityMatches,
  evidence,
  factConfidenceScores,
  factConflicts,
  facts,
  googlePlaceDetails,
  googlePlaceReviews,
  googlePlaceSnapshots,
  googlePlaces,
  llmRuns,
  llmToolCalls,
  paymentEvents,
  payments,
  providerHealthChecks,
  providers,
  publicEvidenceBundles,
  publicPageGenerationJobs,
  publicPages,
  rawSnapshots,
  refreshJobs,
  reviewerResults,
  reviews,
  routes,
  savedTripItems,
  savedTrips,
  sharedTripPlans,
  sourceCredibilityScores,
  sourcePermissions,
  sourceProfiles,
  sourceRecords,
  userProfiles,
  users,
} from "@/server/db/schema";
import {
  migrationPath,
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";

describe("Step 3 database migration", () => {
  test("creates required core tables and accepts taxonomy seed rows", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    const requiredTables = [
      "users",
      "user_profiles",
      "chat_threads",
      "chat_messages",
      "chat_response_ratings",
      "saved_trips",
      "saved_trip_items",
      "shared_trip_plans",
      "audit_requests",
      "audit_inputs",
      "audit_runs",
      "audit_completeness_checks",
      "audit_reports",
      "payments",
      "payment_events",
      "entities",
      "accommodations",
      "areas",
      "routes",
      "providers",
      "source_profiles",
      "source_permissions",
      "source_records",
      "google_places",
      "google_place_snapshots",
      "google_place_details",
      "google_place_reviews",
      "raw_snapshots",
      "candidate_entities",
      "entity_matches",
      "facts",
      "evidence",
      "reviews",
      "fact_confidence_scores",
      "source_credibility_scores",
      "fact_conflicts",
      "refresh_jobs",
      "public_pages",
      "public_evidence_bundles",
      "agent_readable_snapshots",
      "llm_runs",
      "llm_tool_calls",
      "reviewer_results",
    ];

    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const tableNames = new Set(tables.rows.map((row) => row.table_name));

    for (const table of requiredTables) {
      expect(tableNames.has(table)).toBe(true);
    }

    const firstArea = siargaoTaxonomy.areas[0];
    await db.query(
      "insert into areas (id, slug, name, municipality, description) values ($1, $2, $3, $4, $5)",
      [firstArea.id, firstArea.slug, firstArea.name, firstArea.municipality, firstArea.description],
    );

    const seeded = await db.query<{ count: string }>("select count(*)::text as count from areas");
    expect(seeded.rows[0]?.count).toBe("1");

    await db.close();
  });

  test("keeps typed Drizzle schema exports in parity with migrated tables", async () => {
    const migrationSql = await readFile(migrationPath, "utf8");
    const migratedTables = [
      ...migrationSql.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g),
    ].map((match) => match[1]);

    const schemaTables = [
      users,
      userProfiles,
      chatThreads,
      chatMessages,
      chatResponseRatings,
      savedTrips,
      savedTripItems,
      sharedTripPlans,
      areas,
      routes,
      providers,
      sourceProfiles,
      sourcePermissions,
      entities,
      accommodations,
      rawSnapshots,
      sourceRecords,
      googlePlaces,
      googlePlaceSnapshots,
      googlePlaceDetails,
      googlePlaceReviews,
      candidateEntities,
      entityMatches,
      facts,
      evidence,
      reviews,
      factConfidenceScores,
      sourceCredibilityScores,
      factConflicts,
      auditRequests,
      auditInputs,
      auditRuns,
      auditCompletenessChecks,
      payments,
      paymentEvents,
      auditReports,
      refreshJobs,
      publicEvidenceBundles,
      publicPages,
      agentReadableSnapshots,
      llmRuns,
      llmToolCalls,
      reviewerResults,
      providerHealthChecks,
      publicPageGenerationJobs,
    ];
    const schemaTableNames: string[] = schemaTables.map((table) => getTableName(table));

    expect(schemaTableNames.toSorted()).toEqual(migratedTables.toSorted());
  });

  test("keeps migrated auth and chat table columns, keys, and indexes in parity", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    const columns = await db.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: "YES" | "NO";
      column_default: string | null;
    }>(
      `
        select table_name, column_name, data_type, is_nullable, column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name, ordinal_position
      `,
      [authTableNames],
    );
    const columnsByTable = groupRows(columns.rows, (row) => row.table_name);

    expect(
      columnsByTable.users?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["email", "text", "NO", null],
      ["first_name", "text", "YES", null],
      ["last_name", "text", "YES", null],
      ["image_url", "text", "YES", null],
      ["clerk_updated_at", "timestamp with time zone", "YES", null],
      ["last_seen_at", "timestamp with time zone", "YES", null],
      ["deleted_at", "timestamp with time zone", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.user_profiles?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["user_id", "text", "NO", null],
      ["display_name", "text", "YES", null],
      ["home_country", "text", "YES", null],
      ["travel_style", "text", "YES", null],
      ["budget_level", "text", "YES", null],
      ["dietary_notes", "text", "YES", null],
      ["accessibility_notes", "text", "YES", null],
      ["interests_json", "jsonb", "NO", "'[]'::jsonb"],
      ["preferred_areas_json", "jsonb", "NO", "'[]'::jsonb"],
      ["trip_context_json", "jsonb", "NO", "'{}'::jsonb"],
      ["marketing_consent", "boolean", "NO", "false"],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.chat_threads?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["user_id", "text", "NO", null],
      ["title", "text", "NO", "'New Siargao chat'::text"],
      ["summary", "text", "YES", null],
      ["status", "text", "NO", "'active'::text"],
      ["source", "text", "NO", "'chat_workspace'::text"],
      ["last_message_at", "timestamp with time zone", "YES", null],
      ["archived_at", "timestamp with time zone", "YES", null],
      ["deleted_at", "timestamp with time zone", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.chat_messages?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["thread_id", "text", "NO", null],
      ["user_id", "text", "NO", null],
      ["role", "text", "NO", null],
      ["content", "text", "NO", null],
      ["status", "text", "NO", "'complete'::text"],
      ["request_id", "text", "YES", null],
      ["model", "text", "YES", null],
      ["client_message_id", "text", "YES", null],
      ["sources_json", "jsonb", "NO", "'[]'::jsonb"],
      ["cards_json", "jsonb", "NO", "'[]'::jsonb"],
      ["actions_json", "jsonb", "NO", "'[]'::jsonb"],
      ["itineraries_json", "jsonb", "NO", "'[]'::jsonb"],
      ["tool_calls_json", "jsonb", "NO", "'[]'::jsonb"],
      ["context_summary_json", "jsonb", "NO", "'{}'::jsonb"],
      ["error_code", "text", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.chat_response_ratings?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["message_id", "text", "NO", null],
      ["thread_id", "text", "NO", null],
      ["user_id", "text", "NO", null],
      ["rating", "text", "NO", null],
      ["reason_codes_json", "jsonb", "NO", "'[]'::jsonb"],
      ["comment", "text", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);

    const primaryKeys = await db.query<{
      table_name: string;
      column_name: string;
      ordinal_position: number;
    }>(
      `
        select tc.table_name, kcu.column_name, kcu.ordinal_position
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        where tc.table_schema = 'public'
          and tc.constraint_type = 'PRIMARY KEY'
          and tc.table_name = any($1::text[])
        order by tc.table_name, kcu.ordinal_position
      `,
      [authTableNames],
    );
    expect(groupColumnNames(primaryKeys.rows)).toEqual({
      chat_messages: ["id"],
      chat_response_ratings: ["id"],
      chat_threads: ["id"],
      user_profiles: ["user_id"],
      users: ["id"],
    });

    const foreignKeys = await db.query<{
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `
        select
          tc.table_name,
          kcu.column_name,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name
          and tc.table_schema = ccu.table_schema
        where tc.table_schema = 'public'
          and tc.constraint_type = 'FOREIGN KEY'
          and tc.table_name = any($1::text[])
        order by tc.table_name, kcu.column_name
      `,
      [authTableNames],
    );
    expect(
      foreignKeys.rows.map((row) => [
        row.table_name,
        row.column_name,
        row.foreign_table_name,
        row.foreign_column_name,
      ]),
    ).toEqual([
      ["chat_messages", "thread_id", "chat_threads", "id"],
      ["chat_messages", "user_id", "users", "id"],
      ["chat_response_ratings", "message_id", "chat_messages", "id"],
      ["chat_response_ratings", "thread_id", "chat_threads", "id"],
      ["chat_response_ratings", "user_id", "users", "id"],
      ["chat_threads", "user_id", "users", "id"],
      ["user_profiles", "user_id", "users", "id"],
    ]);

    const indexes = await db.query<{ tablename: string; indexname: string; indexdef: string }>(
      `
        select tablename, indexname, indexdef
        from pg_indexes
        where schemaname = 'public'
          and tablename = any($1::text[])
        order by tablename, indexname
      `,
      [authTableNames],
    );
    expect(
      Object.fromEntries(
        indexes.rows.map((row) => [`${row.tablename}.${row.indexname}`, row.indexdef]),
      ),
    ).toMatchObject({
      "chat_messages.chat_messages_request_id_idx":
        "CREATE INDEX chat_messages_request_id_idx ON public.chat_messages USING btree (request_id)",
      "chat_messages.chat_messages_thread_id_created_at_idx":
        "CREATE INDEX chat_messages_thread_id_created_at_idx ON public.chat_messages USING btree (thread_id, created_at)",
      "chat_messages.chat_messages_user_id_created_at_idx":
        "CREATE INDEX chat_messages_user_id_created_at_idx ON public.chat_messages USING btree (user_id, created_at)",
      "chat_response_ratings.chat_response_ratings_thread_id_idx":
        "CREATE INDEX chat_response_ratings_thread_id_idx ON public.chat_response_ratings USING btree (thread_id)",
      "chat_response_ratings.chat_response_ratings_user_id_created_at_idx":
        "CREATE INDEX chat_response_ratings_user_id_created_at_idx ON public.chat_response_ratings USING btree (user_id, created_at)",
      "chat_response_ratings.chat_response_ratings_user_id_message_id_idx":
        "CREATE UNIQUE INDEX chat_response_ratings_user_id_message_id_idx ON public.chat_response_ratings USING btree (user_id, message_id)",
      "chat_threads.chat_threads_user_id_deleted_at_idx":
        "CREATE INDEX chat_threads_user_id_deleted_at_idx ON public.chat_threads USING btree (user_id, deleted_at)",
      "chat_threads.chat_threads_user_id_updated_at_idx":
        "CREATE INDEX chat_threads_user_id_updated_at_idx ON public.chat_threads USING btree (user_id, updated_at)",
      "user_profiles.user_profiles_updated_at_idx":
        "CREATE INDEX user_profiles_updated_at_idx ON public.user_profiles USING btree (updated_at)",
      "users.users_deleted_at_idx":
        "CREATE INDEX users_deleted_at_idx ON public.users USING btree (deleted_at)",
      "users.users_last_seen_at_idx":
        "CREATE INDEX users_last_seen_at_idx ON public.users USING btree (last_seen_at)",
    });

    await db.close();
  });

  test("keeps migrated trip table columns, keys, and indexes in parity", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    const columns = await db.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: "YES" | "NO";
      column_default: string | null;
    }>(
      `
        select table_name, column_name, data_type, is_nullable, column_default
        from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name, ordinal_position
      `,
      [tripTableNames],
    );
    const columnsByTable = groupRows(columns.rows, (row) => row.table_name);

    expect(
      columnsByTable.saved_trips?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["user_id", "text", "YES", null],
      ["client_trip_key_hash", "text", "NO", null],
      ["title", "text", "NO", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.saved_trip_items?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["trip_id", "text", "NO", null],
      ["kind", "text", "NO", null],
      ["title", "text", "NO", null],
      ["payload_json", "jsonb", "NO", null],
      ["sources_json", "jsonb", "NO", "'[]'::jsonb"],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
      ["deleted_at", "timestamp with time zone", "YES", null],
    ]);
    expect(
      columnsByTable.shared_trip_plans?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["trip_id", "text", "NO", null],
      ["public_token_hash", "text", "NO", null],
      ["title", "text", "NO", null],
      ["item_ids_json", "jsonb", "NO", "'[]'::jsonb"],
      ["items_json", "jsonb", "NO", "'[]'::jsonb"],
      ["expires_at", "timestamp with time zone", "YES", null],
      ["deleted_at", "timestamp with time zone", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);

    const primaryKeys = await db.query<{
      table_name: string;
      column_name: string;
      ordinal_position: number;
    }>(
      `
        select tc.table_name, kcu.column_name, kcu.ordinal_position
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        where tc.table_schema = 'public'
          and tc.constraint_type = 'PRIMARY KEY'
          and tc.table_name = any($1::text[])
        order by tc.table_name, kcu.ordinal_position
      `,
      [tripTableNames],
    );
    expect(groupColumnNames(primaryKeys.rows)).toEqual({
      saved_trip_items: ["trip_id", "id"],
      saved_trips: ["id"],
      shared_trip_plans: ["id"],
    });

    const uniqueKeys = await db.query<{ table_name: string; column_name: string }>(
      `
        select tc.table_name, kcu.column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        where tc.table_schema = 'public'
          and tc.constraint_type = 'UNIQUE'
          and tc.table_name = any($1::text[])
        order by tc.table_name, kcu.column_name
      `,
      [tripTableNames],
    );
    expect(groupColumnNames(uniqueKeys.rows)).toEqual({
      saved_trips: ["client_trip_key_hash"],
      shared_trip_plans: ["public_token_hash"],
    });

    const foreignKeys = await db.query<{
      table_name: string;
      column_name: string;
      foreign_table_name: string;
      foreign_column_name: string;
    }>(
      `
        select
          tc.table_name,
          kcu.column_name,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name
          and tc.table_schema = ccu.table_schema
        where tc.table_schema = 'public'
          and tc.constraint_type = 'FOREIGN KEY'
          and tc.table_name = any($1::text[])
        order by tc.table_name, kcu.column_name
      `,
      [tripTableNames],
    );
    expect(
      foreignKeys.rows.map((row) => [
        row.table_name,
        row.column_name,
        row.foreign_table_name,
        row.foreign_column_name,
      ]),
    ).toEqual([
      ["saved_trip_items", "trip_id", "saved_trips", "id"],
      ["saved_trips", "user_id", "users", "id"],
      ["shared_trip_plans", "trip_id", "saved_trips", "id"],
    ]);

    const indexes = await db.query<{ tablename: string; indexname: string; indexdef: string }>(
      `
        select tablename, indexname, indexdef
        from pg_indexes
        where schemaname = 'public'
          and tablename = any($1::text[])
        order by tablename, indexname
      `,
      [tripTableNames],
    );
    expect(
      Object.fromEntries(
        indexes.rows.map((row) => [`${row.tablename}.${row.indexname}`, row.indexdef]),
      ),
    ).toMatchObject({
      "saved_trip_items.saved_trip_items_deleted_at_idx":
        "CREATE INDEX saved_trip_items_deleted_at_idx ON public.saved_trip_items USING btree (deleted_at)",
      "saved_trip_items.saved_trip_items_pkey":
        "CREATE UNIQUE INDEX saved_trip_items_pkey ON public.saved_trip_items USING btree (trip_id, id)",
      "saved_trip_items.saved_trip_items_trip_id_idx":
        "CREATE INDEX saved_trip_items_trip_id_idx ON public.saved_trip_items USING btree (trip_id)",
      "saved_trips.saved_trips_client_trip_key_hash_idx":
        "CREATE INDEX saved_trips_client_trip_key_hash_idx ON public.saved_trips USING btree (client_trip_key_hash)",
      "saved_trips.saved_trips_pkey":
        "CREATE UNIQUE INDEX saved_trips_pkey ON public.saved_trips USING btree (id)",
      "saved_trips.saved_trips_user_client_trip_key_hash_idx":
        "CREATE UNIQUE INDEX saved_trips_user_client_trip_key_hash_idx ON public.saved_trips USING btree (user_id, client_trip_key_hash) WHERE (user_id IS NOT NULL)",
      "saved_trips.saved_trips_user_id_idx":
        "CREATE INDEX saved_trips_user_id_idx ON public.saved_trips USING btree (user_id)",
      "shared_trip_plans.shared_trip_plans_expires_at_idx":
        "CREATE INDEX shared_trip_plans_expires_at_idx ON public.shared_trip_plans USING btree (expires_at)",
      "shared_trip_plans.shared_trip_plans_pkey":
        "CREATE UNIQUE INDEX shared_trip_plans_pkey ON public.shared_trip_plans USING btree (id)",
      "shared_trip_plans.shared_trip_plans_public_token_hash_idx":
        "CREATE INDEX shared_trip_plans_public_token_hash_idx ON public.shared_trip_plans USING btree (public_token_hash)",
      "shared_trip_plans.shared_trip_plans_trip_id_idx":
        "CREATE INDEX shared_trip_plans_trip_id_idx ON public.shared_trip_plans USING btree (trip_id)",
    });

    await db.close();
  });
});

const authTableNames = [
  "users",
  "user_profiles",
  "chat_threads",
  "chat_messages",
  "chat_response_ratings",
];
const tripTableNames = ["saved_trips", "saved_trip_items", "shared_trip_plans"];

function groupRows<T extends Record<string, unknown>, Key extends keyof T>(
  rows: readonly T[],
  key: (row: T) => T[Key],
) {
  return rows.reduce<Record<string, T[]>>((groups, row) => {
    const groupKey = String(key(row));
    groups[groupKey] = [...(groups[groupKey] ?? []), row];
    return groups;
  }, {});
}

function groupColumnNames(rows: readonly { table_name: string; column_name: string }[]) {
  return rows.reduce<Record<string, string[]>>((groups, row) => {
    groups[row.table_name] = [...(groups[row.table_name] ?? []), row.column_name];
    return groups;
  }, {});
}

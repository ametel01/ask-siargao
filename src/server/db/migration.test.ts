import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { getTableName } from "drizzle-orm";

import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import type { MigrationFile } from "@/server/db/migration-files";
import {
  checksumMigrationSql,
  listPendingMigrationNames,
  loadMigrationFiles,
} from "@/server/db/migration-files";
import type { MigrationDatabase } from "@/server/db/migration-runner";
import { runLedgerBackedMigrations } from "@/server/db/migration-runner";
import {
  accommodations,
  accountClosureCheckoutSessions,
  accountClosureOperations,
  accountClosureProviderSubjects,
  accountClosureRefundObligations,
  accountClosureSteps,
  accountClosureTombstones,
  accountClosureWriteBarriers,
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
  operationalAlertDeliveries,
  operationalFindings,
  operationalReconciliationCursors,
  operationalReconciliationObservations,
  operationalReconciliationRuns,
  operationalScheduleStates,
  operationalWorkerTasks,
  operatorRefundActions,
  operatorRepairActions,
  paidAnswerReservations,
  paymentEvents,
  payments,
  privacyRestoreGuardState,
  providerHealthChecks,
  providers,
  publicEvidenceBundleEvidence,
  publicEvidenceBundles,
  publicPageFacts,
  publicPageGenerationJobs,
  publicPages,
  rawSnapshots,
  refreshJobs,
  retainedCommerceEvidence,
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
  tripPassCheckoutAttempts,
  tripPassDisputeFacts,
  tripPasses,
  tripPassGrants,
  tripPassOrders,
  tripPassPaymentEventReceipts,
  tripPassPaymentFacts,
  tripPassRefundFacts,
  tripPassRefundOperations,
  tripPassStripeEvents,
  tripUsageEvents,
  tripUsageMeters,
  userProfiles,
  users,
} from "@/server/db/schema";
import {
  createPgliteMigrationDatabase,
  getMigrationPaths,
  openTestDatabase,
  resetTestDatabase,
  runInitialMigration,
} from "@/server/db/test-database";
import {
  PaidAnswerPurgeBatchError,
  purgeExpiredPaidAnswerDetails,
} from "@/server/trip-pass/paid-answer-reservations";

describe("Step 3 database migration", () => {
  test("derives pending migration names from the complete current ledger", () => {
    const migrations = ["0001_initial.sql", "0002_additive.sql", "0003_latest.sql"].map((name) => ({
      checksum: name,
      name,
      path: name,
      sql: name,
    }));

    expect(listPendingMigrationNames(migrations, migrations.slice(0, 1))).toEqual([
      "0002_additive.sql",
      "0003_latest.sql",
    ]);
  });

  test("discovers ordered schema migrations", async () => {
    const migrationNames = (await getMigrationPaths()).map((migrationPath) =>
      path.basename(migrationPath),
    );

    expect(migrationNames).toEqual(migrationNames.toSorted());
    expect(migrationNames).toContain("0000_initial_schema.sql");
    expect(migrationNames).toContain("0001_chat_decision_summaries.sql");
    expect(migrationNames).toContain("0004_hot_path_indexes.sql");
    expect(migrationNames).toContain("0005_public_page_relationships.sql");
    expect(migrationNames).toContain("0006_traveler_preferences.sql");
    expect(migrationNames).toContain("0007_structured_profile_food_needs.sql");
    expect(migrationNames).toContain("0008_trip_pass_commerce_ledger.sql");
    expect(migrationNames).toContain("0009_clerk_identity_closure_state.sql");
    expect(migrationNames).toContain("0012_terminal_account_closure.sql");
    expect(migrationNames).toContain("0013_trip_pass_payment_lifecycle.sql");
    expect(migrationNames).toContain("0014_durable_paid_answer_reservations.sql");
    expect(migrationNames).toContain("0015_paid_answer_retention_retry.sql");
    expect(migrationNames).toContain("0016_operational_findings_and_repair.sql");
    expect(migrationNames).toContain("0016_preflight_operational_incident_dedup.sql");
    expect(migrationNames).toContain("0017_operational_incident_leases.sql");
    expect(migrationNames).toContain("0018_operational_command_and_observation_fencing.sql");
    expect(migrationNames).toContain("0019_operational_page_intent_fencing.sql");
    expect(migrationNames).toContain("0020_shared_trip_link_expiry.sql");
    expect(migrationNames).toContain("0021_operational_schedule_sentinel.sql");
    expect(migrationNames).toContain("0022_operational_schedule_sentinel_authorization.sql");
    expect(migrationNames).toContain("0023_agent_turn_recovery_status.sql");
    expect(migrationNames).toContain("0024_google_places_source_profile.sql");
  });

  test("repairs the Google Places source profile on an existing unseeded database", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationFiles = await loadMigrationFiles();
    const profileMigrationName = "0024_google_places_source_profile.sql";
    const setupMigration = requiredMigrationFile(migrationFiles, "0000_initial_schema.sql");
    const profileMigration = requiredMigrationFile(migrationFiles, profileMigrationName);

    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), [setupMigration]);

    const before = await db.query<{ count: string }>(
      "select count(*)::text as count from source_profiles where id = 'source_google_places'",
    );
    expect(before.rows[0]?.count).toBe("0");

    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), [
      setupMigration,
      profileMigration,
    ]);

    const profile = await db.query<{
      allowed_use: string;
      provider_id: string;
      source_type: string;
    }>(
      `
        select provider_id, source_type, allowed_use
        from source_profiles
        where id = 'source_google_places'
      `,
    );
    expect(profile.rows).toEqual([
      {
        allowed_use: "citation_only",
        provider_id: "provider_google_places",
        source_type: "licensed_api",
      },
    ]);

    await db.close();
  });

  test("creates required core tables and accepts taxonomy seed rows", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationResult = await runInitialMigration(db);

    const requiredTables = [
      "users",
      "account_closure_tombstones",
      "account_closure_operations",
      "account_closure_steps",
      "account_closure_provider_subjects",
      "account_closure_checkout_sessions",
      "account_closure_refund_obligations",
      "account_closure_write_barriers",
      "retained_commerce_evidence",
      "privacy_restore_guard_state",
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
      "trip_pass_stripe_events",
      "trip_pass_refund_facts",
      "trip_pass_dispute_facts",
      "trip_usage_events",
      "paid_answer_reservations",
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
      "public_page_facts",
      "public_evidence_bundle_evidence",
      "agent_readable_snapshots",
      "llm_runs",
      "llm_tool_calls",
      "reviewer_results",
      "operational_schedule_states",
    ];

    const tables = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public'",
    );
    const tableNames = new Set(tables.rows.map((row) => row.table_name));

    for (const table of requiredTables) {
      expect(tableNames.has(table)).toBe(true);
    }

    const expectedMigrationNames = (await getMigrationPaths()).map((migrationPath) =>
      path.basename(migrationPath),
    );
    const ledgerRows = await db.query<{ name: string; checksum: string; applied_at: string }>(
      "select name, checksum, applied_at from schema_migrations order by applied_at, name",
    );

    expect(migrationResult.applied).toEqual(expectedMigrationNames);
    expect(migrationResult.skipped).toEqual([]);
    expect(ledgerRows.rows.map((row) => row.name)).toEqual(expectedMigrationNames);
    expect(ledgerRows.rows.every((row) => /^[a-f0-9]{64}$/.test(row.checksum))).toBe(true);
    expect(ledgerRows.rows.every((row) => String(row.applied_at).length > 0)).toBe(true);

    const firstArea = siargaoTaxonomy.areas[0];
    await db.query(
      "insert into areas (id, slug, name, municipality, description) values ($1, $2, $3, $4, $5)",
      [firstArea.id, firstArea.slug, firstArea.name, firstArea.municipality, firstArea.description],
    );

    const seeded = await db.query<{ count: string }>("select count(*)::text as count from areas");
    expect(seeded.rows[0]?.count).toBe("1");

    await db.close();
  });

  test("skips matching ledger migrations on an idempotent second run", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const firstRun = await runInitialMigration(db);
    const secondRun = await runInitialMigration(db);

    expect(firstRun.applied).toEqual(
      (await getMigrationPaths()).map((filePath) => path.basename(filePath)),
    );
    expect(firstRun.skipped).toEqual([]);
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.skipped).toEqual(firstRun.applied);

    const ledgerRows = await db.query<{ count: string }>(
      "select count(*)::text as count from schema_migrations",
    );
    expect(ledgerRows.rows[0]?.count).toBe(String(firstRun.applied.length));

    await db.close();
  });

  test("upgrades the immutable historical paid-answer migration through retention retry", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const database = createPgliteMigrationDatabase(db);
    const migrationFiles = await loadMigrationFiles();
    const throughHistoricalPaidAnswer = migrationFiles.filter(
      (migration) => migration.name <= "0014_durable_paid_answer_reservations.sql",
    );
    const historicalPaidAnswer = throughHistoricalPaidAnswer.at(-1);

    expect(historicalPaidAnswer?.name).toBe("0014_durable_paid_answer_reservations.sql");
    expect(historicalPaidAnswer?.checksum).toBe(
      "3382b687fb8812b75446de022ce3c89e4efb68bd77a50025034997da942d974d",
    );
    await runLedgerBackedMigrations(database, throughHistoricalPaidAnswer);
    const historicalColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_name = 'paid_answer_reservations' and column_name like 'purge_%'`,
    );
    expect(historicalColumns.rows).toEqual([]);

    await db.query(
      `insert into users (id, email) values ('migration_retry_user', 'migration-retry@example.com')`,
    );
    await db.query(
      `insert into trip_passes (
         id, user_id, status, starts_at, expires_at, created_at, updated_at
       ) values (
         'migration_retry_pass', 'migration_retry_user', 'active',
         clock_timestamp() - interval '1 hour', clock_timestamp() + interval '14 days',
         clock_timestamp(), clock_timestamp()
       )`,
    );
    await db.query(
      `insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
       values ('migration_retry_meter', 'migration_retry_pass', 'chat_message', 1, 150)`,
    );
    await db.query(
      `insert into paid_answer_reservations (
         id, trip_pass_id, usage_meter_id, account_id, idempotency_key_hash,
         request_body_hash, request_id, lease_token, status, lease_expires_at,
         details_purge_at, reserved_at, finalized_at, updated_at
       ) values (
         'migration_retry_reservation', 'migration_retry_pass', 'migration_retry_meter',
         'migration_retry_user', 'migration_retry_key', 'migration_retry_body',
         'migration_retry_request', 'migration_retry_lease', 'settled',
         clock_timestamp() - interval '39 days', clock_timestamp() - interval '1 day',
         clock_timestamp() - interval '40 days', clock_timestamp() - interval '39 days',
         clock_timestamp() - interval '39 days'
       )`,
    );

    const upgrade = await runLedgerBackedMigrations(database, migrationFiles);
    expect(upgrade.applied).toEqual([
      "0015_paid_answer_retention_retry.sql",
      "0016_operational_findings_and_repair.sql",
      "0016_preflight_operational_incident_dedup.sql",
      "0017_operational_incident_leases.sql",
      "0018_operational_command_and_observation_fencing.sql",
      "0019_operational_page_intent_fencing.sql",
      "0020_shared_trip_link_expiry.sql",
      "0021_operational_schedule_sentinel.sql",
      "0022_operational_schedule_sentinel_authorization.sql",
      "0023_agent_turn_recovery_status.sql",
      "0024_google_places_source_profile.sql",
      "0025_lemon_squeezy_provider_neutral_commerce.sql",
      "0026_pending_payment_event_worker.sql",
      "0027_lemon_squeezy_refund_worker.sql",
      "0028_partial_refund_recovery.sql",
      "0029_backfill_provider_neutral_stripe_receipts.sql",
      "0030_commerce_reconciliation_schedule.sql",
      "0031_checkout_return_lookup_claim.sql",
      "0032_preserve_checkout_attempt_history.sql",
      "0033_reconciliation_cursors.sql",
      "0034_refund_capture_and_return_lookup.sql",
      "0035_operator_refund_action.sql",
      "0036_checkout_commercial_verification.sql",
      "0037_refund_operation_fencing.sql",
      "0038_durable_checkout_return_worker.sql",
    ]);
    expect(upgrade.skipped).toEqual(throughHistoricalPaidAnswer.map((migration) => migration.name));
    const upgraded = await db.query<{
      purge_attempted_at: Date | null;
      purge_failure_count: number;
      purge_last_error: string | null;
      purge_retry_at: Date | null;
    }>(
      `select purge_attempted_at, purge_retry_at, purge_failure_count, purge_last_error
       from paid_answer_reservations where id = 'migration_retry_reservation'`,
    );
    expect(upgraded.rows[0]).toEqual({
      purge_attempted_at: null,
      purge_failure_count: 0,
      purge_last_error: null,
      purge_retry_at: null,
    });
    const constraints = await db.query<{ conname: string; convalidated: boolean }>(
      `select conname, convalidated from pg_constraint
       where conname in (
         'paid_answer_reservations_purge_failure_count_check',
         'paid_answer_reservations_purge_last_error_check'
       ) order by conname`,
    );
    expect(constraints.rows).toEqual([
      {
        conname: "paid_answer_reservations_purge_failure_count_check",
        convalidated: true,
      },
      { conname: "paid_answer_reservations_purge_last_error_check", convalidated: true },
    ]);
    const indexes = await db.query<{ indexdef: string }>(
      `select indexdef from pg_indexes
       where indexname = 'paid_answer_reservations_details_purge_idx'`,
    );
    expect(indexes.rows[0]?.indexdef).toContain("COALESCE(purge_retry_at, details_purge_at)");

    let purgeError: unknown;
    try {
      await purgeExpiredPaidAnswerDetails(db);
    } catch (error) {
      purgeError = error;
    }
    expect(purgeError).toBeInstanceOf(PaidAnswerPurgeBatchError);
    expect(purgeError).toMatchObject({
      purgedCount: 0,
      failures: [{ reservationId: "migration_retry_reservation", retryScheduled: true }],
    });
    const scheduled = await db.query<{
      purge_failure_count: number;
      retry_scheduled: boolean;
    }>(
      `select purge_failure_count, purge_retry_at > purge_attempted_at as retry_scheduled
       from paid_answer_reservations where id = 'migration_retry_reservation'`,
    );
    expect(scheduled.rows[0]).toEqual({ purge_failure_count: 1, retry_scheduled: true });

    await db.close();
  });

  test("upgrades an immutable 0015 ledger through additive operations migrations", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationFiles = await loadMigrationFiles();
    const through0015 = migrationFiles.filter(
      (migration) => migration.name <= "0015_paid_answer_retention_retry.sql",
    );
    expect(through0015.at(-1)).toMatchObject({
      checksum: "41b4aca3e7d211ec29a5a091ec7706a1d2af6c36fe5c3ef33be251f72a8ce222",
      name: "0015_paid_answer_retention_retry.sql",
    });
    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), through0015);
    const upgrade = await runLedgerBackedMigrations(
      createPgliteMigrationDatabase(db),
      migrationFiles,
    );
    expect(upgrade.applied).toEqual([
      "0016_operational_findings_and_repair.sql",
      "0016_preflight_operational_incident_dedup.sql",
      "0017_operational_incident_leases.sql",
      "0018_operational_command_and_observation_fencing.sql",
      "0019_operational_page_intent_fencing.sql",
      "0020_shared_trip_link_expiry.sql",
      "0021_operational_schedule_sentinel.sql",
      "0022_operational_schedule_sentinel_authorization.sql",
      "0023_agent_turn_recovery_status.sql",
      "0024_google_places_source_profile.sql",
      "0025_lemon_squeezy_provider_neutral_commerce.sql",
      "0026_pending_payment_event_worker.sql",
      "0027_lemon_squeezy_refund_worker.sql",
      "0028_partial_refund_recovery.sql",
      "0029_backfill_provider_neutral_stripe_receipts.sql",
      "0030_commerce_reconciliation_schedule.sql",
      "0031_checkout_return_lookup_claim.sql",
      "0032_preserve_checkout_attempt_history.sql",
      "0033_reconciliation_cursors.sql",
      "0034_refund_capture_and_return_lookup.sql",
      "0035_operator_refund_action.sql",
      "0036_checkout_commercial_verification.sql",
      "0037_refund_operation_fencing.sql",
      "0038_durable_checkout_return_worker.sql",
    ]);
    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_name like 'operational_%'
          or table_schema = 'public' and table_name = 'operator_repair_actions'
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "operational_alert_deliveries",
      "operational_findings",
      "operational_reconciliation_cursors",
      "operational_reconciliation_observations",
      "operational_reconciliation_runs",
      "operational_schedule_states",
      "operational_worker_tasks",
      "operator_repair_actions",
    ]);
    await db.close();
  });

  test("keeps 0016 and 0017 immutable while additive migrations backfill later state", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationFiles = await loadMigrationFiles();
    const through0016 = migrationFiles.filter(
      (migration) => migration.name <= "0016_operational_findings_and_repair.sql",
    );
    expect(through0016.at(-1)).toMatchObject({
      checksum: "50344fcd9373e140eb9a92953a83e61f3f8e12c521cb0abff7994da6b7b15ec5",
      name: "0016_operational_findings_and_repair.sql",
    });
    expect(
      migrationFiles.find((migration) => migration.name === "0017_operational_incident_leases.sql"),
    ).toMatchObject({
      checksum: "46505b51aad885a4f310721fe16a4e01b853380c4182c26bc36f6a7e8cf014fc",
      name: "0017_operational_incident_leases.sql",
    });
    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), through0016);
    await db.query(
      `insert into operational_reconciliation_runs (
         id, source, status, checked_count, finding_count, started_at, completed_at
       ) values ('run_0016_upgrade', 'worker', 'succeeded', 1, 1,
         clock_timestamp(), clock_timestamp())`,
    );
    await db.query(
      `insert into operational_findings (
         id, run_id, kind, impact, local_entity_type, local_entity_ref, summary_code
       ) values (
         'finding_0016_upgrade', 'run_0016_upgrade', 'paid_without_pass', 'high',
         'trip_pass_order', 'order_0016_upgrade', 'authoritative_payment_has_no_local_access'
       )`,
    );
    await db.query(
      `insert into operational_alert_deliveries (
         id, alert_key, finding_id, impact, destination, status, delivery_token, attempted_at
       ) values (
         'alert_0016_upgrade', 'alert_key_0016_upgrade', 'finding_0016_upgrade', 'high',
         'sentry', 'sending', 'lease_0016_upgrade', clock_timestamp()
       )`,
    );
    const upgrade = await runLedgerBackedMigrations(
      createPgliteMigrationDatabase(db),
      migrationFiles,
    );
    expect(upgrade.applied).toEqual([
      "0016_preflight_operational_incident_dedup.sql",
      "0017_operational_incident_leases.sql",
      "0018_operational_command_and_observation_fencing.sql",
      "0019_operational_page_intent_fencing.sql",
      "0020_shared_trip_link_expiry.sql",
      "0021_operational_schedule_sentinel.sql",
      "0022_operational_schedule_sentinel_authorization.sql",
      "0023_agent_turn_recovery_status.sql",
      "0024_google_places_source_profile.sql",
      "0025_lemon_squeezy_provider_neutral_commerce.sql",
      "0026_pending_payment_event_worker.sql",
      "0027_lemon_squeezy_refund_worker.sql",
      "0028_partial_refund_recovery.sql",
      "0029_backfill_provider_neutral_stripe_receipts.sql",
      "0030_commerce_reconciliation_schedule.sql",
      "0031_checkout_return_lookup_claim.sql",
      "0032_preserve_checkout_attempt_history.sql",
      "0033_reconciliation_cursors.sql",
      "0034_refund_capture_and_return_lookup.sql",
      "0035_operator_refund_action.sql",
      "0036_checkout_commercial_verification.sql",
      "0037_refund_operation_fencing.sql",
      "0038_durable_checkout_return_worker.sql",
    ]);
    const backfilled = await db.query<{
      incident_key: string;
      last_detected_matches: boolean;
      lease_backfilled: boolean;
      lifecycle: number;
    }>(
      `select f.incident_key, f.lifecycle,
         f.last_detected_at = f.detected_at as last_detected_matches,
         a.lease_expires_at > a.attempted_at as lease_backfilled
       from operational_findings f
       join operational_alert_deliveries a on a.finding_id = f.id
       where f.id = 'finding_0016_upgrade'`,
    );
    expect(backfilled.rows).toEqual([
      {
        incident_key: expect.stringMatching(/^incident_[a-f0-9]{32}$/),
        last_detected_matches: true,
        lease_backfilled: true,
        lifecycle: 1,
      },
    ]);
    await db.close();
  });

  test("deduplicates legacy incidents before immutable 0017 and reattaches evidence", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationFiles = await loadMigrationFiles();
    const through0016 = migrationFiles.filter(
      (migration) => migration.name <= "0016_operational_findings_and_repair.sql",
    );
    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), through0016);
    for (const runId of ["run_duplicate_open", "run_duplicate_resolved"]) {
      await db.query(
        `insert into operational_reconciliation_runs (
           id, source, status, checked_count, finding_count, started_at, completed_at
         ) values ($1, 'worker', 'succeeded', 1, 1, clock_timestamp(), clock_timestamp())`,
        [runId],
      );
    }
    await db.query(
      `insert into operational_findings (
         id, run_id, kind, impact, status, local_entity_type, local_entity_ref,
         summary_code, detected_at, resolved_at
       ) values
       ('finding_duplicate_open', 'run_duplicate_open', 'paid_without_pass', 'high', 'open',
        'trip_pass_order', 'order_duplicate', 'authoritative_payment_has_no_local_access',
        clock_timestamp() - interval '2 hours', null),
       ('finding_duplicate_resolved', 'run_duplicate_resolved', 'paid_without_pass', 'high',
        'resolved', 'trip_pass_order', 'order_duplicate',
        'authoritative_payment_has_no_local_access', clock_timestamp() - interval '1 hour',
        clock_timestamp() - interval '30 minutes')`,
    );
    await db.query(
      `insert into operator_repair_actions (
         id, finding_id, operator_account_id, idempotency_key_hash, action_type, reason_code,
         before_state, after_state
       ) values (
         'repair_duplicate_evidence', 'finding_duplicate_resolved', 'operator_opaque',
         'idempotency_opaque', 'manual_commerce_transition', 'verified_duplicate',
         '{}'::jsonb, '{}'::jsonb
       )`,
    );
    await db.query(
      `insert into operational_alert_deliveries (
         id, alert_key, finding_id, impact, destination, status, delivery_token, attempted_at,
         delivered_at
       ) values (
         'alert_duplicate_evidence', 'duplicate_alert_key', 'finding_duplicate_resolved', 'high',
         'sentry', 'sent', 'duplicate_delivery_token', clock_timestamp(), clock_timestamp()
       )`,
    );

    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), migrationFiles);
    const converged = await db.query<{
      alert_finding_id: string;
      count: string;
      lifecycle: number;
      repair_finding_id: string;
      status: string;
    }>(
      `select count(*)::text as count, min(status) as status, min(lifecycle) as lifecycle,
         (select finding_id from operator_repair_actions
          where id = 'repair_duplicate_evidence') as repair_finding_id,
         (select finding_id from operational_alert_deliveries
          where id = 'alert_duplicate_evidence') as alert_finding_id
       from operational_findings where local_entity_ref = 'order_duplicate'`,
    );
    expect(converged.rows).toEqual([
      {
        alert_finding_id: "finding_duplicate_open",
        count: "1",
        lifecycle: 1,
        repair_finding_id: "finding_duplicate_open",
        status: "open",
      },
    ]);
    await db.close();
  });

  test("accepts a historical ledger already through immutable 0017", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationFiles = await loadMigrationFiles();
    const historicalThrough0017 = migrationFiles.filter(
      (migration) =>
        migration.name !== "0016_preflight_operational_incident_dedup.sql" &&
        migration.name <= "0017_operational_incident_leases.sql",
    );
    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), historicalThrough0017);
    const upgrade = await runLedgerBackedMigrations(
      createPgliteMigrationDatabase(db),
      migrationFiles,
    );
    expect(upgrade.applied).toEqual([
      "0016_preflight_operational_incident_dedup.sql",
      "0018_operational_command_and_observation_fencing.sql",
      "0019_operational_page_intent_fencing.sql",
      "0020_shared_trip_link_expiry.sql",
      "0021_operational_schedule_sentinel.sql",
      "0022_operational_schedule_sentinel_authorization.sql",
      "0023_agent_turn_recovery_status.sql",
      "0024_google_places_source_profile.sql",
      "0025_lemon_squeezy_provider_neutral_commerce.sql",
      "0026_pending_payment_event_worker.sql",
      "0027_lemon_squeezy_refund_worker.sql",
      "0028_partial_refund_recovery.sql",
      "0029_backfill_provider_neutral_stripe_receipts.sql",
      "0030_commerce_reconciliation_schedule.sql",
      "0031_checkout_return_lookup_claim.sql",
      "0032_preserve_checkout_attempt_history.sql",
      "0033_reconciliation_cursors.sql",
      "0034_refund_capture_and_return_lookup.sql",
      "0035_operator_refund_action.sql",
      "0036_checkout_commercial_verification.sql",
      "0037_refund_operation_fencing.sql",
      "0038_durable_checkout_return_worker.sql",
    ]);
    const idempotent = await runLedgerBackedMigrations(
      createPgliteMigrationDatabase(db),
      migrationFiles,
    );
    expect(idempotent.applied).toEqual([]);
    await db.close();
  });

  test("keeps operations migration columns and indexes in exact parity", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);
    const expectedColumns: Record<string, string[]> = {
      operational_alert_deliveries: [
        "alert_key",
        "attempted_at",
        "delivered_at",
        "delivery_token",
        "destination",
        "finding_id",
        "id",
        "impact",
        "lease_expires_at",
        "status",
      ],
      operational_findings: [
        "detected_at",
        "id",
        "impact",
        "incident_key",
        "kind",
        "last_detected_at",
        "last_observation_sequence",
        "lifecycle",
        "local_entity_ref",
        "local_entity_type",
        "resolved_at",
        "run_id",
        "status",
        "summary_code",
      ],
      operational_reconciliation_runs: [
        "checked_count",
        "completed_at",
        "finding_count",
        "id",
        "source",
        "started_at",
        "status",
      ],
      operational_reconciliation_observations: [
        "last_applied_sequence",
        "local_entity_ref",
        "local_entity_type",
        "observed_at",
      ],
      operational_reconciliation_cursors: ["cursor_offset", "scope_key", "updated_at"],
      operational_worker_tasks: [
        "attempts",
        "completed_at",
        "created_at",
        "id",
        "last_error_code",
        "lease_expires_at",
        "lease_token",
        "next_attempt_at",
        "resource_ref",
        "status",
        "task_type",
        "updated_at",
      ],
      operator_repair_actions: [
        "action_type",
        "after_state",
        "before_state",
        "command_hash",
        "created_at",
        "finding_id",
        "id",
        "idempotency_key_hash",
        "operator_account_id",
        "reason_code",
      ],
    };
    for (const [tableName, columns] of Object.entries(expectedColumns)) {
      const migrated = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = $1 order by column_name`,
        [tableName],
      );
      expect(migrated.rows.map((row) => row.column_name)).toEqual(columns);
    }
    const indexes = await db.query<{ indexname: string }>(
      `select indexname from pg_indexes where schemaname = 'public'
       and tablename in (
         'operational_reconciliation_runs', 'operational_findings',
         'operational_reconciliation_observations', 'operator_repair_actions',
         'operational_alert_deliveries', 'operational_worker_tasks'
       ) order by indexname`,
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "operational_alert_deliveries_alert_key_key",
      "operational_alert_deliveries_finding_id_idx",
      "operational_alert_deliveries_lease_idx",
      "operational_alert_deliveries_pkey",
      "operational_findings_incident_key_key",
      "operational_findings_open_idx",
      "operational_findings_pkey",
      "operational_findings_run_entity_key",
      "operational_findings_run_id_idx",
      "operational_reconciliation_observations_pkey",
      "operational_reconciliation_runs_pkey",
      "operational_worker_tasks_due_idx",
      "operational_worker_tasks_pkey",
      "operational_worker_tasks_resource_key",
      "operator_repair_actions_finding_id_idx",
      "operator_repair_actions_idempotency_key",
      "operator_repair_actions_pkey",
    ]);
    await db.close();
  });

  test("does not rerun the saved trip item primary key rewrite after bootstrap is applied", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationFiles = await loadMigrationFiles();
    const bootstrapMigration = migrationFiles.find(
      (migrationFile) => migrationFile.name === "0000_initial_schema.sql",
    );

    expect(bootstrapMigration?.sql).toMatch(savedTripItemsPrimaryKeyRewritePattern);

    const firstRun = await runLedgerBackedMigrations(
      createPgliteMigrationDatabase(db),
      migrationFiles,
    );
    const secondRun = await runLedgerBackedMigrations(
      guardSavedTripItemsPrimaryKeyRewrite(createPgliteMigrationDatabase(db)),
      migrationFiles,
    );

    expect(firstRun.applied).toContain("0000_initial_schema.sql");
    expect(secondRun.applied).toEqual([]);
    expect(secondRun.skipped).toEqual(firstRun.applied);

    await db.close();
  });

  test("does not rerun skipped SQL after a matching ledger entry exists", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const database = createPgliteMigrationDatabase(db);
    const migrations = [
      createMigrationFile(
        "0000_create_probe.sql",
        "create table migration_probe (id text primary key, note text not null);",
      ),
      createMigrationFile(
        "0001_insert_probe.sql",
        "insert into migration_probe (id, note) values ('once', 'applied');",
      ),
    ];

    const firstRun = await runLedgerBackedMigrations(database, migrations);
    const secondRun = await runLedgerBackedMigrations(database, migrations);
    const probeRows = await db.query<{ count: string }>(
      "select count(*)::text as count from migration_probe",
    );

    expect(firstRun).toEqual({
      applied: ["0000_create_probe.sql", "0001_insert_probe.sql"],
      skipped: [],
    });
    expect(secondRun).toEqual({
      applied: [],
      skipped: ["0000_create_probe.sql", "0001_insert_probe.sql"],
    });
    expect(probeRows.rows[0]?.count).toBe("1");

    await db.close();
  });

  test("fails clearly when an applied migration checksum changes", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const database = createPgliteMigrationDatabase(db);
    const originalMigration = createMigrationFile(
      "0000_create_probe.sql",
      "create table migration_probe (id text primary key);",
    );
    const editedMigration = createMigrationFile(
      "0000_create_probe.sql",
      "create table migration_probe (id text primary key, edited text);",
    );

    await runLedgerBackedMigrations(database, [originalMigration]);

    await expect(runLedgerBackedMigrations(database, [editedMigration])).rejects.toThrow(
      /Migration checksum mismatch for 0000_create_probe\.sql/,
    );

    await db.close();
  });

  test("applies a newly discovered additive preflight around an already-applied ledger", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const database = createPgliteMigrationDatabase(db);
    const originalMigrations = [
      createMigrationFile("0000_create_probe.sql", "create table migration_probe (id text);"),
      createMigrationFile(
        "0002_later_probe.sql",
        "alter table migration_probe add column later text;",
      ),
    ];
    await runLedgerBackedMigrations(database, originalMigrations);
    const migrations = [
      originalMigrations[0],
      createMigrationFile(
        "0001_preflight_additive.sql",
        "alter table migration_probe add column preflight text;",
      ),
      originalMigrations[1],
    ];
    const inserted = await runLedgerBackedMigrations(database, migrations);
    const idempotent = await runLedgerBackedMigrations(database, migrations);
    expect(inserted).toEqual({
      applied: ["0001_preflight_additive.sql"],
      skipped: ["0000_create_probe.sql", "0002_later_probe.sql"],
    });
    expect(idempotent.applied).toEqual([]);
    expect(new Set(idempotent.skipped)).toEqual(
      new Set(["0000_create_probe.sql", "0001_preflight_additive.sql", "0002_later_probe.sql"]),
    );

    await db.close();
  });

  test("still rejects an ordinary missing migration before an applied ledger row", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const database = createPgliteMigrationDatabase(db);
    const migrations = [
      createMigrationFile("0000_create_probe.sql", "create table migration_probe (id text);"),
      createMigrationFile("0001_required_probe.sql", "alter table migration_probe add note text;"),
    ];
    await db.exec(`
      create table schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    await db.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
      migrations[1].name,
      migrations[1].checksum,
    ]);
    await expect(runLedgerBackedMigrations(database, migrations)).rejects.toThrow(
      "Migration ledger drift: applied migrations skip required migration 0000_create_probe.sql.",
    );
    await db.close();
  });

  test("fails clearly when the ledger contains an unknown migration", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const database = createPgliteMigrationDatabase(db);
    const migrations = [
      createMigrationFile("0000_create_probe.sql", "create table migration_probe (id text);"),
    ];

    await db.exec(`
      create table schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);
    await db.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
      "9999_unknown.sql",
      checksumMigrationSql("select 1;"),
    ]);

    await expect(runLedgerBackedMigrations(database, migrations)).rejects.toThrow(
      /Migration ledger drift: schema_migrations contains unknown migration 9999_unknown\.sql/,
    );

    await db.close();
  });

  test("keeps typed Drizzle schema exports in parity with migrated tables", async () => {
    const migrationSql = (
      await Promise.all(
        (await getMigrationPaths()).map((migrationPath) => readFile(migrationPath, "utf8")),
      )
    ).join("\n");
    const migratedTables = [
      ...migrationSql.matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+([a-z_]+)/gi),
    ].map((match) => match[1]);

    const schemaTables = [
      users,
      accountClosureTombstones,
      accountClosureOperations,
      accountClosureSteps,
      accountClosureProviderSubjects,
      accountClosureCheckoutSessions,
      accountClosureRefundObligations,
      accountClosureWriteBarriers,
      retainedCommerceEvidence,
      privacyRestoreGuardState,
      userProfiles,
      chatThreads,
      chatMessages,
      chatResponseRatings,
      savedTrips,
      savedTripItems,
      sharedTripPlans,
      tripPasses,
      tripUsageMeters,
      tripPassOrders,
      tripPassRefundFacts,
      tripPassDisputeFacts,
      tripPassGrants,
      tripPassStripeEvents,
      tripUsageEvents,
      paidAnswerReservations,
      operationalReconciliationRuns,
      operationalReconciliationObservations,
      operationalReconciliationCursors,
      operationalFindings,
      operatorRefundActions,
      operatorRepairActions,
      operationalAlertDeliveries,
      operationalWorkerTasks,
      operationalScheduleStates,
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
      publicPageFacts,
      publicEvidenceBundleEvidence,
      agentReadableSnapshots,
      llmRuns,
      llmToolCalls,
      reviewerResults,
      providerHealthChecks,
      publicPageGenerationJobs,
      tripPassCheckoutAttempts,
      tripPassPaymentEventReceipts,
      tripPassPaymentFacts,
      tripPassRefundOperations,
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
      ["email", "text", "YES", null],
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
      columnsByTable.account_closure_tombstones?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["subject_hash", "text", "NO", null],
      ["subject_hash_version", "integer", "NO", null],
      ["subject_type", "text", "NO", null],
      ["closure_policy_version", "text", "NO", null],
      ["closed_at", "timestamp with time zone", "NO", "now()"],
      ["purge_after", "timestamp with time zone", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.account_closure_operations?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["tombstone_id", "text", "NO", null],
      ["operation_type", "text", "NO", null],
      ["status", "text", "NO", null],
      ["attempts", "integer", "NO", "0"],
      ["last_error_code", "text", "YES", null],
      ["next_attempt_at", "timestamp with time zone", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
      ["completed_at", "timestamp with time zone", "YES", null],
      ["phase_one_committed_at", "timestamp with time zone", "YES", null],
      ["closure_policy_version", "text", "YES", null],
      ["commerce_policy_version", "text", "YES", null],
      ["alert_after_attempts", "integer", "NO", "3"],
    ]);
    expect(
      columnsByTable.account_closure_write_barriers?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["tombstone_id", "text", "NO", null],
      ["subject_hash", "text", "NO", null],
      ["subject_hash_version", "integer", "NO", null],
      ["subject_type", "text", "NO", null],
      ["status", "text", "NO", null],
      ["opened_at", "timestamp with time zone", "NO", "now()"],
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
      ["surf_ability", "text", "YES", null],
      ["quiet_sleep_preference", "boolean", "YES", null],
      ["weather_preference", "text", "YES", null],
      ["food_needs_json", "jsonb", "NO", "'[]'::jsonb"],
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
      ["decision_summaries_json", "jsonb", "NO", "'[]'::jsonb"],
      ["tool_calls_json", "jsonb", "NO", "'[]'::jsonb"],
      ["context_summary_json", "jsonb", "NO", "'{}'::jsonb"],
      ["error_code", "text", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["completion_status", "text", "NO", "'complete'::text"],
      ["termination_reason", "text", "YES", null],
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
      account_closure_operations: ["id"],
      account_closure_tombstones: ["id"],
      account_closure_write_barriers: ["id"],
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
      ["account_closure_operations", "tombstone_id", "account_closure_tombstones", "id"],
      ["account_closure_write_barriers", "tombstone_id", "account_closure_tombstones", "id"],
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
      "account_closure_operations.account_closure_operations_pkey":
        "CREATE UNIQUE INDEX account_closure_operations_pkey ON public.account_closure_operations USING btree (id)",
      "account_closure_operations.account_closure_operations_status_next_attempt_idx":
        "CREATE INDEX account_closure_operations_status_next_attempt_idx ON public.account_closure_operations USING btree (status, next_attempt_at)",
      "account_closure_operations.account_closure_operations_tombstone_id_idx":
        "CREATE INDEX account_closure_operations_tombstone_id_idx ON public.account_closure_operations USING btree (tombstone_id)",
      "account_closure_tombstones.account_closure_tombstones_pkey":
        "CREATE UNIQUE INDEX account_closure_tombstones_pkey ON public.account_closure_tombstones USING btree (id)",
      "account_closure_tombstones.account_closure_tombstones_purge_after_idx":
        "CREATE INDEX account_closure_tombstones_purge_after_idx ON public.account_closure_tombstones USING btree (purge_after)",
      "account_closure_tombstones.account_closure_tombstones_subject_hash_key":
        "CREATE UNIQUE INDEX account_closure_tombstones_subject_hash_key ON public.account_closure_tombstones USING btree (subject_hash)",
      "account_closure_tombstones.account_closure_tombstones_subject_idx":
        "CREATE INDEX account_closure_tombstones_subject_idx ON public.account_closure_tombstones USING btree (subject_type, subject_hash_version, subject_hash)",
      "account_closure_write_barriers.account_closure_write_barriers_pkey":
        "CREATE UNIQUE INDEX account_closure_write_barriers_pkey ON public.account_closure_write_barriers USING btree (id)",
      "account_closure_write_barriers.account_closure_write_barriers_subject_hash_key":
        "CREATE UNIQUE INDEX account_closure_write_barriers_subject_hash_key ON public.account_closure_write_barriers USING btree (subject_hash)",
      "account_closure_write_barriers.account_closure_write_barriers_subject_idx":
        "CREATE INDEX account_closure_write_barriers_subject_idx ON public.account_closure_write_barriers USING btree (subject_type, subject_hash_version, subject_hash)",
      "account_closure_write_barriers.account_closure_write_barriers_tombstone_id_idx":
        "CREATE INDEX account_closure_write_barriers_tombstone_id_idx ON public.account_closure_write_barriers USING btree (tombstone_id)",
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

  test("allows nullable and duplicate webhook-managed user email caches", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    await db.query("insert into users (id, email) values ($1, $2), ($3, $4), ($5, $6)", [
      "user_without_email",
      null,
      "user_same_email_a",
      "same@example.com",
      "user_same_email_b",
      "same@example.com",
    ]);

    const rows = await db.query<{ id: string; email: string | null }>(
      "select id, email from users order by id",
    );

    expect(rows.rows).toEqual([
      { id: "user_same_email_a", email: "same@example.com" },
      { id: "user_same_email_b", email: "same@example.com" },
      { id: "user_without_email", email: null },
    ]);

    await db.close();
  });

  test("scrubs pre-existing terminal user caches before installing resurrection trigger", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationFiles = await loadMigrationFiles();
    const preClosureMigrations = migrationFiles.filter(
      (migrationFile) => migrationFile.name < "0009_clerk_identity_closure_state.sql",
    );
    const throughClosureMigrations = migrationFiles.filter(
      (migrationFile) => migrationFile.name <= "0009_clerk_identity_closure_state.sql",
    );
    const closureMigration = migrationFiles.find(
      (migrationFile) => migrationFile.name === "0009_clerk_identity_closure_state.sql",
    );

    if (!closureMigration) {
      throw new Error("Missing 0009_clerk_identity_closure_state.sql migration.");
    }

    const database = createPgliteMigrationDatabase(db);
    await runLedgerBackedMigrations(database, preClosureMigrations);
    await db.query(
      `
        insert into users (
          id,
          email,
          first_name,
          last_name,
          image_url,
          clerk_updated_at,
          last_seen_at,
          deleted_at
        )
        values ($1, $2, $3, $4, $5, $6, $6, $7)
      `,
      [
        "user_terminal_before_migration",
        "preexisting@example.com",
        "Pre",
        "Existing",
        "https://img.clerk.test/preexisting",
        "2026-06-29T01:00:00.000Z",
        "2026-06-29T02:00:00.000Z",
      ],
    );

    const closureRun = await runLedgerBackedMigrations(database, throughClosureMigrations);

    expect(closureRun.applied).toEqual([closureMigration.name]);
    expect(closureRun.skipped).toEqual(
      preClosureMigrations.map((migrationFile) => migrationFile.name),
    );

    const row = await db.query<{
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      image_url: string | null;
      clerk_updated_at: Date | string | null;
      last_seen_at: Date | string | null;
      deleted_at: Date | string | null;
    }>(
      `
        select email, first_name, last_name, image_url, clerk_updated_at, last_seen_at, deleted_at
        from users
        where id = $1
      `,
      ["user_terminal_before_migration"],
    );

    expect(row.rows[0]).toMatchObject({
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      last_seen_at: null,
    });
    expect(row.rows[0]?.deleted_at).not.toBeNull();

    await db.close();
  });

  test("keeps terminal users non-resurrectable for previous-release identity SQL", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    const triggers = await db.query<{ tgname: string }>(
      `
        select tgname
        from pg_trigger
        where tgrelid = 'users'::regclass
          and not tgisinternal
        order by tgname
      `,
    );
    expect(triggers.rows.map((row) => row.tgname)).toContain(
      "users_prevent_terminal_identity_resurrection",
    );

    await db.query(
      `
        insert into users (
          id,
          email,
          first_name,
          last_name,
          image_url,
          clerk_updated_at,
          last_seen_at,
          deleted_at
        )
        values ($1, null, null, null, null, null, null, $2)
      `,
      ["user_terminal_migration", "2026-06-29T01:00:00.000Z"],
    );
    await expect(
      db.query(
        `
          insert into users (
            id,
            email,
            first_name,
            last_name,
            image_url,
            clerk_updated_at,
            last_seen_at,
            deleted_at,
            created_at,
            updated_at
          )
          values (
            $1,
            'legacy@example.com',
            'Legacy',
            'Traveler',
            'https://img.clerk.test/legacy',
            $2,
            $2,
            null,
            now(),
            now()
          )
          on conflict (id) do update set
            email = excluded.email,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            image_url = excluded.image_url,
            clerk_updated_at = excluded.clerk_updated_at,
            last_seen_at = excluded.last_seen_at,
            deleted_at = null,
            updated_at = now()
        `,
        ["user_terminal_migration", "2026-06-29T05:00:00.000Z"],
      ),
    ).rejects.toThrow(/terminal user row cannot be resurrected/);

    await db.query(
      `
        update users
        set email = null,
            first_name = null,
            last_name = null,
            image_url = null,
            clerk_updated_at = null,
            last_seen_at = null,
            deleted_at = coalesce(deleted_at, $2),
            updated_at = $2
        where id = $1
      `,
      ["user_terminal_migration", "2026-06-29T06:00:00.000Z"],
    );

    const row = await db.query<{
      email: string | null;
      first_name: string | null;
      last_name: string | null;
      image_url: string | null;
      clerk_updated_at: Date | string | null;
      last_seen_at: Date | string | null;
      deleted_at: Date | string | null;
    }>(
      `
        select email, first_name, last_name, image_url, clerk_updated_at, last_seen_at, deleted_at
        from users
        where id = $1
      `,
      ["user_terminal_migration"],
    );

    expect(row.rows[0]).toMatchObject({
      email: null,
      first_name: null,
      last_name: null,
      image_url: null,
      clerk_updated_at: null,
      last_seen_at: null,
    });
    expect(row.rows[0]?.deleted_at).not.toBeNull();

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
      ["expires_at", "timestamp with time zone", "NO", "(clock_timestamp() + '30 days'::interval)"],
      ["deleted_at", "timestamp with time zone", "YES", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.trip_passes?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["user_id", "text", "YES", null],
      ["email", "text", "YES", null],
      ["status", "text", "NO", null],
      ["stripe_checkout_session_id", "text", "YES", null],
      ["stripe_payment_intent_id", "text", "YES", null],
      ["stripe_event_id", "text", "YES", null],
      ["starts_at", "timestamp with time zone", "NO", null],
      ["expires_at", "timestamp with time zone", "NO", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
      ["terminal_revocation_reason", "text", "YES", null],
      ["suspended_at", "timestamp with time zone", "YES", null],
    ]);
    expect(
      columnsByTable.trip_usage_meters?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["trip_pass_id", "text", "NO", null],
      ["meter_type", "text", "NO", null],
      ["used", "integer", "NO", "0"],
      ["limit", "integer", "NO", null],
      ["reset_at", "timestamp with time zone", "YES", null],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.trip_pass_orders?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["user_id", "text", "YES", null],
      ["email", "text", "YES", null],
      ["status", "text", "NO", null],
      ["product_code", "text", "NO", null],
      ["product_version", "integer", "NO", null],
      ["stripe_price_id", "text", "YES", null],
      ["amount_total_minor", "integer", "YES", null],
      ["currency", "text", "YES", null],
      ["checkout_idempotency_key", "text", "NO", null],
      ["stripe_checkout_session_id", "text", "YES", null],
      ["stripe_payment_intent_id", "text", "YES", null],
      ["stripe_customer_id", "text", "YES", null],
      ["metadata_json", "jsonb", "NO", "'{}'::jsonb"],
      ["created_at", "timestamp with time zone", "NO", "now()"],
      ["updated_at", "timestamp with time zone", "NO", "now()"],
      ["completed_at", "timestamp with time zone", "YES", null],
      ["product_family", "text", "NO", "'siargao_trip_pass'::text"],
      ["checkout_session_expires_at", "timestamp with time zone", "YES", null],
      ["checkout_session_status", "text", "YES", null],
      ["checkout_cancellation_confirmed_at", "timestamp with time zone", "YES", null],
      ["terms_policy_version", "text", "YES", null],
      ["refund_policy_version", "text", "YES", null],
      ["privacy_policy_version", "text", "YES", null],
      ["retention_policy_version", "text", "YES", null],
      ["terms_consent_presented_at", "timestamp with time zone", "YES", null],
      ["closure_tombstone_id", "text", "YES", null],
      ["closure_outcome", "text", "YES", null],
      ["closure_refund_obligation_id", "text", "YES", null],
      ["captured_amount_minor", "integer", "YES", null],
      ["successful_refund_amount_minor", "integer", "NO", "0"],
      ["refund_state", "text", "NO", "'none'::text"],
      ["dispute_state", "text", "NO", "'none'::text"],
      ["terminal_revocation_reason", "text", "YES", null],
      ["lifecycle_updated_at", "timestamp with time zone", "YES", null],
      ["payment_provider", "text", "NO", "'stripe'::text"],
      ["provider_store_id", "text", "YES", null],
      ["provider_product_id", "text", "YES", null],
      ["provider_variant_id", "text", "YES", null],
      ["provider_checkout_id", "text", "YES", null],
      ["provider_order_id", "text", "YES", null],
      ["provider_payment_id", "text", "YES", null],
      ["provider_updated_at", "timestamp with time zone", "YES", null],
      ["checkout_attempt_id", "text", "YES", null],
      ["accepted_payment_fact_id", "text", "YES", null],
      ["payment_suspension_state", "text", "NO", "'none'::text"],
      ["refund_remaining_amount_minor", "integer", "YES", null],
      ["refund_review_deadline_at", "timestamp with time zone", "YES", null],
      ["refund_review_alerted_at", "timestamp with time zone", "YES", null],
      ["checkout_return_lookup_attempts", "integer", "NO", "0"],
      ["checkout_return_lookup_claimed_at", "timestamp with time zone", "YES", null],
      ["checkout_return_lookup_status", "text", "NO", "'pending'::text"],
      ["checkout_return_lookup_completed_at", "timestamp with time zone", "YES", null],
      ["checkout_commercial_terms_verified_at", "timestamp with time zone", "YES", null],
      ["checkout_return_provider_order_id", "text", "YES", null],
      ["checkout_return_provider_order_identifier", "text", "YES", null],
    ]);
    expect(
      columnsByTable.trip_pass_grants?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["order_id", "text", "YES", null],
      ["trip_pass_id", "text", "NO", null],
      ["user_id", "text", "YES", null],
      ["source_type", "text", "NO", null],
      ["source_event_id", "text", "NO", null],
      ["product_code", "text", "NO", null],
      ["product_version", "integer", "NO", null],
      ["quantity", "integer", "NO", "1"],
      ["duration_days", "integer", "NO", null],
      ["meter_limits_json", "jsonb", "NO", null],
      ["starts_at", "timestamp with time zone", "NO", null],
      ["expires_at", "timestamp with time zone", "NO", null],
      ["created_at", "timestamp with time zone", "NO", "now()"],
    ]);
    expect(
      columnsByTable.trip_usage_events?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
        column.column_default,
      ]),
    ).toEqual([
      ["id", "text", "NO", null],
      ["trip_pass_id", "text", "NO", null],
      ["usage_meter_id", "text", "YES", null],
      ["user_id", "text", "YES", null],
      ["event_type", "text", "NO", null],
      ["meter_type", "text", "NO", null],
      ["quantity", "integer", "NO", null],
      ["idempotency_key", "text", "YES", null],
      ["request_id", "text", "YES", null],
      ["request_hash", "text", "YES", null],
      ["provider_request_ids_json", "jsonb", "NO", "'[]'::jsonb"],
      ["occurred_at", "timestamp with time zone", "NO", "now()"],
      ["created_at", "timestamp with time zone", "NO", "now()"],
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
      trip_pass_grants: ["id"],
      trip_pass_orders: ["id"],
      trip_passes: ["id"],
      trip_usage_events: ["id"],
      trip_usage_meters: ["id"],
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
      trip_pass_grants: ["source_event_id", "source_type"],
      trip_pass_orders: [
        "checkout_idempotency_key",
        "stripe_checkout_session_id",
        "stripe_payment_intent_id",
      ],
      trip_passes: ["stripe_checkout_session_id", "stripe_event_id"],
      trip_usage_events: ["idempotency_key"],
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
      ["trip_pass_grants", "order_id", "trip_pass_orders", "id"],
      ["trip_pass_grants", "trip_pass_id", "trip_passes", "id"],
      ["trip_pass_grants", "user_id", "users", "id"],
      [
        "trip_pass_orders",
        "closure_refund_obligation_id",
        "account_closure_refund_obligations",
        "id",
      ],
      ["trip_pass_orders", "closure_tombstone_id", "account_closure_tombstones", "id"],
      ["trip_pass_orders", "user_id", "users", "id"],
      ["trip_passes", "user_id", "users", "id"],
      ["trip_usage_events", "trip_pass_id", "trip_passes", "id"],
      ["trip_usage_events", "usage_meter_id", "trip_usage_meters", "id"],
      ["trip_usage_events", "user_id", "users", "id"],
      ["trip_usage_meters", "trip_pass_id", "trip_passes", "id"],
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
      "trip_passes.trip_passes_pkey":
        "CREATE UNIQUE INDEX trip_passes_pkey ON public.trip_passes USING btree (id)",
      "trip_passes.trip_passes_status_expires_at_idx":
        "CREATE INDEX trip_passes_status_expires_at_idx ON public.trip_passes USING btree (status, expires_at)",
      "trip_passes.trip_passes_stripe_checkout_session_id_key":
        "CREATE UNIQUE INDEX trip_passes_stripe_checkout_session_id_key ON public.trip_passes USING btree (stripe_checkout_session_id)",
      "trip_passes.trip_passes_stripe_event_id_key":
        "CREATE UNIQUE INDEX trip_passes_stripe_event_id_key ON public.trip_passes USING btree (stripe_event_id)",
      "trip_passes.trip_passes_user_id_idx":
        "CREATE INDEX trip_passes_user_id_idx ON public.trip_passes USING btree (user_id)",
      "trip_usage_meters.trip_usage_meters_pkey":
        "CREATE UNIQUE INDEX trip_usage_meters_pkey ON public.trip_usage_meters USING btree (id)",
      "trip_usage_meters.trip_usage_meters_trip_pass_id_idx":
        "CREATE INDEX trip_usage_meters_trip_pass_id_idx ON public.trip_usage_meters USING btree (trip_pass_id)",
      "trip_usage_meters.trip_usage_meters_trip_pass_id_meter_type_idx":
        "CREATE UNIQUE INDEX trip_usage_meters_trip_pass_id_meter_type_idx ON public.trip_usage_meters USING btree (trip_pass_id, meter_type)",
      "trip_pass_orders.trip_pass_orders_checkout_idempotency_key_key":
        "CREATE UNIQUE INDEX trip_pass_orders_checkout_idempotency_key_key ON public.trip_pass_orders USING btree (checkout_idempotency_key)",
      "trip_pass_orders.trip_pass_orders_pkey":
        "CREATE UNIQUE INDEX trip_pass_orders_pkey ON public.trip_pass_orders USING btree (id)",
      "trip_pass_orders.trip_pass_orders_product_code_idx":
        "CREATE INDEX trip_pass_orders_product_code_idx ON public.trip_pass_orders USING btree (product_code)",
      "trip_pass_orders.trip_pass_orders_status_created_at_idx":
        "CREATE INDEX trip_pass_orders_status_created_at_idx ON public.trip_pass_orders USING btree (status, created_at)",
      "trip_pass_orders.trip_pass_orders_stripe_checkout_session_id_key":
        "CREATE UNIQUE INDEX trip_pass_orders_stripe_checkout_session_id_key ON public.trip_pass_orders USING btree (stripe_checkout_session_id)",
      "trip_pass_orders.trip_pass_orders_stripe_payment_intent_id_key":
        "CREATE UNIQUE INDEX trip_pass_orders_stripe_payment_intent_id_key ON public.trip_pass_orders USING btree (stripe_payment_intent_id)",
      "trip_pass_orders.trip_pass_orders_user_status_created_at_idx":
        "CREATE INDEX trip_pass_orders_user_status_created_at_idx ON public.trip_pass_orders USING btree (user_id, status, created_at)",
      "trip_pass_grants.trip_pass_grants_order_id_idx":
        "CREATE INDEX trip_pass_grants_order_id_idx ON public.trip_pass_grants USING btree (order_id)",
      "trip_pass_grants.trip_pass_grants_pkey":
        "CREATE UNIQUE INDEX trip_pass_grants_pkey ON public.trip_pass_grants USING btree (id)",
      "trip_pass_grants.trip_pass_grants_source_type_event_id_key":
        "CREATE UNIQUE INDEX trip_pass_grants_source_type_event_id_key ON public.trip_pass_grants USING btree (source_type, source_event_id)",
      "trip_pass_grants.trip_pass_grants_trip_pass_id_idx":
        "CREATE INDEX trip_pass_grants_trip_pass_id_idx ON public.trip_pass_grants USING btree (trip_pass_id)",
      "trip_pass_grants.trip_pass_grants_user_expires_at_idx":
        "CREATE INDEX trip_pass_grants_user_expires_at_idx ON public.trip_pass_grants USING btree (user_id, expires_at)",
      "trip_usage_events.trip_usage_events_idempotency_key_key":
        "CREATE UNIQUE INDEX trip_usage_events_idempotency_key_key ON public.trip_usage_events USING btree (idempotency_key)",
      "trip_usage_events.trip_usage_events_pkey":
        "CREATE UNIQUE INDEX trip_usage_events_pkey ON public.trip_usage_events USING btree (id)",
      "trip_usage_events.trip_usage_events_request_id_idx":
        "CREATE INDEX trip_usage_events_request_id_idx ON public.trip_usage_events USING btree (request_id)",
      "trip_usage_events.trip_usage_events_trip_pass_meter_created_at_idx":
        "CREATE INDEX trip_usage_events_trip_pass_meter_created_at_idx ON public.trip_usage_events USING btree (trip_pass_id, meter_type, created_at)",
      "trip_usage_events.trip_usage_events_usage_meter_id_idx":
        "CREATE INDEX trip_usage_events_usage_meter_id_idx ON public.trip_usage_events USING btree (usage_meter_id)",
      "trip_usage_events.trip_usage_events_user_created_at_idx":
        "CREATE INDEX trip_usage_events_user_created_at_idx ON public.trip_usage_events USING btree (user_id, created_at)",
    });

    await db.close();
  });

  test("creates supporting indexes for foreign keys in hardening domains", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    const indexes = await db.query<{ indexname: string }>(
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
        order by indexname
      `,
      [hardeningSupportingIndexNames],
    );

    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      hardeningSupportingIndexNames.toSorted(),
    );

    await db.close();
  });

  test("enforces Trip Pass ledger idempotency and validity constraints", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    await db.query("insert into users (id, email) values ($1, $2)", [
      "user_trip_ledger",
      "trip-ledger@example.com",
    ]);
    await db.query(
      `
        insert into trip_pass_orders (
          id,
          user_id,
          email,
          status,
          product_code,
          product_version,
          stripe_price_id,
          amount_total_minor,
          currency,
          checkout_idempotency_key,
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          stripe_customer_id,
          metadata_json,
          created_at,
          updated_at,
          completed_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17)
      `,
      [
        "order_trip_ledger",
        "user_trip_ledger",
        "trip-ledger@example.com",
        "paid",
        "siargao_trip_pass_14d_v1",
        1,
        "price_trip_pass",
        900,
        "usd",
        "checkout_key_trip_ledger",
        "cs_trip_ledger",
        "pi_trip_ledger",
        "cus_trip_ledger",
        JSON.stringify({ productCode: "siargao_trip_pass_14d_v1" }),
        "2026-07-03T00:00:00.000Z",
        "2026-07-03T00:00:00.000Z",
        "2026-07-03T00:01:00.000Z",
      ],
    );
    await db.query(
      `
        insert into trip_passes (
          id,
          user_id,
          email,
          status,
          stripe_checkout_session_id,
          stripe_payment_intent_id,
          stripe_event_id,
          starts_at,
          expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        "pass_trip_ledger",
        "user_trip_ledger",
        "trip-ledger@example.com",
        "active",
        "cs_trip_pass_ledger",
        "pi_trip_pass_ledger",
        "evt_trip_pass_ledger",
        "2026-07-03T00:00:00.000Z",
        "2026-07-17T00:00:00.000Z",
      ],
    );
    await db.query(
      `
        insert into trip_pass_grants (
          id,
          order_id,
          trip_pass_id,
          user_id,
          source_type,
          source_event_id,
          product_code,
          product_version,
          quantity,
          duration_days,
          meter_limits_json,
          starts_at,
          expires_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
      `,
      [
        "grant_trip_ledger",
        "order_trip_ledger",
        "pass_trip_ledger",
        "user_trip_ledger",
        "stripe_checkout",
        "evt_trip_ledger",
        "siargao_trip_pass_14d_v1",
        1,
        1,
        14,
        JSON.stringify({ chat_message: 150, live_refresh: 40 }),
        "2026-07-03T00:00:00.000Z",
        "2026-07-17T00:00:00.000Z",
      ],
    );
    await db.query(
      `
        insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
        values ($1, $2, $3, $4, $5)
      `,
      ["meter_trip_ledger", "pass_trip_ledger", "chat_message", 1, 150],
    );
    await db.query(
      `
        insert into trip_usage_events (
          id,
          trip_pass_id,
          usage_meter_id,
          user_id,
          event_type,
          meter_type,
          quantity,
          idempotency_key,
          request_id,
          request_hash,
          provider_request_ids_json
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
      `,
      [
        "usage_event_trip_ledger",
        "pass_trip_ledger",
        "meter_trip_ledger",
        "user_trip_ledger",
        "settled",
        "chat_message",
        1,
        "usage_key_trip_ledger",
        "request_trip_ledger",
        "hash_trip_ledger",
        JSON.stringify(["deepseek_request_trip_ledger"]),
      ],
    );

    await expectUniqueViolation(
      db.query(
        `
          insert into trip_pass_orders (
            id,
            status,
            product_code,
            product_version,
            stripe_price_id,
            checkout_idempotency_key
          )
          values ($1, $2, $3, $4, $5, $6)
        `,
        [
          "order_duplicate_checkout_key",
          "pending",
          "siargao_trip_pass_14d_v1",
          1,
          "price_trip_pass",
          "checkout_key_trip_ledger",
        ],
      ),
      "trip_pass_orders_checkout_idempotency_key_key",
    );
    await expectUniqueViolation(
      db.query(
        `
          insert into trip_pass_grants (
            id,
            trip_pass_id,
            source_type,
            source_event_id,
            product_code,
            product_version,
            duration_days,
            meter_limits_json,
            starts_at,
            expires_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
        `,
        [
          "grant_duplicate_source",
          "pass_trip_ledger",
          "stripe_checkout",
          "evt_trip_ledger",
          "siargao_trip_pass_14d_v1",
          1,
          14,
          JSON.stringify({ chat_message: 150 }),
          "2026-07-03T00:00:00.000Z",
          "2026-07-17T00:00:00.000Z",
        ],
      ),
      "trip_pass_grants_source_type_event_id_key",
    );
    await expectUniqueViolation(
      db.query(
        `
          insert into trip_usage_events (
            id,
            trip_pass_id,
            event_type,
            meter_type,
            quantity,
            idempotency_key,
            request_id
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          "usage_event_duplicate_key",
          "pass_trip_ledger",
          "settled",
          "chat_message",
          1,
          "usage_key_trip_ledger",
          "request_duplicate_usage_key",
        ],
      ),
      "trip_usage_events_idempotency_key_key",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into trip_pass_orders (
            id,
            status,
            product_code,
            product_version,
            stripe_price_id,
            amount_total_minor,
            checkout_idempotency_key
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          "order_invalid_amount",
          "pending",
          "siargao_trip_pass_14d_v1",
          1,
          "price_trip_pass",
          -1,
          "checkout_key_invalid_amount",
        ],
      ),
      "trip_pass_orders_amount_total_minor_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into trip_pass_grants (
            id,
            trip_pass_id,
            source_type,
            source_event_id,
            product_code,
            product_version,
            quantity,
            duration_days,
            meter_limits_json,
            starts_at,
            expires_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
        `,
        [
          "grant_invalid_quantity",
          "pass_trip_ledger",
          "manual_operator",
          "manual_invalid_quantity",
          "siargao_trip_pass_14d_v1",
          1,
          0,
          14,
          JSON.stringify({ chat_message: 150 }),
          "2026-07-03T00:00:00.000Z",
          "2026-07-17T00:00:00.000Z",
        ],
      ),
      "trip_pass_grants_quantity_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into trip_usage_events (
            id,
            trip_pass_id,
            event_type,
            meter_type,
            quantity,
            idempotency_key,
            request_id
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          "usage_event_invalid_quantity",
          "pass_trip_ledger",
          "settled",
          "chat_message",
          0,
          "usage_key_invalid_quantity",
          "request_invalid_quantity",
        ],
      ),
      "trip_usage_events_quantity_check",
    );

    await db.close();
  });

  test("creates hot-path indexes for read-heavy application queries", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    const indexes = await db.query<{ indexname: string }>(
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
        order by indexname
      `,
      [hotPathIndexNames],
    );

    expect(indexes.rows.map((row) => row.indexname)).toEqual(hotPathIndexNames.toSorted());

    await db.close();
  });

  test("keeps the hot-path index migration non-destructive", async () => {
    const hotPathMigrationPath = (await getMigrationPaths()).find(
      (migrationPath) => path.basename(migrationPath) === "0004_hot_path_indexes.sql",
    );

    expect(hotPathMigrationPath).toBeDefined();

    const migrationSql = await readFile(requiredString(hotPathMigrationPath), "utf8");

    expect(migrationSql).not.toMatch(destructiveHotPathMigrationPattern);
  });

  test("creates normalized public-page relationship tables with constraints and indexes", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    const relationshipTableNames = ["public_page_facts", "public_evidence_bundle_evidence"];
    const columns = await db.query<{
      table_name: string;
      column_name: string;
      data_type: string;
      is_nullable: "YES" | "NO";
    }>(
      `
        select table_name, column_name, data_type, is_nullable
        from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
        order by table_name, ordinal_position
      `,
      [relationshipTableNames],
    );
    const columnsByTable = groupRows(columns.rows, (row) => row.table_name);

    expect(
      columnsByTable.public_page_facts?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
      ]),
    ).toEqual([
      ["public_page_id", "text", "NO"],
      ["fact_id", "text", "NO"],
      ["position", "integer", "NO"],
    ]);
    expect(
      columnsByTable.public_evidence_bundle_evidence?.map((column) => [
        column.column_name,
        column.data_type,
        column.is_nullable,
      ]),
    ).toEqual([
      ["evidence_bundle_id", "text", "NO"],
      ["evidence_id", "text", "NO"],
      ["position", "integer", "NO"],
    ]);

    const relationshipKeys = await db.query<{
      table_name: string;
      constraint_name: string;
      constraint_type: string;
      column_name: string;
    }>(
      `
        select
          tc.table_name,
          tc.constraint_name,
          tc.constraint_type,
          kcu.column_name
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        where tc.table_schema = 'public'
          and tc.table_name = any($1::text[])
          and tc.constraint_type in ('PRIMARY KEY', 'UNIQUE')
        order by tc.table_name, tc.constraint_name, kcu.ordinal_position
      `,
      [relationshipTableNames],
    );

    expect(
      relationshipKeys.rows.map((row) => [
        row.table_name,
        row.constraint_name,
        row.constraint_type,
        row.column_name,
      ]),
    ).toEqual([
      [
        "public_evidence_bundle_evidence",
        "public_evidence_bundle_evidence_bundle_position_key",
        "UNIQUE",
        "evidence_bundle_id",
      ],
      [
        "public_evidence_bundle_evidence",
        "public_evidence_bundle_evidence_bundle_position_key",
        "UNIQUE",
        "position",
      ],
      [
        "public_evidence_bundle_evidence",
        "public_evidence_bundle_evidence_pkey",
        "PRIMARY KEY",
        "evidence_bundle_id",
      ],
      [
        "public_evidence_bundle_evidence",
        "public_evidence_bundle_evidence_pkey",
        "PRIMARY KEY",
        "evidence_id",
      ],
      ["public_page_facts", "public_page_facts_pkey", "PRIMARY KEY", "public_page_id"],
      ["public_page_facts", "public_page_facts_pkey", "PRIMARY KEY", "fact_id"],
      [
        "public_page_facts",
        "public_page_facts_public_page_position_key",
        "UNIQUE",
        "public_page_id",
      ],
      ["public_page_facts", "public_page_facts_public_page_position_key", "UNIQUE", "position"],
    ]);

    const relationshipForeignKeys = await db.query<{
      table_name: string;
      constraint_name: string;
      column_name: string;
      foreign_table_name: string;
      delete_rule: string;
    }>(
      `
        select
          tc.table_name,
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name as foreign_table_name,
          rc.delete_rule
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu
          on tc.constraint_name = kcu.constraint_name
          and tc.table_schema = kcu.table_schema
        join information_schema.constraint_column_usage ccu
          on tc.constraint_name = ccu.constraint_name
          and tc.table_schema = ccu.table_schema
        join information_schema.referential_constraints rc
          on tc.constraint_name = rc.constraint_name
          and tc.table_schema = rc.constraint_schema
        where tc.table_schema = 'public'
          and tc.table_name = any($1::text[])
          and tc.constraint_type = 'FOREIGN KEY'
        order by tc.table_name, tc.constraint_name
      `,
      [relationshipTableNames],
    );

    expect(
      relationshipForeignKeys.rows.map((row) => [
        row.table_name,
        row.constraint_name,
        row.column_name,
        row.foreign_table_name,
        row.delete_rule,
      ]),
    ).toEqual([
      [
        "public_evidence_bundle_evidence",
        "public_evidence_bundle_evidence_bundle_id_fkey",
        "evidence_bundle_id",
        "public_evidence_bundles",
        "CASCADE",
      ],
      [
        "public_evidence_bundle_evidence",
        "public_evidence_bundle_evidence_evidence_id_fkey",
        "evidence_id",
        "evidence",
        "RESTRICT",
      ],
      ["public_page_facts", "public_page_facts_fact_id_fkey", "fact_id", "facts", "RESTRICT"],
      [
        "public_page_facts",
        "public_page_facts_public_page_id_fkey",
        "public_page_id",
        "public_pages",
        "CASCADE",
      ],
    ]);

    const indexes = await db.query<{ indexname: string }>(
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
        order by indexname
      `,
      [publicPageRelationshipIndexNames],
    );

    expect(indexes.rows.map((row) => row.indexname)).toEqual(
      publicPageRelationshipIndexNames.toSorted(),
    );

    const checks = await db.query<{ conname: string }>(
      `
        select conname
        from pg_constraint
        where contype = 'c'
          and conname = any($1::text[])
        order by conname
      `,
      [publicPageRelationshipCheckConstraintNames],
    );

    expect(checks.rows.map((row) => row.conname)).toEqual(
      publicPageRelationshipCheckConstraintNames.toSorted(),
    );

    await db.close();
  });

  test("backfills normalized public-page relationships from legacy JSON arrays in order", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    const migrationFiles = await loadMigrationFiles();
    const relationshipMigrationName = "0005_public_page_relationships.sql";
    const setupMigrations = migrationFiles.filter(
      (migrationFile) => migrationFile.name < relationshipMigrationName,
    );

    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), setupMigrations);
    await insertLegacyPublicRelationshipBackfillFixture(db);
    await runLedgerBackedMigrations(createPgliteMigrationDatabase(db), migrationFiles);

    const pageFacts = await db.query<{ fact_id: string; position: number }>(
      `
        select fact_id, position
        from public_page_facts
        where public_page_id = 'page_backfill_relationships'
        order by position
      `,
    );
    const bundleEvidence = await db.query<{ evidence_id: string; position: number }>(
      `
        select evidence_id, position
        from public_evidence_bundle_evidence
        where evidence_bundle_id = 'bundle_backfill_relationships'
        order by position
      `,
    );

    expect(pageFacts.rows).toEqual([
      { fact_id: "fact_backfill_second", position: 0 },
      { fact_id: "fact_backfill_first", position: 1 },
    ]);
    expect(bundleEvidence.rows).toEqual([
      { evidence_id: "ev_backfill_second", position: 0 },
      { evidence_id: "ev_backfill_first", position: 1 },
    ]);

    await db.close();
  });

  test("creates high-risk check constraints for hardening domains", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    const constraints = await db.query<{ conname: string }>(
      `
        select conname
        from pg_constraint
        where contype = 'c'
          and conname = any($1::text[])
        order by conname
      `,
      [hardeningCheckConstraintNames],
    );

    expect(constraints.rows.map((row) => row.conname)).toEqual(
      hardeningCheckConstraintNames.toSorted(),
    );

    await db.close();
  });

  test("rejects representative invalid enum range counter and timestamp values", async () => {
    await resetTestDatabase();
    const db = await openTestDatabase();
    await runInitialMigration(db);

    await db.query("insert into users (id, email) values ($1, $2)", [
      "user_constraints",
      "constraints@example.com",
    ]);
    await db.query("insert into chat_threads (id, user_id, status) values ($1, $2, $3)", [
      "thread_constraints",
      "user_constraints",
      "active",
    ]);
    await db.query(
      `
        insert into trip_passes (id, status, starts_at, expires_at)
        values ($1, $2, $3, $4)
      `,
      ["pass_constraints", "active", "2026-07-03T00:00:00.000Z", "2026-07-04T00:00:00.000Z"],
    );
    await db.query(
      `
        insert into audit_requests (id, status, price_usd)
        values ($1, $2, $3)
      `,
      ["audit_constraints", "created", "9.99"],
    );
    await db.query(
      `
        insert into providers (id, slug, name, provider_type)
        values ($1, $2, $3, $4)
      `,
      ["provider_constraints", "provider-constraints", "Provider Constraints", "weather_api"],
    );
    await db.query("insert into google_places (place_id) values ($1)", ["place_constraints"]);

    await expectCheckViolation(
      db.query(
        `
          insert into chat_messages (id, thread_id, user_id, role, content, status)
          values ($1, $2, $3, $4, $5, $6)
        `,
        [
          "message_invalid_role",
          "thread_constraints",
          "user_constraints",
          "system",
          "invalid role",
          "complete",
        ],
      ),
      "chat_messages_role_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into source_profiles (
            id,
            source_name,
            source_type,
            access_method,
            allowed_use,
            freshness_window_days,
            authority_level
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        ["source_invalid_allowed_use", "Invalid source", "official", "api", "public_copy", 1, 3],
      ),
      "source_profiles_allowed_use_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into google_place_details (
            place_id,
            rating,
            user_rating_count,
            fetched_at,
            stale_at,
            retention_expires_at
          )
          values ($1, $2, $3, $4, $5, $6)
        `,
        [
          "place_constraints",
          "6",
          1,
          "2026-07-03T00:00:00.000Z",
          "2026-07-04T00:00:00.000Z",
          "2026-08-03T00:00:00.000Z",
        ],
      ),
      "google_place_details_rating_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into trip_passes (id, status, starts_at, expires_at)
          values ($1, $2, $3, $4)
        `,
        ["pass_invalid_order", "active", "2026-07-04T00:00:00.000Z", "2026-07-03T00:00:00.000Z"],
      ),
      "trip_passes_timestamp_order_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into trip_usage_meters (id, trip_pass_id, meter_type, used, "limit")
          values ($1, $2, $3, $4, $5)
        `,
        ["meter_invalid_counter", "pass_constraints", "chat_message", -1, 10],
      ),
      "trip_usage_meters_counter_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into payments (id, audit_request_id, amount_usd, status)
          values ($1, $2, $3, $4)
        `,
        ["payment_invalid_status", "audit_constraints", "9.99", "settled"],
      ),
      "payments_status_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into audit_inputs (id, audit_request_id, start_date, end_date, top_constraint)
          values ($1, $2, $3, $4, $5)
        `,
        ["audit_input_invalid_dates", "audit_constraints", "2026-08-02", "2026-08-01", "budget"],
      ),
      "audit_inputs_date_order_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into refresh_jobs (id, refresh_reason, priority, scheduled_at)
          values ($1, $2, $3, $4)
        `,
        ["refresh_invalid_priority", "scheduled_weather_forecast_refresh", -1, "2026-07-03"],
      ),
      "refresh_jobs_priority_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into public_pages (
            id,
            slug,
            page_type,
            canonical_url,
            human_path,
            llm_markdown_path,
            json_api_path,
            confidence_label,
            public_visibility,
            indexing_status
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          "public_page_invalid_visibility",
          "invalid-visibility",
          "areas",
          "https://siargao.test/areas/invalid-visibility",
          "/areas/invalid-visibility",
          "/areas/invalid-visibility.md",
          "/api/public/areas/invalid-visibility",
          "medium",
          "private",
          "index",
        ],
      ),
      "public_pages_public_visibility_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into llm_runs (id, run_type, model_family, input_redaction_version, output_schema_version, status, started_at, completed_at)
          values ($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          "llm_invalid_order",
          "report_generation",
          "gpt",
          "v1",
          "v1",
          "completed",
          "2026-07-04T00:00:00.000Z",
          "2026-07-03T00:00:00.000Z",
        ],
      ),
      "llm_runs_timestamp_order_check",
    );
    await expectCheckViolation(
      db.query(
        `
          insert into provider_health_checks (id, provider_id, status, latency_ms)
          values ($1, $2, $3, $4)
        `,
        ["provider_health_invalid_latency", "provider_constraints", "ok", -1],
      ),
      "provider_health_checks_latency_ms_check",
    );

    await db.close();
  });
});

const authTableNames = [
  "users",
  "account_closure_tombstones",
  "account_closure_operations",
  "account_closure_write_barriers",
  "user_profiles",
  "chat_threads",
  "chat_messages",
  "chat_response_ratings",
];
const tripTableNames = [
  "saved_trips",
  "saved_trip_items",
  "shared_trip_plans",
  "trip_passes",
  "trip_usage_meters",
  "trip_pass_orders",
  "trip_pass_grants",
  "trip_usage_events",
];
const hardeningSupportingIndexNames = [
  "agent_readable_snapshots_public_page_id_idx",
  "audit_completeness_checks_audit_request_id_idx",
  "audit_inputs_accommodation_entity_id_idx",
  "audit_inputs_arrival_route_id_idx",
  "audit_inputs_audit_request_id_idx",
  "audit_inputs_stay_area_id_idx",
  "audit_reports_audit_request_id_idx",
  "audit_reports_audit_run_id_idx",
  "audit_requests_user_id_idx",
  "audit_runs_audit_request_id_idx",
  "candidate_entities_source_profile_id_idx",
  "candidate_entities_source_record_id_idx",
  "chat_response_ratings_message_id_idx",
  "entities_area_id_idx",
  "entity_matches_candidate_entity_id_idx",
  "entity_matches_entity_id_idx",
  "evidence_fact_id_idx",
  "evidence_source_record_id_idx",
  "fact_confidence_scores_fact_id_idx",
  "fact_conflicts_conflicting_fact_id_idx",
  "fact_conflicts_primary_fact_id_idx",
  "facts_entity_id_idx",
  "facts_source_profile_id_idx",
  "facts_source_record_id_idx",
  "google_place_snapshots_source_record_id_idx",
  "google_places_canonical_entity_id_idx",
  "google_places_latest_source_record_id_idx",
  "llm_runs_audit_run_id_idx",
  "llm_tool_calls_llm_run_id_idx",
  "payment_events_audit_request_id_idx",
  "payments_audit_request_id_idx",
  "provider_health_checks_provider_id_idx",
  "public_page_generation_jobs_public_page_id_idx",
  "public_pages_entity_id_idx",
  "public_pages_evidence_bundle_id_idx",
  "raw_snapshots_source_profile_id_idx",
  "refresh_jobs_entity_id_idx",
  "refresh_jobs_fact_id_idx",
  "refresh_jobs_source_profile_id_idx",
  "reviewer_results_audit_run_id_idx",
  "reviewer_results_llm_run_id_idx",
  "reviews_entity_id_idx",
  "reviews_source_record_id_idx",
  "source_credibility_scores_source_profile_id_idx",
  "source_permissions_source_profile_id_idx",
  "source_profiles_provider_id_idx",
  "source_records_raw_snapshot_id_idx",
  "source_records_source_profile_id_idx",
  "trip_pass_grants_order_id_idx",
  "trip_pass_grants_trip_pass_id_idx",
  "trip_pass_grants_user_expires_at_idx",
  "trip_pass_orders_product_family_idx",
  "trip_pass_orders_user_family_effective_pending_idx",
  "trip_pass_orders_user_status_created_at_idx",
  "trip_usage_events_trip_pass_meter_created_at_idx",
  "trip_usage_events_usage_meter_id_idx",
  "trip_usage_events_user_created_at_idx",
];
const hotPathIndexNames = [
  "chat_messages_thread_user_created_id_idx",
  "chat_threads_user_active_recent_idx",
  "evidence_public_fact_created_idx",
  "facts_public_republish_freshness_idx",
  "google_place_snapshots_chat_cache_freshness_idx",
  "saved_trip_items_active_id_trip_idx",
  "saved_trip_items_active_trip_created_id_idx",
  "saved_trips_user_recent_idx",
];
const publicPageRelationshipIndexNames = [
  "public_evidence_bundle_evidence_bundle_position_key",
  "public_evidence_bundle_evidence_evidence_id_idx",
  "public_evidence_bundle_evidence_ordered_bundle_idx",
  "public_evidence_bundle_evidence_pkey",
  "public_page_facts_fact_id_idx",
  "public_page_facts_ordered_page_idx",
  "public_page_facts_pkey",
  "public_page_facts_public_page_position_key",
];
const publicPageRelationshipCheckConstraintNames = [
  "public_evidence_bundle_evidence_position_check",
  "public_page_facts_position_check",
];
const hardeningCheckConstraintNames = [
  "agent_readable_snapshots_format_check",
  "areas_latitude_check",
  "areas_longitude_check",
  "audit_inputs_date_order_check",
  "audit_reports_confidence_label_check",
  "audit_reports_overall_risk_check",
  "audit_requests_price_usd_check",
  "audit_requests_status_check",
  "audit_runs_state_check",
  "audit_runs_timestamp_order_check",
  "candidate_entities_discovery_confidence_check",
  "chat_messages_role_check",
  "chat_messages_status_check",
  "chat_response_ratings_rating_check",
  "chat_threads_status_check",
  "entities_confidence_label_check",
  "entities_public_visibility_check",
  "entity_matches_match_score_check",
  "entity_matches_match_status_check",
  "evidence_allowed_use_check",
  "fact_confidence_scores_label_check",
  "fact_confidence_scores_score_check",
  "fact_conflicts_resolution_status_check",
  "facts_confidence_label_check",
  "facts_source_authority_check",
  "facts_source_type_check",
  "facts_timestamp_order_check",
  "google_place_details_business_status_check",
  "google_place_details_latitude_check",
  "google_place_details_longitude_check",
  "google_place_details_price_level_check",
  "google_place_details_rating_check",
  "google_place_details_timestamp_order_check",
  "google_place_details_user_rating_count_check",
  "google_place_reviews_rating_check",
  "google_place_reviews_timestamp_order_check",
  "google_place_snapshots_request_kind_check",
  "google_place_snapshots_storage_policy_check",
  "google_place_snapshots_timestamp_order_check",
  "google_places_seen_order_check",
  "llm_runs_status_check",
  "llm_runs_timestamp_order_check",
  "payments_amount_usd_check",
  "payments_status_check",
  "provider_health_checks_latency_ms_check",
  "provider_health_checks_status_check",
  "providers_provider_type_check",
  "public_evidence_bundles_allowed_use_check",
  "public_page_generation_jobs_status_check",
  "public_page_generation_jobs_timestamp_order_check",
  "public_pages_confidence_label_check",
  "public_pages_indexing_status_check",
  "public_pages_page_type_check",
  "public_pages_public_visibility_check",
  "raw_snapshots_allowed_use_check",
  "raw_snapshots_retention_order_check",
  "refresh_jobs_attempt_count_check",
  "refresh_jobs_priority_check",
  "refresh_jobs_result_status_check",
  "reviewer_results_verdict_check",
  "reviews_allowed_use_check",
  "reviews_rating_check",
  "reviews_review_count_check",
  "source_credibility_scores_label_check",
  "source_credibility_scores_score_check",
  "source_permissions_allowed_use_check",
  "source_profiles_allowed_use_check",
  "source_profiles_authority_level_check",
  "source_profiles_freshness_window_days_check",
  "source_profiles_known_ai_or_seo_content_risk_check",
  "source_profiles_known_stale_risk_check",
  "source_profiles_source_type_check",
  "source_records_allowed_use_check",
  "trip_passes_status_check",
  "trip_passes_timestamp_order_check",
  "trip_pass_grants_duration_days_check",
  "trip_pass_grants_product_version_check",
  "trip_pass_grants_quantity_check",
  "trip_pass_grants_source_type_check",
  "trip_pass_grants_timestamp_order_check",
  "trip_pass_orders_amount_total_minor_check",
  "trip_pass_orders_completed_at_check",
  "trip_pass_orders_currency_check",
  "trip_pass_orders_checkout_session_status_check",
  "trip_pass_orders_product_family_check",
  "trip_pass_orders_product_version_check",
  "trip_pass_orders_status_check",
  "trip_usage_events_event_type_check",
  "trip_usage_events_meter_type_check",
  "trip_usage_events_quantity_check",
  "trip_usage_meters_counter_check",
  "trip_usage_meters_meter_type_check",
];

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

function createMigrationFile(name: string, sql: string): MigrationFile {
  return {
    name,
    path: `/virtual/drizzle/${name}`,
    sql,
    checksum: checksumMigrationSql(sql),
  };
}

function requiredString(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("Expected string to be defined.");
  }

  return value;
}

async function expectCheckViolation(promise: Promise<unknown>, constraintName: string) {
  await expect(promise).rejects.toThrow(new RegExp(constraintName));
}

async function expectUniqueViolation(promise: Promise<unknown>, constraintName: string) {
  await expect(promise).rejects.toThrow(new RegExp(constraintName));
}

async function insertLegacyPublicRelationshipBackfillFixture(db: PGlite) {
  await db.query(
    `
      insert into entities (id, slug, entity_type, name, public_visibility, confidence_label)
      values (
        'entity_backfill_relationships',
        'backfill-relationships',
        'risk',
        'Backfill Relationships',
        'eligible',
        'high'
      )
    `,
  );
  await db.query(
    `
      insert into source_profiles (
        id,
        source_name,
        source_type,
        access_method,
        allowed_use,
        freshness_window_days,
        authority_level
      )
      values (
        'source_backfill_relationships',
        'Backfill source',
        'official',
        'official_page',
        'public_republish',
        30,
        4
      )
    `,
  );
  await db.query(
    `
      insert into facts (
        id,
        entity_id,
        claim,
        fact_type,
        source_type,
        source_profile_id,
        fetched_at,
        confidence_label,
        source_authority,
        public_republish_allowed,
        audit_use_allowed,
        raw_evidence_allowed
      )
      values
        (
          'fact_backfill_first',
          'entity_backfill_relationships',
          'First legacy fact.',
          'risk_preview',
          'official',
          'source_backfill_relationships',
          '2026-06-22T00:00:00.000Z',
          'high',
          4,
          true,
          true,
          false
        ),
        (
          'fact_backfill_second',
          'entity_backfill_relationships',
          'Second legacy fact.',
          'risk_preview',
          'official',
          'source_backfill_relationships',
          '2026-06-22T00:00:00.000Z',
          'high',
          4,
          true,
          true,
          false
        )
    `,
  );
  await db.query(
    `
      insert into evidence (
        id,
        fact_id,
        label,
        allowed_use,
        public_republish_allowed
      )
      values
        (
          'ev_backfill_first',
          'fact_backfill_first',
          'First evidence',
          'public_republish',
          true
        ),
        (
          'ev_backfill_second',
          'fact_backfill_second',
          'Second evidence',
          'public_republish',
          true
        )
    `,
  );
  await db.query(
    `
      insert into public_evidence_bundles (id, slug, evidence_ids, summary, allowed_use)
      values (
        'bundle_backfill_relationships',
        'risks-backfill-relationships',
        '["ev_backfill_second", "ev_backfill_first", "ev_backfill_second"]'::jsonb,
        'Backfill relationship bundle.',
        'public_republish'
      )
    `,
  );
  await db.query(
    `
      insert into public_pages (
        id,
        slug,
        page_type,
        entity_id,
        canonical_url,
        human_path,
        llm_markdown_path,
        json_api_path,
        evidence_bundle_id,
        confidence_label,
        public_visibility,
        indexing_status,
        generation_source_fact_ids
      )
      values (
        'page_backfill_relationships',
        'backfill-relationships',
        'risks',
        'entity_backfill_relationships',
        'https://siargao.example/risks/backfill-relationships',
        '/risks/backfill-relationships',
        '/risks/backfill-relationships/llm.md',
        '/api/public/risks/backfill-relationships.json',
        'bundle_backfill_relationships',
        'high',
        'eligible',
        'index',
        '["fact_backfill_second", "fact_backfill_first", "fact_backfill_second"]'::jsonb
      )
    `,
  );
}

const destructiveHotPathMigrationPattern =
  /\bdrop\s+index\b|\bdrop\s+constraint\b|\bdrop\s+table\b|\bdrop\s+column\b|\balter\s+table\b[^;]*\bdrop\b/iu;

const savedTripItemsPrimaryKeyRewritePattern =
  /ALTER TABLE saved_trip_items DROP CONSTRAINT IF EXISTS saved_trip_items_pkey;\s*ALTER TABLE saved_trip_items ADD PRIMARY KEY \(trip_id, id\);/;

function guardSavedTripItemsPrimaryKeyRewrite(database: MigrationDatabase): MigrationDatabase {
  return {
    query: database.query,
    async execute(statement: string) {
      if (savedTripItemsPrimaryKeyRewritePattern.test(statement)) {
        throw new Error(
          "The saved_trip_items primary-key rewrite ran after bootstrap was already applied.",
        );
      }

      await database.execute(statement);
    },
    async transaction<T>(callback: (transactionDatabase: MigrationDatabase) => Promise<T>) {
      return database.transaction((transactionDatabase) =>
        callback(guardSavedTripItemsPrimaryKeyRewrite(transactionDatabase)),
      );
    },
  };
}

function requiredMigrationFile(migrationFiles: readonly MigrationFile[], name: string) {
  const migrationFile = migrationFiles.find((candidate) => candidate.name === name);
  if (!migrationFile) {
    throw new Error(`Required migration ${name} was not discovered.`);
  }
  return migrationFile;
}

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
  sourceCredibilityScores,
  sourcePermissions,
  sourceProfiles,
  sourceRecords,
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
});

import { describe, expect, test } from "bun:test";

import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import {
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
      "entities",
      "accommodations",
      "areas",
      "routes",
      "providers",
      "source_profiles",
      "source_permissions",
      "source_records",
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
});

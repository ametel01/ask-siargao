import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { runInitialMigration } from "@/server/db/test-database";
import { createDatabasePublicKnowledgeCatalog } from "@/server/public-pages/database-public-catalog";
import {
  buildPublicCatalogProjection,
  buildPublicJsonLd,
  buildPublicPageJson,
  buildPublicPageMarkdown,
} from "@/server/public-pages/public-content";

describe("database public knowledge catalog", () => {
  test("projects eligible persisted pages through the shared public output builders", async () => {
    const db = await openPublicCatalogTestDatabase();
    await insertEligibleRiskPage(db);

    const catalog = createDatabasePublicKnowledgeCatalog({
      client: db,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });
    const page = await catalog.getPage("risks", "monsoon-transfer-risk");
    const pages = await catalog.listEligiblePages();

    expect(page).toBeDefined();
    if (!page) {
      throw new Error("Expected eligible persisted public page.");
    }

    const json = buildPublicPageJson(page);
    const markdown = buildPublicPageMarkdown(page);
    const jsonLd = buildPublicJsonLd(page);
    const projection = buildPublicCatalogProjection(pages);

    expect(page.title).toBe("Monsoon Transfer Risk");
    expect(page.summary).toContain("public transfer evidence");
    expect(page.generationSourceFactIds).toEqual(["fact_monsoon_transfer_risk"]);
    expect(page.evidenceBundle.evidenceIds).toEqual(["ev_monsoon_transfer_risk"]);
    expect(JSON.stringify(json)).toContain("Late monsoon arrivals need verified backups");
    expect(markdown).toContain("Late monsoon arrivals need verified backups");
    expect(JSON.stringify(jsonLd)).toContain("Late monsoon arrivals need verified backups");
    expect(JSON.stringify(projection.entities)).toContain(page.canonicalUrl);
    expect(JSON.stringify(projection.evidence)).toContain("ev_monsoon_transfer_risk");
    expect(JSON.stringify(projection.riskPreview)).toContain("monsoon-transfer-risk");
    expect(projection.sitemapXml).toContain("/risks/monsoon-transfer-risk");
    expect(projection.llmsTxt).toContain("/risks/monsoon-transfer-risk/llm.md");
    expect(JSON.stringify(projection)).not.toContain("raw_payload");

    await db.close();
  });

  test("excludes ineligible persisted pages from lookup and every public index projection", async () => {
    const db = await openPublicCatalogTestDatabase();
    await insertEligibleRiskPage(db);
    await insertBlockedRiskPage(db);

    const catalog = createDatabasePublicKnowledgeCatalog({
      client: db,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });
    const directLookup = await catalog.getPage("risks", "blocked-private-risk");
    const allPages = await catalog.listPages();
    const eligiblePages = await catalog.listEligiblePages();
    const projection = buildPublicCatalogProjection(eligiblePages);

    expect(directLookup).toBeUndefined();
    expect(allPages.map((page) => page.slug)).toContain("blocked-private-risk");
    expect(eligiblePages.map((page) => page.slug)).not.toContain("blocked-private-risk");
    expect(JSON.stringify(projection)).not.toContain("blocked-private-risk");
    expect(JSON.stringify(projection)).not.toContain("Private traveler note");
    expect(projection.sitemapXml).not.toContain("blocked-private-risk");
    expect(projection.llmsTxt).not.toContain("blocked-private-risk");

    await db.close();
  });
});

async function openPublicCatalogTestDatabase() {
  const db = new PGlite();
  await runInitialMigration(db);
  await db.query(
    `
      insert into source_profiles (
        id,
        source_name,
        source_type,
        access_method,
        allowed_use,
        freshness_window_days,
        authority_level,
        stores_raw_allowed,
        publishes_raw_allowed,
        requires_partner_approval
      )
      values
        (
          'source_public_tourism_directory',
          'Public tourism directory',
          'official',
          'official_page',
          'public_republish',
          30,
          4,
          false,
          true,
          false
        ),
        (
          'source_private_audit_notes',
          'Private audit notes',
          'user_submitted',
          'user_submitted',
          'audit_only',
          1,
          1,
          false,
          false,
          false
        )
    `,
  );
  return db;
}

async function insertEligibleRiskPage(db: PGlite) {
  await db.query(
    `
      insert into entities (
        id,
        slug,
        entity_type,
        name,
        public_visibility,
        confidence_label,
        updated_at
      )
      values (
        'entity_monsoon_transfer_risk',
        'monsoon-transfer-risk',
        'risk',
        'Monsoon Transfer Risk',
        'eligible',
        'high',
        '2026-06-22T00:00:00.000Z'
      )
    `,
  );
  await db.query(
    `
      insert into source_records (
        id,
        source_profile_id,
        entity_type,
        name,
        normalized_payload,
        source_url,
        fetched_at,
        allowed_use
      )
      values (
        'record_monsoon_transfer_risk',
        'source_public_tourism_directory',
        'risk',
        'Monsoon Transfer Risk',
        '{}'::jsonb,
        'https://siargao.example/public-directory/monsoon-transfer-risk',
        '2026-06-22T00:00:00.000Z',
        'public_republish'
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
        source_record_id,
        fetched_at,
        expires_at,
        confidence_label,
        source_authority,
        public_republish_allowed,
        audit_use_allowed,
        raw_evidence_allowed
      )
      values (
        'fact_monsoon_transfer_risk',
        'entity_monsoon_transfer_risk',
        'Late monsoon arrivals need verified backups before committing to a final transfer.',
        'risk_preview',
        'official',
        'source_public_tourism_directory',
        'record_monsoon_transfer_risk',
        '2026-06-22T00:00:00.000Z',
        '2026-07-22T00:00:00.000Z',
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
        source_record_id,
        label,
        citation_url,
        citation_text,
        allowed_use,
        public_republish_allowed
      )
      values (
        'ev_monsoon_transfer_risk',
        'fact_monsoon_transfer_risk',
        'record_monsoon_transfer_risk',
        'Public transfer evidence',
        'https://siargao.example/public-directory/monsoon-transfer-risk',
        'Transfer backup guidance',
        'public_republish',
        true
      )
    `,
  );
  await db.query(
    `
      insert into public_evidence_bundles (id, slug, evidence_ids, summary, allowed_use, created_at)
      values (
        'bundle_monsoon_transfer_risk',
        'risks-monsoon-transfer-risk',
        '["ev_monsoon_transfer_risk"]'::jsonb,
        'A persisted risk page backed by public transfer evidence.',
        'public_republish',
        '2026-06-22T00:00:00.000Z'
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
        last_generated_at,
        last_verified_at,
        confidence_label,
        public_visibility,
        indexing_status,
        stale_fields,
        generation_source_fact_ids
      )
      values (
        'page_monsoon_transfer_risk',
        'monsoon-transfer-risk',
        'risks',
        'entity_monsoon_transfer_risk',
        'https://siargao.example/risks/monsoon-transfer-risk',
        '/risks/monsoon-transfer-risk',
        '/risks/monsoon-transfer-risk/llm.md',
        '/api/public/risks/monsoon-transfer-risk.json',
        'bundle_monsoon_transfer_risk',
        '2026-06-22T00:00:00.000Z',
        '2026-06-22T00:00:00.000Z',
        'high',
        'eligible',
        'index',
        '[]'::jsonb,
        '["fact_monsoon_transfer_risk"]'::jsonb
      )
    `,
  );
}

async function insertBlockedRiskPage(db: PGlite) {
  await db.query(
    `
      insert into entities (
        id,
        slug,
        entity_type,
        name,
        public_visibility,
        confidence_label
      )
      values (
        'entity_blocked_private_risk',
        'blocked-private-risk',
        'risk',
        'Blocked Private Risk',
        'blocked',
        'low'
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
      values (
        'fact_blocked_private_risk',
        'entity_blocked_private_risk',
        'Private traveler note says the route was unsafe.',
        'private_paid_report',
        'user_submitted',
        'source_private_audit_notes',
        '2026-06-22T00:00:00.000Z',
        'low',
        1,
        false,
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
      values (
        'ev_blocked_private_risk',
        'fact_blocked_private_risk',
        'Private audit evidence',
        'audit_only',
        false
      )
    `,
  );
  await db.query(
    `
      insert into public_evidence_bundles (id, slug, evidence_ids, summary, allowed_use)
      values (
        'bundle_blocked_private_risk',
        'risks-blocked-private-risk',
        '["ev_blocked_private_risk"]'::jsonb,
        'Private traveler note summary.',
        'audit_only'
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
        stale_fields,
        generation_source_fact_ids
      )
      values (
        'page_blocked_private_risk',
        'blocked-private-risk',
        'risks',
        'entity_blocked_private_risk',
        'https://siargao.example/risks/blocked-private-risk',
        '/risks/blocked-private-risk',
        '/risks/blocked-private-risk/llm.md',
        '/api/public/risks/blocked-private-risk.json',
        'bundle_blocked_private_risk',
        'low',
        'blocked',
        'noindex',
        '["private_notes"]'::jsonb,
        '["fact_blocked_private_risk"]'::jsonb
      )
    `,
  );
}

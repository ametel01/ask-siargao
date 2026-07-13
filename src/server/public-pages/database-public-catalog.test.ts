import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import type { DatabaseQueryClient, QueryResult } from "@/server/db/query-client";
import { runInitialMigration } from "@/server/db/test-database";
import {
  createDatabasePublicKnowledgeCatalog,
  PUBLIC_CATALOG_DEFAULT_PAGE_LIMIT,
  PUBLIC_CATALOG_EVIDENCE_PER_BUNDLE_LIMIT,
  PUBLIC_CATALOG_FACTS_PER_PAGE_LIMIT,
  PUBLIC_CATALOG_MAX_PAGE_LIMIT,
} from "@/server/public-pages/database-public-catalog";
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

  test("uses finite default and custom page caps for database-backed list reads", async () => {
    const db = await openPublicCatalogTestDatabase();
    await insertEligibleRiskPage(db);
    const captured = createCapturingClient(db);
    const catalog = createDatabasePublicKnowledgeCatalog({
      client: captured.client,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });

    const defaultPages = await catalog.listPages();
    const customPages = await catalog.listPages({ limit: 1 });
    const clampedPages = await catalog.listPages({ limit: PUBLIC_CATALOG_MAX_PAGE_LIMIT + 1 });

    expect(defaultPages.map((page) => page.slug)).toEqual(["monsoon-transfer-risk"]);
    expect(customPages.map((page) => page.slug)).toEqual(["monsoon-transfer-risk"]);
    expect(clampedPages.map((page) => page.slug)).toEqual(["monsoon-transfer-risk"]);
    expect(captured.params[0]?.slice(2, 5)).toEqual([
      PUBLIC_CATALOG_DEFAULT_PAGE_LIMIT,
      PUBLIC_CATALOG_FACTS_PER_PAGE_LIMIT,
      PUBLIC_CATALOG_EVIDENCE_PER_BUNDLE_LIMIT,
    ]);
    expect(captured.params[1]?.[2]).toBe(1);
    expect(captured.params[2]?.[2]).toBe(PUBLIC_CATALOG_MAX_PAGE_LIMIT);

    await db.close();
  });

  test("limits catalog pages without truncating normalized or legacy relationship hydration", async () => {
    const db = await openPublicCatalogTestDatabase();
    await insertEligibleRiskPage(db, { relationshipMode: "legacy" });
    await insertOrderedRiskPage(db);

    const catalog = createDatabasePublicKnowledgeCatalog({
      client: db,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });
    const pages = await catalog.listPages({ limit: 2 });

    expect(pages.map((page) => page.publicPageId)).toEqual([
      "page_monsoon_transfer_risk",
      "page_ordered_risk",
    ]);
    expect(pages[0]?.generationSourceFactIds).toEqual(["fact_monsoon_transfer_risk"]);
    expect(pages[0]?.evidenceBundle.evidenceIds).toEqual(["ev_monsoon_transfer_risk"]);
    expect(pages[1]?.generationSourceFactIds).toEqual(["fact_zulu_ordered", "fact_alpha_ordered"]);
    expect(pages[1]?.evidenceBundle.evidenceIds).toEqual(["ev_zulu_ordered", "ev_alpha_ordered"]);
    expect(pages[1]?.facts.map((fact) => fact.id)).toEqual([
      "fact_zulu_ordered",
      "fact_alpha_ordered",
    ]);

    await db.close();
  });

  test("falls back to legacy JSON relationships when normalized rows are absent", async () => {
    const db = await openPublicCatalogTestDatabase();
    await insertEligibleRiskPage(db, { relationshipMode: "legacy" });

    const catalog = createDatabasePublicKnowledgeCatalog({
      client: db,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });
    const page = await catalog.getPage("risks", "monsoon-transfer-risk");

    expect(page?.generationSourceFactIds).toEqual(["fact_monsoon_transfer_risk"]);
    expect(page?.evidenceBundle.evidenceIds).toEqual(["ev_monsoon_transfer_risk"]);
    expect(page?.facts.map((fact) => fact.id)).toEqual(["fact_monsoon_transfer_risk"]);

    await db.close();
  });

  test("prefers normalized relationships over stale legacy JSON per parent", async () => {
    const db = await openPublicCatalogTestDatabase();
    await insertEligibleRiskPage(db, {
      legacyEvidenceIds: ["ev_legacy_should_not_be_used"],
      legacyFactIds: ["fact_legacy_should_not_be_used"],
      relationshipMode: "normalized",
    });

    const catalog = createDatabasePublicKnowledgeCatalog({
      client: db,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });
    const page = await catalog.getPage("risks", "monsoon-transfer-risk");

    expect(page?.generationSourceFactIds).toEqual(["fact_monsoon_transfer_risk"]);
    expect(page?.evidenceBundle.evidenceIds).toEqual(["ev_monsoon_transfer_risk"]);
    expect(JSON.stringify(page)).not.toContain("legacy_should_not_be_used");

    await db.close();
  });

  test("preserves non-alphabetic normalized fact and evidence ordering", async () => {
    const db = await openPublicCatalogTestDatabase();
    await insertOrderedRiskPage(db);

    const catalog = createDatabasePublicKnowledgeCatalog({
      client: db,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });
    const page = await catalog.getPage("risks", "ordered-risk");

    expect(page?.generationSourceFactIds).toEqual(["fact_zulu_ordered", "fact_alpha_ordered"]);
    expect(page?.evidenceBundle.evidenceIds).toEqual(["ev_zulu_ordered", "ev_alpha_ordered"]);
    expect(page?.facts.map((fact) => fact.id)).toEqual(["fact_zulu_ordered", "fact_alpha_ordered"]);
    expect(page?.facts.map((fact) => fact.evidenceId)).toEqual([
      "ev_zulu_ordered",
      "ev_alpha_ordered",
    ]);

    await db.close();
  });

  test("does not crash or publish a page when normalized evidence is missing for a fact", async () => {
    const db = await openPublicCatalogTestDatabase();
    await insertMissingEvidenceRiskPage(db);

    const catalog = createDatabasePublicKnowledgeCatalog({
      client: db,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });
    const page = (await catalog.listPages()).find(
      (candidate) => candidate.slug === "missing-evidence-risk",
    );
    const eligiblePages = await catalog.listEligiblePages();

    expect(page?.generationSourceFactIds).toEqual(["fact_missing_public_evidence"]);
    expect(page?.evidenceBundle.evidenceIds).toEqual(["ev_other_public_evidence"]);
    expect(page?.facts).toHaveLength(1);
    expect(page?.facts[0]?.evidenceId).toBe("ev_other_public_evidence");
    expect(page?.facts[0]?.evidencePublicRepublishAllowed).toBe(false);
    expect(eligiblePages.map((eligiblePage) => eligiblePage.slug)).not.toContain(
      "missing-evidence-risk",
    );

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

  test("drops query rows whose page_type is not a registered public family", async () => {
    const client = {
      async query<T>(): Promise<QueryResult<T>> {
        return {
          rows: [
            {
              public_page_id: "page_unregistered_family",
              page_type: "restaurants",
            },
          ] as T[],
        };
      },
    } satisfies DatabaseQueryClient;
    const catalog = createDatabasePublicKnowledgeCatalog({
      client,
      now: new Date("2026-06-23T00:00:00.000Z"),
    });

    expect(await catalog.listPages()).toEqual([]);
    expect(await catalog.listEligiblePages()).toEqual([]);
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

function createCapturingClient(db: PGlite): {
  client: DatabaseQueryClient;
  params: unknown[][];
} {
  const params: unknown[][] = [];
  return {
    client: {
      async query<T>(query: string, queryParams: unknown[] = []): Promise<QueryResult<T>> {
        params.push(queryParams);
        return db.query<T>(query, queryParams);
      },
    },
    params,
  };
}

type RelationshipMode = "normalized" | "legacy";

async function insertEligibleRiskPage(
  db: PGlite,
  options: {
    legacyEvidenceIds?: string[];
    legacyFactIds?: string[];
    relationshipMode?: RelationshipMode;
  } = {},
) {
  const relationshipMode = options.relationshipMode ?? "normalized";
  const legacyFactIds = options.legacyFactIds ?? ["fact_monsoon_transfer_risk"];
  const legacyEvidenceIds = options.legacyEvidenceIds ?? ["ev_monsoon_transfer_risk"];

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
        $1::jsonb,
        'A persisted risk page backed by public transfer evidence.',
        'public_republish',
        '2026-06-22T00:00:00.000Z'
      )
    `,
    [JSON.stringify(legacyEvidenceIds)],
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
        $1::jsonb
      )
    `,
    [JSON.stringify(legacyFactIds)],
  );

  if (relationshipMode === "normalized") {
    await db.query(
      `
        insert into public_page_facts (public_page_id, fact_id, position)
        values ('page_monsoon_transfer_risk', 'fact_monsoon_transfer_risk', 0)
      `,
    );
    await db.query(
      `
        insert into public_evidence_bundle_evidence (evidence_bundle_id, evidence_id, position)
        values ('bundle_monsoon_transfer_risk', 'ev_monsoon_transfer_risk', 0)
      `,
    );
  }
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

async function insertOrderedRiskPage(db: PGlite) {
  await db.query(
    `
      insert into entities (id, slug, entity_type, name, public_visibility, confidence_label)
      values (
        'entity_ordered_risk',
        'ordered-risk',
        'risk',
        'Ordered Risk',
        'eligible',
        'high'
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
        expires_at,
        confidence_label,
        source_authority,
        public_republish_allowed,
        audit_use_allowed,
        raw_evidence_allowed
      )
      values
        (
          'fact_alpha_ordered',
          'entity_ordered_risk',
          'Alphabetic fact should render second.',
          'risk_preview',
          'official',
          'source_public_tourism_directory',
          '2026-06-22T00:00:00.000Z',
          '2026-07-22T00:00:00.000Z',
          'high',
          4,
          true,
          true,
          false
        ),
        (
          'fact_zulu_ordered',
          'entity_ordered_risk',
          'Zulu fact should render first.',
          'risk_preview',
          'official',
          'source_public_tourism_directory',
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
      insert into evidence (id, fact_id, label, allowed_use, public_republish_allowed)
      values
        (
          'ev_alpha_ordered',
          'fact_alpha_ordered',
          'Alpha evidence',
          'public_republish',
          true
        ),
        (
          'ev_zulu_ordered',
          'fact_zulu_ordered',
          'Zulu evidence',
          'public_republish',
          true
        )
    `,
  );
  await db.query(
    `
      insert into public_evidence_bundles (id, slug, evidence_ids, summary, allowed_use)
      values (
        'bundle_ordered_risk',
        'risks-ordered-risk',
        '["ev_alpha_ordered", "ev_zulu_ordered"]'::jsonb,
        'Ordered public evidence.',
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
        'page_ordered_risk',
        'ordered-risk',
        'risks',
        'entity_ordered_risk',
        'https://siargao.example/risks/ordered-risk',
        '/risks/ordered-risk',
        '/risks/ordered-risk/llm.md',
        '/api/public/risks/ordered-risk.json',
        'bundle_ordered_risk',
        'high',
        'eligible',
        'index',
        '["fact_alpha_ordered", "fact_zulu_ordered"]'::jsonb
      )
    `,
  );
  await db.query(
    `
      insert into public_page_facts (public_page_id, fact_id, position)
      values
        ('page_ordered_risk', 'fact_zulu_ordered', 0),
        ('page_ordered_risk', 'fact_alpha_ordered', 1)
    `,
  );
  await db.query(
    `
      insert into public_evidence_bundle_evidence (evidence_bundle_id, evidence_id, position)
      values
        ('bundle_ordered_risk', 'ev_zulu_ordered', 0),
        ('bundle_ordered_risk', 'ev_alpha_ordered', 1)
    `,
  );
}

async function insertMissingEvidenceRiskPage(db: PGlite) {
  await db.query(
    `
      insert into entities (id, slug, entity_type, name, public_visibility, confidence_label)
      values (
        'entity_missing_evidence_risk',
        'missing-evidence-risk',
        'risk',
        'Missing Evidence Risk',
        'eligible',
        'high'
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
        expires_at,
        confidence_label,
        source_authority,
        public_republish_allowed,
        audit_use_allowed,
        raw_evidence_allowed
      )
      values
        (
          'fact_missing_public_evidence',
          'entity_missing_evidence_risk',
          'This fact has no matching public evidence in the bundle.',
          'risk_preview',
          'official',
          'source_public_tourism_directory',
          '2026-06-22T00:00:00.000Z',
          '2026-07-22T00:00:00.000Z',
          'high',
          4,
          true,
          true,
          false
        ),
        (
          'fact_other_public_evidence',
          'entity_missing_evidence_risk',
          'This different fact owns the bundled evidence.',
          'risk_preview',
          'official',
          'source_public_tourism_directory',
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
      insert into evidence (id, fact_id, label, allowed_use, public_republish_allowed)
      values (
        'ev_other_public_evidence',
        'fact_other_public_evidence',
        'Other public evidence',
        'public_republish',
        true
      )
    `,
  );
  await db.query(
    `
      insert into public_evidence_bundles (id, slug, evidence_ids, summary, allowed_use)
      values (
        'bundle_missing_evidence_risk',
        'risks-missing-evidence-risk',
        '["ev_other_public_evidence"]'::jsonb,
        'Missing evidence bundle.',
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
        'page_missing_evidence_risk',
        'missing-evidence-risk',
        'risks',
        'entity_missing_evidence_risk',
        'https://siargao.example/risks/missing-evidence-risk',
        '/risks/missing-evidence-risk',
        '/risks/missing-evidence-risk/llm.md',
        '/api/public/risks/missing-evidence-risk.json',
        'bundle_missing_evidence_risk',
        'high',
        'eligible',
        'index',
        '["fact_missing_public_evidence"]'::jsonb
      )
    `,
  );
  await db.query(
    `
      insert into public_page_facts (public_page_id, fact_id, position)
      values ('page_missing_evidence_risk', 'fact_missing_public_evidence', 0)
    `,
  );
  await db.query(
    `
      insert into public_evidence_bundle_evidence (evidence_bundle_id, evidence_id, position)
      values ('bundle_missing_evidence_risk', 'ev_other_public_evidence', 0)
    `,
  );
}

import type {
  AllowedUseState,
  ConfidenceLabel,
  PublicVisibilityState,
  SourceType,
} from "@/server/audit/enums";
import type { DatabaseQueryClient } from "@/server/db/query-client";
import {
  evaluatePublicPageEligibility,
  type PublicFactRecord,
  type PublicKnowledgePage,
} from "@/server/public-pages/public-content";
import {
  isPublicPageFamily,
  type PublicPageFamily,
} from "@/server/public-pages/public-surface-registry";

type PublicCatalogListOptions = {
  limit?: number;
};

export const PUBLIC_CATALOG_DEFAULT_PAGE_LIMIT = 500;
export const PUBLIC_CATALOG_MAX_PAGE_LIMIT = 1_000;
export const PUBLIC_CATALOG_FACTS_PER_PAGE_LIMIT = 100;
export const PUBLIC_CATALOG_EVIDENCE_PER_BUNDLE_LIMIT = 100;

const sourceTypes = new Set<SourceType>([
  "official",
  "partner_api",
  "licensed_api",
  "permitted_public_web",
  "user_submitted",
  "host_submitted",
  "local_verified",
]);
const confidenceLabels = new Set<ConfidenceLabel>(["low", "medium", "high"]);
const publicVisibilityStates = new Set<PublicVisibilityState>([
  "internal",
  "eligible",
  "published",
  "noindex",
  "blocked",
]);
const allowedUseStates = new Set<AllowedUseState>([
  "internal_only",
  "audit_only",
  "citation_only",
  "public_republish",
  "disallowed",
]);

export function createDatabasePublicKnowledgeCatalog(input: {
  client: DatabaseQueryClient;
  now?: Date;
}) {
  const now = input.now ?? new Date();

  return {
    async getPage(family: PublicPageFamily, slug: string) {
      const pages = await loadPublicKnowledgePages(input.client, now, {
        family,
        slug,
      });
      const page = pages[0];
      return page && evaluatePublicPageEligibility(page, null).eligible ? page : undefined;
    },
    async listPages(options?: PublicCatalogListOptions) {
      return loadPublicKnowledgePages(input.client, now, { limit: options?.limit });
    },
    async listEligiblePages(options?: PublicCatalogListOptions) {
      const pages = await loadPublicKnowledgePages(input.client, now, { limit: options?.limit });
      return pages.filter((page) => evaluatePublicPageEligibility(page, null).eligible);
    },
  };
}

type PublicCatalogRow = {
  public_page_id: string;
  slug: string;
  page_type: string;
  canonical_url: string;
  human_path: string;
  llm_markdown_path: string;
  json_api_path: string;
  last_generated_at: Date | string | null;
  last_verified_at: Date | string | null;
  page_confidence_label: string;
  public_visibility: string;
  indexing_status: string;
  stale_fields: unknown;
  generation_source_fact_ids: unknown;
  evidence_bundle_id: string | null;
  evidence_bundle_slug: string | null;
  evidence_ids: unknown;
  evidence_bundle_summary: string | null;
  evidence_bundle_allowed_use: string | null;
  evidence_bundle_created_at: Date | string | null;
  entity_id: string | null;
  entity_name: string | null;
  entity_public_visibility: string | null;
  entity_confidence_label: string | null;
  fact_id: string | null;
  claim: string | null;
  fact_type: string | null;
  fact_source_type: string | null;
  source_profile_id: string | null;
  source_record_id: string | null;
  fact_fetched_at: Date | string | null;
  fact_expires_at: Date | string | null;
  fact_confidence_label: string | null;
  fact_public_republish_allowed: boolean | null;
  fact_raw_evidence_allowed: boolean | null;
  source_name: string | null;
  source_profile_allowed_use: string | null;
  source_record_allowed_use: string | null;
  evidence_id: string | null;
  evidence_allowed_use: string | null;
  evidence_public_republish_allowed: boolean | null;
};

async function loadPublicKnowledgePages(
  client: DatabaseQueryClient,
  now: Date,
  options: { family?: PublicPageFamily; slug?: string; limit?: number } = {},
) {
  const pageLimit = options.family
    ? 1
    : normalizeCatalogLimit(
        options.limit,
        PUBLIC_CATALOG_DEFAULT_PAGE_LIMIT,
        PUBLIC_CATALOG_MAX_PAGE_LIMIT,
      );
  const result = await client.query<PublicCatalogRow>(
    `
      with selected_pages as (
        select p.*
        from public_pages p
        where ($1::text is null or p.page_type = $1)
          and ($2::text is null or p.slug = $2)
        order by p.id
        limit $3
      )
      select
        p.id as public_page_id,
        p.slug,
        p.page_type,
        p.canonical_url,
        p.human_path,
        p.llm_markdown_path,
        p.json_api_path,
        p.last_generated_at,
        p.last_verified_at,
        p.confidence_label as page_confidence_label,
        p.public_visibility,
        p.indexing_status,
        p.stale_fields,
        resolved_page_facts.generation_source_fact_ids,
        b.id as evidence_bundle_id,
        b.slug as evidence_bundle_slug,
        resolved_bundle_evidence.evidence_ids,
        b.summary as evidence_bundle_summary,
        b.allowed_use as evidence_bundle_allowed_use,
        b.created_at as evidence_bundle_created_at,
        ent.id as entity_id,
        ent.name as entity_name,
        ent.public_visibility as entity_public_visibility,
        ent.confidence_label as entity_confidence_label,
        f.id as fact_id,
        f.claim,
        f.fact_type,
        f.source_type as fact_source_type,
        f.source_profile_id,
        f.source_record_id,
        f.fetched_at as fact_fetched_at,
        f.expires_at as fact_expires_at,
        f.confidence_label as fact_confidence_label,
        f.public_republish_allowed as fact_public_republish_allowed,
        f.raw_evidence_allowed as fact_raw_evidence_allowed,
        sp.source_name,
        sp.allowed_use as source_profile_allowed_use,
        sr.allowed_use as source_record_allowed_use,
        ev.id as evidence_id,
        ev.allowed_use as evidence_allowed_use,
        ev.public_republish_allowed as evidence_public_republish_allowed
      from selected_pages p
      left join public_evidence_bundles b on b.id = p.evidence_bundle_id
      left join entities ent on ent.id = p.entity_id
      left join lateral (
        select coalesce(
          (
            select jsonb_agg(limited_page_facts.fact_id order by limited_page_facts.position, limited_page_facts.fact_id)
            from (
              select ppf.fact_id, ppf.position
              from public_page_facts ppf
              where ppf.public_page_id = p.id
              order by ppf.position, ppf.fact_id
              limit $4
            ) limited_page_facts
          ),
          (
            select jsonb_agg(limited_legacy_facts.fact_id order by limited_legacy_facts.position, limited_legacy_facts.fact_id)
            from (
              select legacy_fact.fact_id, (legacy_fact.ordinality - 1)::integer as position
              from jsonb_array_elements_text(coalesce(p.generation_source_fact_ids, '[]'::jsonb))
                with ordinality as legacy_fact(fact_id, ordinality)
              order by position, fact_id
              limit $4
            ) limited_legacy_facts
          ),
          '[]'::jsonb
        ) as generation_source_fact_ids
      ) resolved_page_facts on true
      left join lateral (
        select fact_id, position
        from (
          select ppf.fact_id, ppf.position
          from public_page_facts ppf
          where ppf.public_page_id = p.id
          union all
          select legacy_fact.fact_id, (legacy_fact.ordinality - 1)::integer as position
          from jsonb_array_elements_text(coalesce(p.generation_source_fact_ids, '[]'::jsonb))
            with ordinality as legacy_fact(fact_id, ordinality)
          where not exists (
            select 1
            from public_page_facts ppf
            where ppf.public_page_id = p.id
          )
        ) page_fact_rows
        order by position, fact_id
        limit $4
      ) page_fact on true
      left join facts f on f.id = page_fact.fact_id
      left join source_profiles sp on sp.id = f.source_profile_id
      left join source_records sr on sr.id = f.source_record_id
      left join lateral (
        select coalesce(
          (
            select jsonb_agg(limited_bundle_evidence.evidence_id order by limited_bundle_evidence.position, limited_bundle_evidence.evidence_id)
            from (
              select pbee.evidence_id, pbee.position
              from public_evidence_bundle_evidence pbee
              where pbee.evidence_bundle_id = b.id
              order by pbee.position, pbee.evidence_id
              limit $5
            ) limited_bundle_evidence
          ),
          (
            select jsonb_agg(limited_legacy_evidence.evidence_id order by limited_legacy_evidence.position, limited_legacy_evidence.evidence_id)
            from (
              select
                legacy_evidence.evidence_id,
                (legacy_evidence.ordinality - 1)::integer as position
              from jsonb_array_elements_text(coalesce(b.evidence_ids, '[]'::jsonb))
                with ordinality as legacy_evidence(evidence_id, ordinality)
              order by position, evidence_id
              limit $5
            ) limited_legacy_evidence
          ),
          '[]'::jsonb
        ) as evidence_ids
      ) resolved_bundle_evidence on true
      left join lateral (
        select
          matched_evidence.id,
          matched_evidence.allowed_use,
          matched_evidence.public_republish_allowed,
          bundle_evidence.position
        from (
          select pbee.evidence_id, pbee.position
          from public_evidence_bundle_evidence pbee
          where pbee.evidence_bundle_id = b.id
          union all
          select
            legacy_evidence.evidence_id,
            (legacy_evidence.ordinality - 1)::integer as position
          from jsonb_array_elements_text(coalesce(b.evidence_ids, '[]'::jsonb))
            with ordinality as legacy_evidence(evidence_id, ordinality)
          where not exists (
            select 1
            from public_evidence_bundle_evidence pbee
            where pbee.evidence_bundle_id = b.id
          )
        ) bundle_evidence
        join evidence matched_evidence
          on matched_evidence.id = bundle_evidence.evidence_id
         and matched_evidence.fact_id = f.id
        order by bundle_evidence.position, bundle_evidence.evidence_id
        limit $5
      ) ev on true
      order by p.id, page_fact.position, page_fact.fact_id, ev.position, ev.id
    `,
    [
      options.family ?? null,
      options.slug ?? null,
      pageLimit,
      PUBLIC_CATALOG_FACTS_PER_PAGE_LIMIT,
      PUBLIC_CATALOG_EVIDENCE_PER_BUNDLE_LIMIT,
    ],
  );

  return mapRowsToPages(result.rows, now);
}

function normalizeCatalogLimit(value: number | undefined, defaultLimit: number, maxLimit: number) {
  if (value === undefined) {
    return defaultLimit;
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1) {
    return 1;
  }
  return Math.min(value, maxLimit);
}

function mapRowsToPages(rows: readonly PublicCatalogRow[], now: Date) {
  const grouped = new Map<string, PublicCatalogRow[]>();
  for (const row of rows) {
    const group = grouped.get(row.public_page_id);
    if (group) {
      group.push(row);
    } else {
      grouped.set(row.public_page_id, [row]);
    }
  }

  return [...grouped.values()]
    .map((pageRows) => mapRowsToPage(pageRows, now))
    .filter((page) => page !== null);
}

function mapRowsToPage(rows: readonly PublicCatalogRow[], now: Date): PublicKnowledgePage | null {
  const first = rows[0];
  if (!first || !isPublicPageFamily(first.page_type)) {
    return null;
  }
  const family = first.page_type;

  const generationSourceFactIds = stringArray(first.generation_source_fact_ids);
  const evidenceIds = stringArray(first.evidence_ids);
  const evidenceIdSet = new Set(evidenceIds);
  const factsById = new Map<string, PublicFactRecord>();

  for (const row of rows) {
    if (!row.fact_id || factsById.has(row.fact_id)) {
      continue;
    }

    const sourceType = sourceTypes.has(row.fact_source_type as SourceType)
      ? (row.fact_source_type as SourceType)
      : "user_submitted";
    const confidence = confidenceLabels.has(row.fact_confidence_label as ConfidenceLabel)
      ? (row.fact_confidence_label as ConfidenceLabel)
      : "low";
    const evidenceId = row.evidence_id ?? evidenceIds[0] ?? `missing_evidence:${row.fact_id}`;
    const sourceProfileAllowsPublic = row.source_profile_allowed_use === "public_republish";
    const sourceRecordAllowsPublic =
      row.source_record_id === null || row.source_record_allowed_use === "public_republish";

    factsById.set(row.fact_id, {
      id: row.fact_id,
      claim: row.claim ?? "",
      factType: row.fact_type ?? "unknown",
      sourceProfileId: row.source_profile_id ?? "missing_source_profile",
      sourceType,
      sourceName: row.source_name ?? "Unknown source",
      evidenceId,
      fetchedAt: isoString(row.fact_fetched_at),
      confidence,
      freshness: freshness(row.fact_expires_at, now),
      publicRepublishAllowed: row.fact_public_republish_allowed === true,
      sourceProfilePublicRepublishAllowed: sourceProfileAllowsPublic,
      sourceRecordPublicRepublishAllowed: sourceRecordAllowsPublic,
      evidencePublicRepublishAllowed:
        row.evidence_allowed_use === "public_republish" &&
        row.evidence_public_republish_allowed === true,
      criticalPublicEvidence: evidenceIdSet.has(evidenceId),
      canonicalEntityMatch: entityConfidenceToMatch(row.entity_confidence_label),
    });
  }

  return {
    publicPageId: first.public_page_id,
    family,
    slug: first.slug,
    title: first.entity_name ?? titleFromSlug(first.slug),
    summary: first.evidence_bundle_summary ?? "",
    limitations: limitationsFromStaleFields(first.stale_fields),
    canonicalUrl: first.canonical_url,
    humanPath: first.human_path,
    llmMarkdownPath: first.llm_markdown_path,
    jsonApiPath: first.json_api_path,
    visibility: visibility(first.public_visibility),
    indexingStatus: first.indexing_status === "index" ? "index" : "noindex",
    updatedAt: isoString(
      first.last_verified_at ?? first.last_generated_at ?? first.evidence_bundle_created_at,
    ),
    evidenceBundle: {
      id: first.evidence_bundle_id ?? "missing_evidence_bundle",
      slug: first.evidence_bundle_slug ?? `${family}-${first.slug}`,
      evidenceIds,
      allowedUse: allowedUse(first.evidence_bundle_allowed_use),
    },
    generationSourceFactIds,
    facts: generationSourceFactIds
      .map((factId) => factsById.get(factId))
      .filter((fact) => fact !== undefined),
  };
}

function stringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return stringArray(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function isoString(value: Date | string | null) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "1970-01-01T00:00:00.000Z" : date.toISOString();
  }
  return "1970-01-01T00:00:00.000Z";
}

function freshness(value: Date | string | null, now: Date): PublicFactRecord["freshness"] {
  if (!value) {
    return "unknown";
  }
  return new Date(isoString(value)).getTime() >= now.getTime() ? "fresh" : "stale";
}

function visibility(value: string): PublicVisibilityState {
  return publicVisibilityStates.has(value as PublicVisibilityState)
    ? (value as PublicVisibilityState)
    : "blocked";
}

function allowedUse(value: string | null): AllowedUseState {
  return allowedUseStates.has(value as AllowedUseState) ? (value as AllowedUseState) : "disallowed";
}

function entityConfidenceToMatch(value: string | null): PublicFactRecord["canonicalEntityMatch"] {
  if (value === "high") {
    return "confident";
  }
  if (value === "medium") {
    return "probable";
  }
  return "ambiguous";
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function limitationsFromStaleFields(value: unknown) {
  const staleFields = stringArray(value);
  return staleFields.length > 0
    ? [`Stale fields not projected as fresh public facts: ${staleFields.join(", ")}.`]
    : [];
}

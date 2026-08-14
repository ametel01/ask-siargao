import type {
  AllowedUseState,
  ConfidenceLabel,
  PublicVisibilityState,
  SourceType,
} from "@/server/audit/enums";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import type { SourceRegistry } from "@/server/providers/source-registry";
import { buildCanonicalSiteUrl } from "@/server/public-pages/canonical-urls";
import {
  buildPublicCanonicalUrl,
  buildPublicHubPath,
  buildPublicHumanPath,
  buildPublicJsonApiPath,
  buildPublicLlmMarkdownPath,
  type PublicPageFamily,
  publicPageFamilies,
  publicSurfaceRegistry,
} from "@/server/public-pages/public-surface-registry";

export type { PublicPageFamily } from "@/server/public-pages/public-surface-registry";

export type PublicFactRecord = {
  id: string;
  claim: string;
  factType: string;
  sourceProfileId: string;
  sourceType: SourceType;
  sourceName: string;
  evidenceId: string;
  fetchedAt: string;
  confidence: ConfidenceLabel;
  freshness: "fresh" | "stale" | "unknown";
  publicRepublishAllowed: boolean;
  sourceProfilePublicRepublishAllowed?: boolean;
  sourceRecordPublicRepublishAllowed?: boolean;
  evidencePublicRepublishAllowed?: boolean;
  criticalPublicEvidence: boolean;
  containsPrivateUserData?: boolean;
  includesRawProviderPayload?: boolean;
  canonicalEntityMatch: "confident" | "probable" | "ambiguous" | "rejected";
};

export type PublicKnowledgePage = {
  publicPageId: string;
  family: PublicPageFamily;
  slug: string;
  title: string;
  summary: string;
  limitations: string[];
  canonicalUrl: string;
  humanPath: string;
  llmMarkdownPath: string;
  jsonApiPath: string;
  visibility: PublicVisibilityState;
  indexingStatus: "index" | "noindex";
  updatedAt: string;
  evidenceBundle: {
    id: string;
    slug: string;
    evidenceIds: string[];
    allowedUse: AllowedUseState;
  };
  generationSourceFactIds: string[];
  facts: PublicFactRecord[];
};

export type PublicPageRepository = {
  getPage(family: PublicPageFamily, slug: string): PublicKnowledgePage | undefined;
  listPages(): PublicKnowledgePage[];
  listEligiblePages(): PublicKnowledgePage[];
};

export type PublicEligibilityResult =
  | { eligible: true; reasons: [] }
  | { eligible: false; reasons: string[] };

const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://siargao.example").replace(/\/$/, "");
const publicEntityMatchStates = new Set(["confident", "probable"]);
const publicVisibilityStates = new Set<PublicVisibilityState>(["eligible", "published"]);

export const publicKnowledgePages: PublicKnowledgePage[] = [
  createPublicKnowledgePage({
    publicPageId: "public_page_example_surf_stay",
    evidenceBundleId: "public_bundle_example_surf_stay",
    family: "accommodations",
    slug: "example-surf-stay",
    title: "Example Surf Stay",
    summary:
      "A public accommodation profile for a General Luna stay with only republishable facts.",
    limitations: ["Room-level noise, private bookings, and paid audit details are not public."],
    facts: [
      {
        id: "public_fact_example_surf_stay_area",
        claim: "Example Surf Stay is listed as a General Luna accommodation.",
        factType: "area",
        sourceProfileId: "source_public_tourism_directory",
        sourceType: "official",
        sourceName: "Local accommodation registry",
        evidenceId: "public_ev_example_surf_stay_area",
        fetchedAt: "2026-06-23T00:00:00.000Z",
        confidence: "high",
        freshness: "fresh",
        publicRepublishAllowed: true,
        criticalPublicEvidence: true,
        canonicalEntityMatch: "confident",
      },
    ],
  }),
  createPublicKnowledgePage({
    publicPageId: "public_page_general_luna",
    evidenceBundleId: "public_bundle_general_luna",
    family: "areas",
    slug: "general-luna",
    title: "General Luna",
    summary: "A public area profile focused on trip-planning constraints and evidence freshness.",
    limitations: [
      "Neighborhood-level details can vary by block and should be refreshed before travel.",
    ],
    facts: [
      {
        id: "public_fact_general_luna_area",
        claim: "General Luna is the primary tourism base for many Siargao visitors.",
        factType: "area_profile",
        sourceProfileId: "source_public_tourism_directory",
        sourceType: "official",
        sourceName: "Municipal tourism source",
        evidenceId: "public_ev_general_luna_area",
        fetchedAt: "2026-06-23T00:00:00.000Z",
        confidence: "high",
        freshness: "fresh",
        publicRepublishAllowed: true,
        criticalPublicEvidence: true,
        canonicalEntityMatch: "confident",
      },
    ],
  }),
  createPublicKnowledgePage({
    publicPageId: "public_page_surigao_to_dapa",
    evidenceBundleId: "public_bundle_surigao_to_dapa",
    family: "routes",
    slug: "surigao-to-dapa",
    title: "Surigao to Dapa route",
    summary: "A public route profile for arrival planning and transfer risk context.",
    limitations: ["Schedule-sensitive claims must be refreshed close to departure."],
    facts: [
      {
        id: "public_fact_surigao_dapa_route",
        claim: "The Surigao to Dapa route is a common ferry arrival path to Siargao.",
        factType: "route_profile",
        sourceProfileId: "source_public_tourism_directory",
        sourceType: "official",
        sourceName: "Official transport source",
        evidenceId: "public_ev_surigao_dapa_route",
        fetchedAt: "2026-06-23T00:00:00.000Z",
        confidence: "high",
        freshness: "fresh",
        publicRepublishAllowed: true,
        criticalPublicEvidence: true,
        canonicalEntityMatch: "confident",
      },
    ],
  }),
  createPublicKnowledgePage({
    publicPageId: "public_page_licensed_van_transfer",
    evidenceBundleId: "public_bundle_licensed_van_transfer",
    family: "operators",
    slug: "licensed-van-transfer",
    title: "Licensed van transfer",
    summary: "A public operator trust profile limited to republishable accreditation signals.",
    limitations: [
      "Commercial terms, private messages, and traveler-specific bookings are excluded.",
    ],
    facts: [
      {
        id: "public_fact_operator_license",
        claim:
          "Licensed van transfer operators should expose verifiable permit or accreditation signals.",
        factType: "operator_trust",
        sourceProfileId: "source_public_tourism_directory",
        sourceType: "official",
        sourceName: "Public-sector operator guidance",
        evidenceId: "public_ev_operator_license",
        fetchedAt: "2026-06-23T00:00:00.000Z",
        confidence: "medium",
        freshness: "fresh",
        publicRepublishAllowed: true,
        criticalPublicEvidence: true,
        canonicalEntityMatch: "probable",
      },
    ],
  }),
  createPublicKnowledgePage({
    publicPageId: "public_page_late_arrival_transfer_risk",
    evidenceBundleId: "public_bundle_late_arrival_transfer_risk",
    family: "risks",
    slug: "late-arrival-transfer-risk",
    title: "Late arrival transfer risk",
    summary: "A public risk page describing why late arrivals need verified transfer backups.",
    limitations: [
      "This is not a private paid audit and does not include user-specific itinerary data.",
    ],
    facts: [
      {
        id: "public_fact_late_arrival_risk",
        claim: "Late arrivals can reduce normal transfer options and increase fallback costs.",
        factType: "risk_preview",
        sourceProfileId: "source_public_tourism_directory",
        sourceType: "official",
        sourceName: "Official transport source",
        evidenceId: "public_ev_late_arrival_risk",
        fetchedAt: "2026-06-23T00:00:00.000Z",
        confidence: "high",
        freshness: "fresh",
        publicRepublishAllowed: true,
        criticalPublicEvidence: true,
        canonicalEntityMatch: "confident",
      },
    ],
  }),
];

export function createFixturePublicPageRepository(
  pages: readonly PublicKnowledgePage[] = publicKnowledgePages,
): PublicPageRepository {
  return {
    getPage(family, slug) {
      return pages.find((page) => page.family === family && page.slug === slug);
    },
    listPages() {
      return [...pages];
    },
    listEligiblePages() {
      return pages.filter((page) => evaluatePublicPageEligibility(page).eligible);
    },
  };
}

const defaultPublicPageRepository = createFixturePublicPageRepository();

export function getPublicPage(
  family: PublicPageFamily,
  slug: string,
  repository: PublicPageRepository = defaultPublicPageRepository,
) {
  return repository.getPage(family, slug);
}

export function publicPagesForIndex(
  repository: PublicPageRepository = defaultPublicPageRepository,
) {
  return repository.listEligiblePages();
}

export function evaluatePublicPageEligibility(
  page: Pick<
    PublicKnowledgePage,
    "visibility" | "indexingStatus" | "evidenceBundle" | "generationSourceFactIds" | "facts"
  >,
  registry: SourceRegistry | null = createDefaultSourceRegistry(),
) {
  const reasons: string[] = [];

  if (!publicVisibilityStates.has(page.visibility)) {
    reasons.push("page_visibility_not_public");
  }
  if (page.indexingStatus !== "index") {
    reasons.push("page_noindex");
  }
  if (page.evidenceBundle.allowedUse !== "public_republish") {
    reasons.push("evidence_bundle_not_public_republish");
  }

  const evidenceIds = new Set(page.evidenceBundle.evidenceIds);
  const generationSourceFactIds = new Set(page.generationSourceFactIds);
  for (const fact of page.facts) {
    if (!generationSourceFactIds.has(fact.id)) {
      reasons.push(`fact:${fact.id}:not_generation_source`);
    }
    if (!evidenceIds.has(fact.evidenceId)) {
      reasons.push(`fact:${fact.id}:evidence_not_in_bundle`);
    }
  }

  const factEligibility = evaluatePublicEligibility(page, registry);
  reasons.push(...factEligibility.reasons);

  return reasons.length === 0
    ? { eligible: true as const, reasons: [] }
    : { eligible: false as const, reasons };
}

export function evaluatePublicEligibility(
  page: Pick<PublicKnowledgePage, "facts">,
  registry: SourceRegistry | null = createDefaultSourceRegistry(),
) {
  const reasons: string[] = [];

  if (!page.facts.some((fact) => fact.criticalPublicEvidence)) {
    reasons.push("critical_public_evidence_missing");
  }

  for (const fact of page.facts) {
    const decision = registry?.get(fact.sourceProfileId)
      ? registry.decide(fact.sourceProfileId)
      : null;
    const sourceProfilePublicRepublishAllowed =
      fact.sourceProfilePublicRepublishAllowed ?? decision?.publicRepublishAllowed;

    if (sourceProfilePublicRepublishAllowed === undefined) {
      reasons.push(`fact:${fact.id}:source_profile_missing`);
    }
    if (!sourceProfilePublicRepublishAllowed || !fact.publicRepublishAllowed) {
      reasons.push(`fact:${fact.id}:public_republish_not_allowed`);
    }
    if (fact.sourceRecordPublicRepublishAllowed === false) {
      reasons.push(`fact:${fact.id}:source_record_public_republish_not_allowed`);
    }
    if (fact.evidencePublicRepublishAllowed === false) {
      reasons.push(`fact:${fact.id}:evidence_public_republish_not_allowed`);
    }
    if (fact.confidence === "low") {
      reasons.push(`fact:${fact.id}:low_confidence`);
    }
    if (fact.containsPrivateUserData) {
      reasons.push(`fact:${fact.id}:private_user_data`);
    }
    if (fact.includesRawProviderPayload) {
      reasons.push(`fact:${fact.id}:raw_provider_payload`);
    }
    if (!publicEntityMatchStates.has(fact.canonicalEntityMatch)) {
      reasons.push(`fact:${fact.id}:weak_entity_match`);
    }
  }

  return reasons.length === 0
    ? { eligible: true as const, reasons: [] }
    : { eligible: false as const, reasons };
}

export function buildPublicPageJson(page: PublicKnowledgePage) {
  return {
    title: page.title,
    summary: page.summary,
    canonicalUrl: page.canonicalUrl,
    humanPath: page.humanPath,
    llmMarkdownPath: page.llmMarkdownPath,
    jsonApiPath: page.jsonApiPath,
    freshness: page.facts.map((fact) => ({
      factId: fact.id,
      fetchedAt: fact.fetchedAt,
      freshness: fact.freshness,
    })),
    confidence: page.facts.map((fact) => ({
      factId: fact.id,
      confidence: fact.confidence,
      sourceType: fact.sourceType,
      sourceProfileId: fact.sourceProfileId,
    })),
    claims: page.facts.map((fact) => ({
      factId: fact.id,
      claim: fact.claim,
      evidenceId: fact.evidenceId,
      sourceName: fact.sourceName,
      sourceType: fact.sourceType,
      sourceProfileId: fact.sourceProfileId,
    })),
    evidenceBundle: {
      slug: page.evidenceBundle.slug,
      evidenceIds: page.evidenceBundle.evidenceIds,
      allowedUse: page.evidenceBundle.allowedUse,
    },
    limitations: page.limitations,
  };
}

export function buildPublicEntityIndex(pages: readonly PublicKnowledgePage[]) {
  return {
    entities: pages.map((page) => buildPublicPageJson(page)),
  };
}

export function buildPublicEvidenceIndex(pages: readonly PublicKnowledgePage[]) {
  return {
    evidenceBundles: pages.map((page) => ({
      slug: page.evidenceBundle.slug,
      canonicalUrl: page.canonicalUrl,
      evidenceIds: page.evidenceBundle.evidenceIds,
      allowedUse: page.evidenceBundle.allowedUse,
    })),
  };
}

export function buildPublicRiskPreview(pages: readonly PublicKnowledgePage[]) {
  return {
    risks: pages.flatMap((page) => (page.family === "risks" ? [buildPublicPageJson(page)] : [])),
  };
}

export function buildPublicCatalogProjection(pages: readonly PublicKnowledgePage[]) {
  return {
    entities: buildPublicEntityIndex(pages),
    evidence: buildPublicEvidenceIndex(pages),
    riskPreview: buildPublicRiskPreview(pages),
    sitemapXml: buildSitemapXml(pages),
    llmsTxt: buildLlmsTxt(pages),
  };
}

export function buildPublicPageMarkdown(page: PublicKnowledgePage) {
  const claims = page.facts
    .map(
      (fact) =>
        `- ${fact.claim} [${fact.evidenceId}] Confidence: ${fact.confidence}. Source type: ${fact.sourceType}. Freshness: ${fact.freshness}.`,
    )
    .join("\n");
  const limitations = page.limitations.map((limitation) => `- ${limitation}`).join("\n");

  return [
    `# ${page.title}`,
    "",
    page.summary,
    "",
    `Canonical: ${page.canonicalUrl}`,
    "",
    "## Claims",
    claims,
    "",
    "## Limitations",
    limitations,
    "",
  ].join("\n");
}

export function buildPublicJsonLd(page: PublicKnowledgePage) {
  return {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.title,
    description: page.summary,
    url: page.canonicalUrl,
    dateModified: page.updatedAt,
    mainEntity: {
      "@type": "Thing",
      name: page.title,
      identifier: `${page.family}:${page.slug}`,
      subjectOf: page.facts.map((fact) => ({
        "@type": "Claim",
        text: fact.claim,
        citation: fact.evidenceId,
      })),
    },
  };
}

export function buildSitemapXml(pages: readonly PublicKnowledgePage[] = publicPagesForIndex()) {
  const entries = new Map<string, string | undefined>();
  entries.set(buildCanonicalSiteUrl("/"), undefined);

  for (const family of publicPageFamilies) {
    const surface = publicSurfaceRegistry[family];
    if (!surface.includeInSitemap) {
      continue;
    }

    const familyPages = pages.filter((page) => page.family === family);
    entries.set(buildCanonicalSiteUrl(buildPublicHubPath(family)), latestSitemapDate(familyPages));
  }

  for (const page of pages) {
    if (!publicSurfaceRegistry[page.family].includeInSitemap) {
      continue;
    }

    entries.set(
      buildCanonicalSiteUrl(buildPublicHumanPath(page.family, page.slug)),
      sitemapDate(page.updatedAt),
    );
  }

  const urls = [...entries].map(([url, lastModified]) => sitemapUrl(url, lastModified)).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

function sitemapUrl(url: string, lastModified?: string) {
  const lastModifiedXml = lastModified ? `<lastmod>${escapeXml(lastModified)}</lastmod>` : "";
  return `<url><loc>${escapeXml(url)}</loc>${lastModifiedXml}</url>`;
}

function latestSitemapDate(pages: readonly PublicKnowledgePage[]) {
  return pages
    .flatMap((page) => {
      const date = sitemapDate(page.updatedAt);
      return date ? [date] : [];
    })
    .toSorted()
    .at(-1);
}

function sitemapDate(value: string) {
  const date = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildLlmsTxt(pages: readonly PublicKnowledgePage[] = publicPagesForIndex()) {
  return [
    "# Ask Siargao public knowledge",
    "",
    "Public pages use only republishable facts with visible evidence, confidence, freshness, source type, canonical URL, and limitations.",
    "",
    "## Indexes",
    "- /api/public/entities",
    "- /api/public/evidence",
    "- /api/public/risk-preview",
    "",
    "## Pages",
    ...pages.map((page) => `- ${page.title}: ${page.canonicalUrl} (${page.llmMarkdownPath})`),
    "",
  ].join("\n");
}

export function normalizeJsonSlug(value: string) {
  return value.endsWith(".json") ? value.slice(0, -5) : value;
}

export function createPublicKnowledgePage(
  input: Omit<
    PublicKnowledgePage,
    | "evidenceBundle"
    | "canonicalUrl"
    | "humanPath"
    | "llmMarkdownPath"
    | "jsonApiPath"
    | "visibility"
    | "indexingStatus"
    | "updatedAt"
    | "generationSourceFactIds"
  > & { evidenceBundleId: string; updatedAt?: string },
): PublicKnowledgePage {
  const humanPath = buildPublicHumanPath(input.family, input.slug);
  const { evidenceBundleId, updatedAt, ...pageInput } = input;
  const page = {
    ...pageInput,
    evidenceBundle: {
      id: evidenceBundleId,
      slug: `${input.family}-${input.slug}`,
      evidenceIds: input.facts.map((fact) => fact.evidenceId),
      allowedUse: "public_republish" as const,
    },
    canonicalUrl: buildPublicCanonicalUrl(appUrl, input.family, input.slug),
    humanPath,
    llmMarkdownPath: buildPublicLlmMarkdownPath(input.family, input.slug),
    jsonApiPath: buildPublicJsonApiPath(input.family, input.slug),
    visibility: "eligible" as const,
    indexingStatus: "index" as const,
    updatedAt: updatedAt ?? "2026-06-23T00:00:00.000Z",
    generationSourceFactIds: input.facts.map((fact) => fact.id),
  };

  return evaluatePublicPageEligibility(page).eligible
    ? page
    : { ...page, visibility: "blocked" as const, indexingStatus: "noindex" as const };
}

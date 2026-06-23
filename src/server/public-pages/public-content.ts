import type { ConfidenceLabel, PublicVisibilityState, SourceType } from "@/server/audit/enums";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import type { SourceRegistry } from "@/server/providers/source-registry";

export type PublicPageFamily = "accommodations" | "areas" | "routes" | "operators" | "risks";

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
  criticalPublicEvidence: boolean;
  containsPrivateUserData?: boolean;
  includesRawProviderPayload?: boolean;
  canonicalEntityMatch: "confident" | "probable" | "ambiguous" | "rejected";
};

export type PublicKnowledgePage = {
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
  facts: PublicFactRecord[];
};

export type PublicEligibilityResult =
  | { eligible: true; reasons: [] }
  | { eligible: false; reasons: string[] };

const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://siargao.example").replace(/\/$/, "");

export const publicKnowledgePages: PublicKnowledgePage[] = [
  createPage({
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
  createPage({
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
  createPage({
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
  createPage({
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
  createPage({
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

export function getPublicPage(family: PublicPageFamily, slug: string) {
  return publicKnowledgePages.find((page) => page.family === family && page.slug === slug);
}

export function publicPagesForIndex() {
  return publicKnowledgePages.filter((page) => evaluatePublicEligibility(page).eligible);
}

export function evaluatePublicEligibility(
  page: Pick<PublicKnowledgePage, "facts">,
  registry: SourceRegistry = createDefaultSourceRegistry(),
) {
  const reasons: string[] = [];

  if (!page.facts.some((fact) => fact.criticalPublicEvidence)) {
    reasons.push("critical_public_evidence_missing");
  }

  for (const fact of page.facts) {
    const decision = registry.get(fact.sourceProfileId)
      ? registry.decide(fact.sourceProfileId)
      : undefined;

    if (!decision) {
      reasons.push(`fact:${fact.id}:source_profile_missing`);
      continue;
    }
    if (!decision.publicRepublishAllowed || !fact.publicRepublishAllowed) {
      reasons.push(`fact:${fact.id}:public_republish_not_allowed`);
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
    if (!["confident", "probable"].includes(fact.canonicalEntityMatch)) {
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
      slug: `${page.family}-${page.slug}`,
      evidenceIds: page.facts.map((fact) => fact.evidenceId),
      allowedUse: "public_republish",
    },
    limitations: page.limitations,
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

export function buildSitemapXml(pages = publicPagesForIndex()) {
  const urls = pages
    .map(
      (page) =>
        `<url><loc>${page.canonicalUrl}</loc><lastmod>${page.updatedAt.slice(0, 10)}</lastmod></url>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`;
}

export function buildLlmsTxt(pages = publicPagesForIndex()) {
  return [
    "# Siargao Portal public knowledge",
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

function createPage(
  input: Omit<
    PublicKnowledgePage,
    | "canonicalUrl"
    | "humanPath"
    | "llmMarkdownPath"
    | "jsonApiPath"
    | "visibility"
    | "indexingStatus"
    | "updatedAt"
  >,
): PublicKnowledgePage {
  const humanPath = `/${input.family}/${input.slug}`;
  const page = {
    ...input,
    canonicalUrl: `${appUrl}${humanPath}`,
    humanPath,
    llmMarkdownPath: `${humanPath}/llm.md`,
    jsonApiPath: `/api/public/${input.family}/${input.slug}.json`,
    visibility: "eligible" as const,
    indexingStatus: "index" as const,
    updatedAt: "2026-06-23T00:00:00.000Z",
  };

  return evaluatePublicEligibility(page).eligible
    ? page
    : { ...page, visibility: "blocked" as const, indexingStatus: "noindex" as const };
}

import {
  createPublicKnowledgePage,
  type PublicFactRecord,
  type PublicKnowledgePage,
} from "@/server/public-pages/public-content";

const checkedAt = "2026-08-14T00:00:00.000Z";
const sourceProfileId = "source_curated_ask_siargao_guide";
const sourceName = "Ask Siargao curated local guide";

export const productionBaselinePublicKnowledgePages: readonly PublicKnowledgePage[] = [
  baselinePage({
    family: "accommodations",
    slug: "general-luna-stays",
    title: "Staying in General Luna",
    summary:
      "A practical accommodation-area guide for travelers deciding whether to use General Luna as their Siargao base.",
    limitations: [
      "This page does not assert live room availability, prices, ratings, or property-level suitability.",
    ],
    confidence: "high",
    claim:
      "General Luna is a practical accommodation base for many first-time Siargao trips because food, nightlife, and common visitor services cluster nearby.",
  }),
  baselinePage({
    family: "areas",
    slug: "general-luna",
    title: "General Luna",
    summary:
      "A planning overview of Siargao's main visitor base and the travel tradeoffs of staying there.",
    limitations: [
      "Road conditions, journey times, closures, and neighborhood-level conditions require current local checks.",
    ],
    confidence: "high",
    claim:
      "General Luna is a common first-time visitor base on Siargao, while north-island outings require meaningful road travel.",
  }),
  baselinePage({
    family: "routes",
    slug: "surigao-city-to-dapa",
    title: "Surigao City to Dapa",
    summary: "A stable route overview for travelers reaching Siargao by ferry through Dapa Port.",
    limitations: [
      "Ferry operators, departure times, fares, weather disruption, and same-day availability must be verified close to travel.",
    ],
    confidence: "high",
    claim:
      "The Surigao City to Dapa ferry route is a common sea-arrival path to Siargao, followed by onward ground transport from Dapa.",
  }),
  baselinePage({
    family: "operators",
    slug: "siargao-transfer-operator-checks",
    title: "Choosing a Siargao transfer operator",
    summary:
      "A verification checklist for arranging airport, port, and inter-area transfers on Siargao.",
    limitations: [
      "This page does not endorse a specific operator or confirm current permits, prices, schedules, or availability.",
    ],
    confidence: "medium",
    claim:
      "Travelers should confirm pickup details, the vehicle or driver identity, a reachable contact, and a fallback before relying on a transfer operator.",
  }),
  baselinePage({
    family: "risks",
    slug: "late-arrival-transfer-risk",
    title: "Late-arrival transfer risk",
    summary:
      "Why late airport or port arrivals need a confirmed onward-transfer fallback on Siargao.",
    limitations: [
      "This is stable planning guidance, not a live statement about current transport supply or safety conditions.",
    ],
    confidence: "high",
    claim:
      "Late arrivals reduce the margin for normal onward-transfer options, so travelers should confirm a backup before departure.",
  }),
];

type BaselinePageInput = {
  family: PublicKnowledgePage["family"];
  slug: string;
  title: string;
  summary: string;
  limitations: string[];
  confidence: PublicFactRecord["confidence"];
  claim: string;
};

function baselinePage(input: BaselinePageInput) {
  const stableId = input.slug.replaceAll("-", "_");

  return createPublicKnowledgePage({
    publicPageId: `public_page_baseline_${stableId}`,
    evidenceBundleId: `public_bundle_baseline_${stableId}`,
    family: input.family,
    slug: input.slug,
    title: input.title,
    summary: input.summary,
    limitations: input.limitations,
    updatedAt: checkedAt,
    facts: [
      {
        id: `public_fact_baseline_${stableId}`,
        claim: input.claim,
        factType: `${input.family}_planning_baseline`,
        sourceProfileId,
        sourceType: "local_verified",
        sourceName,
        evidenceId: `public_ev_baseline_${stableId}`,
        fetchedAt: checkedAt,
        confidence: input.confidence,
        freshness: "fresh",
        publicRepublishAllowed: true,
        criticalPublicEvidence: true,
        canonicalEntityMatch: "confident",
      },
    ],
  });
}

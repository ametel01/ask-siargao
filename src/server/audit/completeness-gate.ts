import type { AccommodationResolution } from "@/server/audit/accommodation-resolution";
import { accommodationMatchThreshold } from "@/server/audit/accommodation-resolution";
import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import type { OptionalRiskModule, RiskLevel } from "@/server/audit/enums";
import type {
  CompletenessCheckResult,
  EvidenceReference,
  IntakeInput,
  RiskItem,
} from "@/server/audit/schemas";

export type CompletenessGateResult = CompletenessCheckResult & {
  checkoutEligible: boolean;
  activatedModules: OptionalRiskModule[];
  targetedRefreshHooks: string[];
  diagnostics: {
    accommodationResolutionStatus: AccommodationResolution["status"];
    accommodationSourceProfileId?: string;
    accommodationSourceConfidence?: AccommodationResolution["sourceConfidence"];
    blockingReasonCount: number;
    completenessPassed: boolean;
  };
};

const officialTransportEvidence: EvidenceReference = {
  evidenceId: "ev_official_transport_profile",
  label: "Official transport source profile",
  sourceName: "Official transport and public-sector sources",
  fetchedAt: "2026-06-23T00:00:00.000Z",
  confidence: "high",
  freshness: "fresh",
};

const weatherEvidence: EvidenceReference = {
  evidenceId: "ev_open_meteo_profile",
  label: "Open-Meteo weather source profile",
  sourceName: "Open-Meteo weather API",
  fetchedAt: "2026-06-23T00:00:00.000Z",
  confidence: "medium",
  freshness: "fresh",
};

export function evaluateCompleteness(
  input: IntakeInput,
  accommodation: AccommodationResolution,
): CompletenessGateResult {
  const blockingReasons: string[] = [];
  const requiredUserFollowups = [...accommodation.requiredFollowups];
  const evidenceSummary = [officialTransportEvidence, weatherEvidence];

  if (!input.travelMonth && !(input.startDate && input.endDate)) {
    blockingReasons.push("Travel dates or travel month are required.");
  }
  if (!input.arrivalOrigin && !input.arrivalRouteSlug) {
    blockingReasons.push("Arrival route or origin is required.");
  }
  if (!input.topConstraint) {
    blockingReasons.push("At least one top trip constraint is required.");
  }
  if (!accommodation.areaSlug && !input.stayAreaSlug) {
    blockingReasons.push("Stay area or resolved accommodation area is required.");
  }
  if (input.accommodationName && accommodation.score < accommodationMatchThreshold) {
    blockingReasons.push("Accommodation match confidence is below the payment threshold.");
  }
  if (
    input.stayAreaSlug &&
    !siargaoTaxonomy.areas.some((area) => area.slug === input.stayAreaSlug)
  ) {
    blockingReasons.push("Stay area is not in the Siargao taxonomy.");
  }

  const targetedRefreshHooks = [
    "refresh_weather_before_payment",
    "refresh_route_facts_before_payment",
  ];
  if (input.accommodationName) {
    targetedRefreshHooks.push("refresh_accommodation_match_before_payment");
  }

  const canComplete = blockingReasons.length === 0;
  const previewRisk = canComplete ? buildPreviewRisk(input, evidenceSummary) : undefined;

  return {
    canComplete,
    checkoutEligible: canComplete,
    blockingReasons,
    previewRisk,
    requiredUserFollowups,
    evidenceSummary,
    activatedModules: input.optionalModules,
    targetedRefreshHooks,
    diagnostics: {
      accommodationResolutionStatus: accommodation.status,
      accommodationSourceProfileId: accommodation.sourceProfileId,
      accommodationSourceConfidence: accommodation.sourceConfidence,
      blockingReasonCount: blockingReasons.length,
      completenessPassed: canComplete,
    },
  };
}

function buildPreviewRisk(input: IntakeInput, evidence: EvidenceReference[]): RiskItem {
  const riskTolerance = input.travelerContext.riskTolerance;
  const level: RiskLevel = riskTolerance === "relaxed" ? "green" : "yellow";
  const transportConcern = input.optionalModules.includes("transport_comfort")
    ? " Because transport comfort is active, avoid assuming scooter-only backups."
    : "";

  return {
    id: "preview_arrival_timing",
    category: "arrival_departure_logistics",
    level,
    title: "Arrival timing is the first thing to verify",
    whatMightBreak: `Transfers can become harder if arrival slips late in the day.${transportConcern}`,
    whyItMatters:
      riskTolerance === "low_risk"
        ? "Your low-risk tolerance means the plan needs a verified backup before checkout."
        : "A missed transfer can force a late, expensive, or uncomfortable arrival.",
    recommendedFix:
      "Confirm your final ferry, flight, or van timing before paying for the full audit.",
    impact: riskTolerance === "low_risk" ? 5 : 4,
    likelihood: 3,
    fixability: 4,
    travelerRelevance: input.optionalModules.length > 0 ? 5 : 4,
    confidence: "medium",
    evidence,
  };
}

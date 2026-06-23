import type { EvidenceReference, ReportOutput, RiskItem } from "@/server/audit/schemas";

export const sampleEvidenceReferences: EvidenceReference[] = [
  {
    evidenceId: "ev_route",
    label: "Official ferry schedule",
    sourceName: "Official transport source",
    fetchedAt: "2026-06-23T00:00:00.000Z",
    confidence: "high",
    freshness: "fresh",
  },
  {
    evidenceId: "ev_accommodation",
    label: "Accommodation area evidence",
    sourceName: "User submitted accommodation evidence",
    fetchedAt: "2026-06-23T00:00:00.000Z",
    confidence: "medium",
    freshness: "fresh",
  },
];

export const sampleRouteRisk: RiskItem = {
  id: "risk_route",
  category: "arrival_departure_logistics",
  level: "yellow",
  title: "Late route risk",
  whatMightBreak: "The ferry leg can arrive too late for normal transfers.",
  whyItMatters: "The traveler may need an expensive backup after dark.",
  recommendedFix: "Confirm the last transfer before booking non-refundable rooms.",
  impact: 4,
  likelihood: 3,
  fixability: 4,
  travelerRelevance: 5,
  confidence: "high",
  evidence: sampleEvidenceReferences,
};

export const sampleReport: ReportOutput = {
  overallRisk: "yellow",
  confidenceSummary: "Route facts are high confidence; accommodation area is medium confidence.",
  sourceQualitySummary:
    "Official transport evidence is authoritative; accommodation details are user-submitted and should be confirmed with the host.",
  topRisks: [sampleRouteRisk],
  fullRiskTable: [
    sampleRouteRisk,
    {
      ...sampleRouteRisk,
      id: "risk_area_fit",
      category: "area_fit",
      level: "green",
      title: "Area fit is likely workable",
      whatMightBreak: "Exact noise and walkability can vary by block.",
      whyItMatters: "The top constraint is quiet sleep.",
      recommendedFix: "Ask the host for the nearest landmark and night-noise context.",
      confidence: "medium",
      evidence: [sampleEvidenceReferences[1] as EvidenceReference],
    },
  ],
  accommodationAssessment: "Example Surf Stay appears to be in General Luna.",
  areaFitAssessment: "General Luna fits the stated constraint if the host confirms quiet hours.",
  logisticsNotes: "Arrival logistics need a verified transfer window before relying on the plan.",
  weatherSeasonalityNotes: "Weather should be refreshed before final travel week decisions.",
  internetPowerAssessment: "Ask the host for a recent speed test and generator details.",
  transportNotes: "Avoid assuming scooter-only backups after dark.",
  cashSimServiceNotes: "Bring cash buffer and confirm SIM access on arrival.",
  healthSafetyAdminNotes: "Know the nearest clinic route before arrival.",
  officialAccreditationNotes: "No official accreditation claim is made without evidence.",
  eventClosureFeeNotes: "No event, closure, or local-fee claim is made without evidence.",
  recommendedFixes: ["Confirm transfer window.", "Ask host for exact area and quiet-hours proof."],
  hostQuestions: [
    "Can you confirm exact area and pickup window?",
    "Can you share a current speed test and generator backup details?",
  ],
  evidence: sampleEvidenceReferences,
  evidenceFreshnessNotes: ["Route evidence is fresh.", "Accommodation evidence is user-submitted."],
  limitations: ["Exact room noise level is not verified."],
};

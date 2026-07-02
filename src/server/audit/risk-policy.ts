import type {
  ConfidenceLabel,
  OptionalRiskModule,
  RiskCategory,
  RiskLevel,
} from "@/server/audit/enums";
import { riskCategories } from "@/server/audit/enums";
import type { ReportOutput, RiskItem } from "@/server/audit/schemas";
import type { GovernedFact } from "@/server/facts/types";

export type RiskEvaluationContract = {
  id: RiskCategory | OptionalRiskModule;
  label: string;
  requiredEvidenceTypes: string[];
  evaluatorScope: "mandatory" | "optional";
};

type MandatoryRiskContract = RiskEvaluationContract & {
  id: RiskCategory;
  evaluatorScope: "mandatory";
  defaultLevel: RiskLevel;
  skeletonWhatMightBreak: string;
  skeletonRecommendedFix: string;
  skeletonImpact: number;
  skeletonLikelihood: number;
  skeletonFixability: number;
  skeletonConfidence: ConfidenceLabel;
};

export type FactFreshnessClassification = "current" | "stale_critical" | "stale_non_critical";

export const mandatoryRiskContracts = {
  arrival_departure_logistics: {
    id: "arrival_departure_logistics",
    label: "Arrival and departure logistics",
    requiredEvidenceTypes: ["route_schedule", "transfer_window"],
    evaluatorScope: "mandatory",
    defaultLevel: "yellow",
    skeletonWhatMightBreak:
      "A delayed arrival can reduce transfer options and increase fallback costs.",
    skeletonRecommendedFix:
      "Confirm route timing and backup transfer windows before relying on checkout.",
    skeletonImpact: 4,
    skeletonLikelihood: 3,
    skeletonFixability: 4,
    skeletonConfidence: "medium",
  },
  weather_seasonality: {
    id: "weather_seasonality",
    label: "Weather and seasonality",
    requiredEvidenceTypes: ["weather", "seasonality"],
    evaluatorScope: "mandatory",
    defaultLevel: "green",
    skeletonWhatMightBreak:
      "The weather and seasonality check needs current evidence before final publication.",
    skeletonRecommendedFix: "Keep the supporting fact fresh and cite it in the final report.",
    skeletonImpact: 3,
    skeletonLikelihood: 3,
    skeletonFixability: 4,
    skeletonConfidence: "medium",
  },
  area_fit: {
    id: "area_fit",
    label: "Area fit",
    requiredEvidenceTypes: ["area", "location"],
    evaluatorScope: "mandatory",
    defaultLevel: "green",
    skeletonWhatMightBreak: "The area fit check needs current evidence before final publication.",
    skeletonRecommendedFix: "Keep the supporting fact fresh and cite it in the final report.",
    skeletonImpact: 3,
    skeletonLikelihood: 3,
    skeletonFixability: 4,
    skeletonConfidence: "medium",
  },
  internet_power: {
    id: "internet_power",
    label: "Internet and power",
    requiredEvidenceTypes: ["internet_power"],
    evaluatorScope: "mandatory",
    defaultLevel: "green",
    skeletonWhatMightBreak:
      "The internet and power check needs current evidence before final publication.",
    skeletonRecommendedFix: "Keep the supporting fact fresh and cite it in the final report.",
    skeletonImpact: 3,
    skeletonLikelihood: 3,
    skeletonFixability: 4,
    skeletonConfidence: "medium",
  },
  on_island_transport: {
    id: "on_island_transport",
    label: "On-island transport",
    requiredEvidenceTypes: ["local_transport"],
    evaluatorScope: "mandatory",
    defaultLevel: "green",
    skeletonWhatMightBreak:
      "The on-island transport check needs current evidence before final publication.",
    skeletonRecommendedFix: "Keep the supporting fact fresh and cite it in the final report.",
    skeletonImpact: 3,
    skeletonLikelihood: 3,
    skeletonFixability: 4,
    skeletonConfidence: "medium",
  },
  cash_sim_basic_services: {
    id: "cash_sim_basic_services",
    label: "Cash, SIM, and basic services",
    requiredEvidenceTypes: ["service_access"],
    evaluatorScope: "mandatory",
    defaultLevel: "green",
    skeletonWhatMightBreak:
      "The cash, SIM, and basic services check needs current evidence before final publication.",
    skeletonRecommendedFix: "Keep the supporting fact fresh and cite it in the final report.",
    skeletonImpact: 3,
    skeletonLikelihood: 3,
    skeletonFixability: 4,
    skeletonConfidence: "medium",
  },
  health_safety_admin: {
    id: "health_safety_admin",
    label: "Health, safety, and admin",
    requiredEvidenceTypes: ["health_access", "policy"],
    evaluatorScope: "mandatory",
    defaultLevel: "green",
    skeletonWhatMightBreak:
      "The health, safety, and admin check needs current evidence before final publication.",
    skeletonRecommendedFix: "Keep the supporting fact fresh and cite it in the final report.",
    skeletonImpact: 3,
    skeletonLikelihood: 3,
    skeletonFixability: 4,
    skeletonConfidence: "medium",
  },
} satisfies Record<RiskCategory, MandatoryRiskContract>;

const rankingWeights = {
  impact: 3,
  likelihood: 2,
  travelerRelevance: 2,
  inverseFixability: 1,
  maxFixabilityScore: 6,
} as const;

const consequentialRiskCategories = new Set<RiskCategory>([
  "arrival_departure_logistics",
  "health_safety_admin",
]);

const criticalFactTypes = new Set(["route_schedule", "weather", "policy", "health_access"]);

export function getMandatoryRiskCategories(): readonly RiskCategory[] {
  return riskCategories;
}

export function getMandatoryRiskContract(category: RiskCategory): MandatoryRiskContract {
  return mandatoryRiskContracts[category];
}

export function missingMandatoryRiskCategories(
  risks: readonly Pick<RiskItem, "category">[],
): RiskCategory[] {
  const reportCategories = new Set(risks.map((risk) => risk.category));
  return getMandatoryRiskCategories().filter((category) => !reportCategories.has(category));
}

export function scoreRiskForRanking(
  risk: Pick<RiskItem, "impact" | "likelihood" | "fixability" | "travelerRelevance">,
) {
  return (
    risk.impact * rankingWeights.impact +
    risk.likelihood * rankingWeights.likelihood +
    risk.travelerRelevance * rankingWeights.travelerRelevance +
    (rankingWeights.maxFixabilityScore - risk.fixability) * rankingWeights.inverseFixability
  );
}

export function isLowConfidenceConsequentialRisk(risk: Pick<RiskItem, "category" | "confidence">) {
  return consequentialRiskCategories.has(risk.category) && risk.confidence === "low";
}

export function classifyFactFreshnessForReport(
  fact: Pick<GovernedFact, "factType" | "expiresAt">,
  now: Date,
): FactFreshnessClassification {
  if (!isFactStaleForReport(fact, now)) {
    return "current";
  }

  return isCriticalFactForReport(fact) ? "stale_critical" : "stale_non_critical";
}

export function reportHasStaleNonCriticalCaveat(report: Pick<ReportOutput, "limitations">) {
  return report.limitations.some((limitation) => limitation.toLowerCase().includes("stale"));
}

function isCriticalFactForReport(fact: Pick<GovernedFact, "factType">) {
  return criticalFactTypes.has(fact.factType);
}

function isFactStaleForReport(fact: Pick<GovernedFact, "expiresAt">, now: Date) {
  return Boolean(fact.expiresAt && new Date(fact.expiresAt).getTime() < now.getTime());
}

import type { OptionalRiskModule, RiskCategory } from "@/server/audit/enums";
import { riskCategories } from "@/server/audit/enums";
import type { EvidenceReference, IntakeInput, RiskItem } from "@/server/audit/schemas";

export type RiskEvaluationContract = {
  id: RiskCategory | OptionalRiskModule;
  label: string;
  requiredEvidenceTypes: string[];
  evaluatorScope: "mandatory" | "optional";
};

const mandatoryRiskContracts: Record<RiskCategory, RiskEvaluationContract> = {
  arrival_departure_logistics: {
    id: "arrival_departure_logistics",
    label: "Arrival and departure logistics",
    requiredEvidenceTypes: ["route_schedule", "transfer_window"],
    evaluatorScope: "mandatory",
  },
  weather_seasonality: {
    id: "weather_seasonality",
    label: "Weather and seasonality",
    requiredEvidenceTypes: ["weather", "seasonality"],
    evaluatorScope: "mandatory",
  },
  area_fit: {
    id: "area_fit",
    label: "Area fit",
    requiredEvidenceTypes: ["area", "location"],
    evaluatorScope: "mandatory",
  },
  internet_power: {
    id: "internet_power",
    label: "Internet and power",
    requiredEvidenceTypes: ["internet_power"],
    evaluatorScope: "mandatory",
  },
  on_island_transport: {
    id: "on_island_transport",
    label: "On-island transport",
    requiredEvidenceTypes: ["local_transport"],
    evaluatorScope: "mandatory",
  },
  cash_sim_basic_services: {
    id: "cash_sim_basic_services",
    label: "Cash, SIM, and basic services",
    requiredEvidenceTypes: ["service_access"],
    evaluatorScope: "mandatory",
  },
  health_safety_admin: {
    id: "health_safety_admin",
    label: "Health, safety, and admin",
    requiredEvidenceTypes: ["health_access", "policy"],
    evaluatorScope: "mandatory",
  },
};

export function rankRisks(risks: readonly RiskItem[]) {
  return risks.toSorted((left, right) => riskRankScore(right) - riskRankScore(left));
}

export function riskRankScore(risk: RiskItem) {
  return risk.impact * 3 + risk.likelihood * 2 + risk.travelerRelevance * 2 + (6 - risk.fixability);
}

export function buildMandatoryRiskSkeletons(
  input: IntakeInput,
  evidence: readonly EvidenceReference[],
): RiskItem[] {
  return riskCategories.map((category) => ({
    id: `risk_${category}`,
    category,
    level: category === "arrival_departure_logistics" ? "yellow" : "green",
    title: mandatoryRiskContracts[category].label,
    whatMightBreak:
      category === "arrival_departure_logistics"
        ? "A delayed arrival can reduce transfer options and increase fallback costs."
        : `The ${mandatoryRiskContracts[category].label.toLowerCase()} check needs current evidence before final publication.`,
    whyItMatters: `This matters for the stated constraint: ${input.topConstraint}.`,
    recommendedFix:
      category === "arrival_departure_logistics"
        ? "Confirm route timing and backup transfer windows before relying on checkout."
        : "Keep the supporting fact fresh and cite it in the final report.",
    impact: category === "arrival_departure_logistics" ? 4 : 3,
    likelihood: 3,
    fixability: 4,
    travelerRelevance: input.travelerContext.riskTolerance === "low_risk" ? 5 : 4,
    confidence: "medium",
    evidence: [...evidence],
  }));
}

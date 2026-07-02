import {
  getMandatoryRiskCategories,
  getMandatoryRiskContract,
  scoreRiskForRanking,
} from "@/server/audit/risk-policy";
import type { EvidenceReference, IntakeInput, RiskItem } from "@/server/audit/schemas";

export type { RiskEvaluationContract } from "@/server/audit/risk-policy";

export function rankRisks(risks: readonly RiskItem[]) {
  return risks.toSorted((left, right) => riskRankScore(right) - riskRankScore(left));
}

export function riskRankScore(risk: RiskItem) {
  return scoreRiskForRanking(risk);
}

export function buildMandatoryRiskSkeletons(
  input: IntakeInput,
  evidence: readonly EvidenceReference[],
): RiskItem[] {
  return getMandatoryRiskCategories().map((category) => {
    const policy = getMandatoryRiskContract(category);

    return {
      id: `risk_${category}`,
      category,
      level: policy.defaultLevel,
      title: policy.label,
      whatMightBreak: policy.skeletonWhatMightBreak,
      whyItMatters: `This matters for the stated constraint: ${input.topConstraint}.`,
      recommendedFix: policy.skeletonRecommendedFix,
      impact: policy.skeletonImpact,
      likelihood: policy.skeletonLikelihood,
      fixability: policy.skeletonFixability,
      travelerRelevance: input.travelerContext.riskTolerance === "low_risk" ? 5 : 4,
      confidence: policy.skeletonConfidence,
      evidence: [...evidence],
    };
  });
}

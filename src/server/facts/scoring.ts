import type { ConfidenceLabel, MatchState } from "@/server/audit/enums";
import type { GovernedFact } from "@/server/facts/types";
import type { SourceProfile } from "@/server/providers/source-registry";

export type ScoreResult = {
  score: number;
  label: ConfidenceLabel;
  drivers: string[];
};

export type FactConfidenceInput = {
  fact: GovernedFact;
  sourceCredibility: ScoreResult;
  corroboratingSources: number;
  matchStatus: MatchState;
  isFresh: boolean;
  hasConflict: boolean;
  directlyStated: boolean;
};

export function computeSourceCredibility(profile: SourceProfile): ScoreResult {
  let score = profile.authorityLevel * 15;
  const drivers = [`authority:${profile.authorityLevel}`];

  if (profile.sourceType === "official") {
    score += 15;
    drivers.push("official-source");
  }
  if (profile.allowedUse === "public_republish") {
    score += 8;
    drivers.push("public-republish-rights");
  }
  if (profile.requiresPartnerApproval) {
    score -= 10;
    drivers.push("partner-approval-required");
  }
  if (profile.knownStaleRisk === "high") {
    score -= 14;
    drivers.push("high-stale-risk");
  }
  if (profile.knownAiOrSeoContentRisk === "high") {
    score -= 12;
    drivers.push("high-ai-or-seo-risk");
  }

  return toScoreResult(score, drivers);
}

export function computeFactConfidence(input: FactConfidenceInput): ScoreResult {
  let score = input.sourceCredibility.score * 0.45;
  const drivers = [`source:${input.sourceCredibility.label}`];

  if (input.directlyStated) {
    score += 18;
    drivers.push("directly-stated");
  }
  if (input.isFresh) {
    score += 14;
    drivers.push("fresh");
  }
  if (input.corroboratingSources > 1) {
    score += Math.min(input.corroboratingSources * 6, 18);
    drivers.push(`corroborated:${input.corroboratingSources}`);
  }
  if (input.matchStatus === "confident") {
    score += 16;
    drivers.push("confident-match");
  } else if (input.matchStatus === "ambiguous") {
    score -= 20;
    drivers.push("ambiguous-match");
  } else if (input.matchStatus === "rejected") {
    score -= 40;
    drivers.push("rejected-match");
  }
  if (input.hasConflict) {
    score -= 24;
    drivers.push("conflict-detected");
  }
  if (!input.fact.auditUseAllowed) {
    score -= 30;
    drivers.push("not-audit-eligible");
  }

  return toScoreResult(score, drivers);
}

export function toSourceCredibilityScoreRecord(sourceProfileId: string, score: ScoreResult) {
  return {
    id: `source_score_${sourceProfileId}`,
    sourceProfileId,
    score: score.score,
    label: score.label,
    drivers: score.drivers,
  };
}

export function toFactConfidenceScoreRecord(factId: string, score: ScoreResult) {
  return {
    id: `fact_score_${factId}`,
    factId,
    score: score.score,
    label: score.label,
    drivers: score.drivers,
  };
}

function toScoreResult(rawScore: number, drivers: string[]): ScoreResult {
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const label: ConfidenceLabel = score >= 75 ? "high" : score >= 45 ? "medium" : "low";
  return { score, label, drivers };
}

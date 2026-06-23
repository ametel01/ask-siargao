import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import type { ConfidenceLabel, MatchState } from "@/server/audit/enums";
import type { IntakeInput } from "@/server/audit/schemas";
import {
  type GovernedAccommodationCandidate,
  buildLocalVerifiedAccommodationCandidates,
} from "@/server/providers/accommodation-ingestion";

export const accommodationMatchThreshold = 0.82;

export type AccommodationResolution = {
  status: MatchState;
  score: number;
  entityId?: string;
  accommodationName?: string;
  areaSlug?: string;
  sourceProfileId?: string;
  sourceRecordId?: string;
  sourceConfidence?: ConfidenceLabel;
  evidenceIds: string[];
  factIds: string[];
  requiredFollowups: string[];
};

export function resolveAccommodation(
  input: IntakeInput,
  candidates: readonly GovernedAccommodationCandidate[] = buildLocalVerifiedAccommodationCandidates(),
): AccommodationResolution {
  if (!input.accommodationName) {
    if (input.stayAreaSlug && knownArea(input.stayAreaSlug)) {
      return {
        status: "confident",
        score: 1,
        areaSlug: input.stayAreaSlug,
        evidenceIds: ["ev_user_no_named_accommodation"],
        factIds: [],
        requiredFollowups: [],
      };
    }

    return {
      status: "ambiguous",
      score: 0,
      evidenceIds: [],
      factIds: [],
      requiredFollowups: ["Provide either an accommodation name or a planned stay area."],
    };
  }

  const normalizedName = normalize(input.accommodationName);
  let best: { candidate: GovernedAccommodationCandidate; score: number } | undefined;
  for (const candidate of candidates) {
    if (!candidate.auditUseAllowed || candidate.confidenceLabel === "low") {
      continue;
    }

    const names = [candidate.name, ...candidate.aliases].map(normalize);
    const exact = names.some((name) => name === normalizedName);
    const partial = names.some((candidateName) =>
      isPartialNameMatch(candidateName, normalizedName),
    );
    const score = exact ? 0.96 : partial ? 0.74 : tokenOverlapScore(normalizedName, names);
    if (!best || score > best.score) {
      best = { candidate, score };
    }
  }

  if (!best || best.score < accommodationMatchThreshold) {
    return {
      status: best && best.score >= 0.55 ? "ambiguous" : "rejected",
      score: best?.score ?? 0,
      accommodationName: input.accommodationName,
      evidenceIds: [],
      factIds: [],
      requiredFollowups: [
        "Add a listing link or platform URL.",
        "Paste listing text or host-provided address details.",
        "Upload or paste host answers for Wi-Fi, access, and exact area.",
      ],
    };
  }

  return {
    status: "confident",
    score: best.score,
    entityId: best.candidate.entityId,
    accommodationName: best.candidate.name,
    areaSlug: best.candidate.areaSlug,
    sourceProfileId: best.candidate.sourceProfileId,
    sourceRecordId: best.candidate.sourceRecordId,
    sourceConfidence: best.candidate.confidenceLabel,
    evidenceIds: [...best.candidate.evidenceIds],
    factIds: [...best.candidate.factIds],
    requiredFollowups: [],
  };
}

function knownArea(slug: string) {
  return siargaoTaxonomy.areas.some((area) => area.slug === slug);
}

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .replaceAll(/\s+/g, " ");
}

function isPartialNameMatch(candidateName: string, normalizedName: string) {
  return candidateName.includes(normalizedName) || normalizedName.includes(candidateName);
}

function tokenOverlapScore(inputName: string, candidateNames: readonly string[]) {
  const inputTokens = new Set(inputName.split(" ").filter(Boolean));
  let best = 0;
  for (const candidateName of candidateNames) {
    const candidateTokens = new Set(candidateName.split(" ").filter(Boolean));
    const shared = [...inputTokens].filter((token) => candidateTokens.has(token)).length;
    best = Math.max(best, shared / Math.max(inputTokens.size, candidateTokens.size, 1));
  }
  return Number((best * 0.7).toFixed(2));
}

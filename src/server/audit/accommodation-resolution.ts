import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import type { MatchState } from "@/server/audit/enums";
import type { IntakeInput } from "@/server/audit/schemas";

export const accommodationMatchThreshold = 0.82;

export type AccommodationResolution = {
  status: MatchState;
  score: number;
  entityId?: string;
  accommodationName?: string;
  areaSlug?: string;
  sourceProfileId?: string;
  evidenceIds: string[];
  requiredFollowups: string[];
};

const localAccommodationRecords = [
  {
    entityId: "entity_example_surf_stay",
    name: "Example Surf Stay",
    aliases: ["Example Surfstay", "Example Surf House"],
    areaSlug: "general-luna",
    sourceProfileId: "source_user_submitted",
    evidenceIds: ["ev_local_example_surf_stay"],
  },
  {
    entityId: "entity_cloud_nine_guesthouse",
    name: "Cloud Nine Guesthouse",
    aliases: ["Cloud 9 Guesthouse"],
    areaSlug: "cloud-9",
    sourceProfileId: "source_user_submitted",
    evidenceIds: ["ev_local_cloud_nine_guesthouse"],
  },
] as const;

export function resolveAccommodation(input: IntakeInput): AccommodationResolution {
  if (!input.accommodationName) {
    if (input.stayAreaSlug && knownArea(input.stayAreaSlug)) {
      return {
        status: "confident",
        score: 1,
        areaSlug: input.stayAreaSlug,
        evidenceIds: ["ev_user_no_named_accommodation"],
        requiredFollowups: [],
      };
    }

    return {
      status: "ambiguous",
      score: 0,
      evidenceIds: [],
      requiredFollowups: ["Provide either an accommodation name or a planned stay area."],
    };
  }

  const normalizedName = normalize(input.accommodationName);
  const candidates = localAccommodationRecords.map((record) => {
    const names = [record.name, ...record.aliases].map(normalize);
    const exact = names.some((name) => name === normalizedName);
    const partial = names.some(
      (name) => name.includes(normalizedName) || normalizedName.includes(name),
    );
    return {
      record,
      score: exact ? 0.96 : partial ? 0.74 : tokenOverlapScore(normalizedName, names),
    };
  });
  const best = candidates.sort((left, right) => right.score - left.score)[0];

  if (!best || best.score < accommodationMatchThreshold) {
    return {
      status: best && best.score >= 0.55 ? "ambiguous" : "rejected",
      score: best?.score ?? 0,
      accommodationName: input.accommodationName,
      evidenceIds: [],
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
    entityId: best.record.entityId,
    accommodationName: best.record.name,
    areaSlug: best.record.areaSlug,
    sourceProfileId: best.record.sourceProfileId,
    evidenceIds: [...best.record.evidenceIds],
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

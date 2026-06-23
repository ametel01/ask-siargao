import {
  canUseFactInPaidAudit,
  createGovernedEvidence,
  createGovernedFact,
  normalizeSourceRecord,
} from "@/server/facts/fact-graph";
import type { GovernedEvidence, GovernedFact, NormalizedSourceRecord } from "@/server/facts/types";
import { createDefaultSourceRegistry } from "@/server/providers/adapters";
import type { SourceRegistry } from "@/server/providers/source-registry";

export type LocalVerifiedAccommodationInput = {
  entityId: string;
  name: string;
  aliases?: string[];
  areaSlug: string;
  fetchedAt: string;
  verifiedAt?: string;
  sourceUrl?: string;
  sourceProfileId?: string;
};

export type GovernedAccommodationCandidate = {
  entityId: string;
  name: string;
  aliases: string[];
  areaSlug: string;
  sourceProfileId: string;
  sourceRecordId: string;
  confidenceLabel: GovernedFact["confidenceLabel"];
  auditUseAllowed: boolean;
  evidenceIds: string[];
  factIds: string[];
};

export type AccommodationIngestionResult = {
  sourceRecord: NormalizedSourceRecord;
  facts: GovernedFact[];
  evidence: GovernedEvidence[];
  candidate: GovernedAccommodationCandidate;
};

export const localVerifiedAccommodationInputs: readonly LocalVerifiedAccommodationInput[] = [
  {
    entityId: "entity_example_surf_stay",
    name: "Example Surf Stay",
    aliases: ["Example Surfstay", "Example Surf House"],
    areaSlug: "general-luna",
    fetchedAt: "2026-06-23T00:00:00.000Z",
    sourceUrl: "https://siargao.example/public-directory/example-surf-stay",
  },
  {
    entityId: "entity_cloud_nine_guesthouse",
    name: "Cloud Nine Guesthouse",
    aliases: ["Cloud 9 Guesthouse"],
    areaSlug: "cloud-9",
    fetchedAt: "2026-06-23T00:00:00.000Z",
    sourceUrl: "https://siargao.example/public-directory/cloud-nine-guesthouse",
  },
  {
    entityId: "entity_harana_surf_resort",
    name: "Harana Surf Resort",
    aliases: ["Harana", "Harana Surf"],
    areaSlug: "general-luna",
    fetchedAt: "2026-06-23T00:00:00.000Z",
    sourceUrl: "https://siargao.example/public-directory/harana-surf-resort",
  },
];

export function ingestLocalVerifiedAccommodation(
  input: LocalVerifiedAccommodationInput,
  registry: SourceRegistry = createDefaultSourceRegistry(),
): AccommodationIngestionResult {
  const sourceProfileId = input.sourceProfileId ?? "source_public_tourism_directory";
  const sourceRecord = normalizeSourceRecord(registry, {
    id: `record_${input.entityId}`,
    sourceProfileId,
    providerEntityId: input.entityId,
    entityType: "accommodation",
    name: input.name,
    sourceUrl: input.sourceUrl,
    fetchedAt: input.fetchedAt,
    normalizedPayload: {
      aliases: input.aliases ?? [],
      areaSlug: input.areaSlug,
      name: input.name,
    },
    rawSnapshot: {
      id: `raw_${input.entityId}`,
      sourceProfileId,
      fetchedAt: input.fetchedAt,
      contentHash: `local-verified-${input.entityId}`,
      allowedUse: "public_republish",
    },
  });

  const areaFact = createGovernedFact(registry, sourceRecord, {
    id: `fact_${input.entityId}_area`,
    entityId: input.entityId,
    claim: `${input.name} is listed in ${input.areaSlug}.`,
    factType: "accommodation_area",
    fetchedAt: input.fetchedAt,
    verifiedAt: input.verifiedAt ?? input.fetchedAt,
    expiresAt: addDays(input.fetchedAt, registry.require(sourceProfileId).freshnessWindowDays),
  });
  const evidence = createGovernedEvidence(registry, areaFact, {
    id: `ev_${input.entityId}_public_directory`,
    factId: areaFact.id,
    sourceRecordId: sourceRecord.id,
    label: "Public tourism directory accommodation listing",
    citationUrl: input.sourceUrl,
    citationText: `${input.name} public directory listing`,
  });

  return {
    sourceRecord,
    facts: [areaFact],
    evidence: [evidence],
    candidate: {
      entityId: input.entityId,
      name: input.name,
      aliases: input.aliases ?? [],
      areaSlug: input.areaSlug,
      sourceProfileId,
      sourceRecordId: sourceRecord.id,
      confidenceLabel: areaFact.confidenceLabel,
      auditUseAllowed: canUseFactInPaidAudit(areaFact),
      evidenceIds: [evidence.id],
      factIds: [areaFact.id],
    },
  };
}

export function buildLocalVerifiedAccommodationCandidates(
  registry: SourceRegistry = createDefaultSourceRegistry(),
) {
  return localVerifiedAccommodationInputs.map(
    (input) => ingestLocalVerifiedAccommodation(input, registry).candidate,
  );
}

function addDays(dateTime: string, days: number) {
  const date = new Date(dateTime);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

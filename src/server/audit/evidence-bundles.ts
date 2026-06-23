import type { EvidenceReference } from "@/server/audit/schemas";
import type { GovernedEvidence, GovernedFact } from "@/server/facts/types";

export type EvidenceBundleVisibility = "private_report" | "public";

export type EvidenceBundle = {
  id: string;
  visibility: EvidenceBundleVisibility;
  evidence: EvidenceReference[];
  evidenceFactIds: Record<string, string>;
  factIds: string[];
  restrictedEvidenceIds: string[];
};

export class EvidenceBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceBundleError";
  }
}

export function createEvidenceBundle({
  evidence,
  facts,
  id,
  visibility,
}: {
  id: string;
  visibility: EvidenceBundleVisibility;
  facts: readonly GovernedFact[];
  evidence: readonly GovernedEvidence[];
}): EvidenceBundle {
  const factsById = new Set(facts.map((fact) => fact.id));
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const evidenceFactIds: Record<string, string> = {};
  const restrictedEvidenceIds: string[] = [];
  const references: EvidenceReference[] = [];

  for (const item of evidence) {
    const fact = factById.get(item.factId);

    if (!fact || !factsById.has(item.factId)) {
      throw new EvidenceBundleError(`Evidence ${item.id} references missing fact ${item.factId}.`);
    }
    if (visibility === "public" && !item.publicRepublishAllowed) {
      restrictedEvidenceIds.push(item.id);
      continue;
    }
    evidenceFactIds[item.id] = item.factId;
    references.push({
      evidenceId: item.id,
      label: item.label,
      sourceName: item.sourceRecordId,
      url: item.citationUrl,
      fetchedAt: fact.fetchedAt,
      confidence: fact.confidenceLabel,
      freshness: fact.expiresAt ? "fresh" : "unknown",
    });
  }

  return {
    id,
    visibility,
    evidence: references,
    evidenceFactIds,
    factIds: facts.map((fact) => fact.id),
    restrictedEvidenceIds,
  };
}

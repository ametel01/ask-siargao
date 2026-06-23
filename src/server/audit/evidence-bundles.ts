import type { EvidenceReference } from "@/server/audit/schemas";
import type { GovernedEvidence, GovernedFact } from "@/server/facts/types";

export type EvidenceBundleVisibility = "private_report" | "public";

export type EvidenceBundle = {
  id: string;
  visibility: EvidenceBundleVisibility;
  evidence: EvidenceReference[];
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
  const restrictedEvidenceIds: string[] = [];
  const references: EvidenceReference[] = [];

  for (const item of evidence) {
    if (!factsById.has(item.factId)) {
      throw new EvidenceBundleError(`Evidence ${item.id} references missing fact ${item.factId}.`);
    }
    if (visibility === "public" && !item.publicRepublishAllowed) {
      restrictedEvidenceIds.push(item.id);
      continue;
    }
    references.push({
      evidenceId: item.id,
      label: item.label,
      sourceName: item.sourceRecordId,
      url: item.citationUrl,
      fetchedAt:
        facts.find((fact) => fact.id === item.factId)?.fetchedAt ?? new Date(0).toISOString(),
      confidence: facts.find((fact) => fact.id === item.factId)?.confidenceLabel ?? "low",
      freshness: facts.find((fact) => fact.id === item.factId)?.expiresAt ? "fresh" : "unknown",
    });
  }

  return {
    id,
    visibility,
    evidence: references,
    factIds: facts.map((fact) => fact.id),
    restrictedEvidenceIds,
  };
}

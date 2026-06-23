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

class EvidenceBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceBundleError";
  }
}

export function createEvidenceBundle({
  evidence,
  facts,
  id,
  now = new Date(),
  visibility,
}: {
  id: string;
  now?: Date;
  visibility: EvidenceBundleVisibility;
  facts: readonly GovernedFact[];
  evidence: readonly GovernedEvidence[];
}): EvidenceBundle {
  const factById = new Map(facts.map((fact) => [fact.id, fact]));
  const evidenceFactIds: Record<string, string> = {};
  const restrictedEvidenceIds: string[] = [];
  const references: EvidenceReference[] = [];

  for (const item of evidence) {
    const fact = factById.get(item.factId);

    if (!fact) {
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
      freshness: evidenceFreshness(fact, now),
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

function evidenceFreshness(fact: GovernedFact | undefined, now: Date) {
  if (!fact?.expiresAt) {
    return "unknown" as const;
  }

  const expiresAtMs = new Date(fact.expiresAt).getTime();
  if (Number.isNaN(expiresAtMs)) {
    return "unknown" as const;
  }

  return expiresAtMs < now.getTime() ? "stale" : "fresh";
}

import type { ConfidenceLabel } from "@/server/audit/enums";
import type {
  AtomicFactInput,
  EvidenceRecordInput,
  GovernedEvidence,
  GovernedFact,
  NormalizedSourceRecord,
  NormalizedSourceRecordInput,
} from "@/server/facts/types";
import type { SourceRegistry } from "@/server/providers/source-registry";

export function normalizeSourceRecord(
  registry: SourceRegistry,
  input: NormalizedSourceRecordInput,
): NormalizedSourceRecord {
  const profile = registry.require(input.sourceProfileId);
  const decision = registry.assertCanEnterFactGraph(input.sourceProfileId);

  return {
    ...input,
    sourceType: profile.sourceType,
    allowedUse: profile.allowedUse,
    rawStorageAllowed: decision.canStoreRaw,
    rawSnapshot: decision.canStoreRaw ? input.rawSnapshot : undefined,
  };
}

export function createGovernedFact(
  registry: SourceRegistry,
  sourceRecord: NormalizedSourceRecord,
  fact: AtomicFactInput,
): GovernedFact {
  const profile = registry.require(sourceRecord.sourceProfileId);
  const decision = registry.assertCanEnterFactGraph(sourceRecord.sourceProfileId);

  return {
    ...fact,
    sourceProfileId: sourceRecord.sourceProfileId,
    sourceRecordId: sourceRecord.id,
    sourceType: profile.sourceType,
    allowedUse: profile.allowedUse,
    confidenceLabel: decision.confidenceFloor,
    sourceAuthority: profile.authorityLevel,
    publicRepublishAllowed: decision.publicRepublishAllowed,
    auditUseAllowed: decision.canUseInPaidAudit,
    rawEvidenceAllowed: decision.canStoreRaw,
  };
}

export function createGovernedEvidence(
  registry: SourceRegistry,
  fact: GovernedFact,
  evidence: EvidenceRecordInput,
): GovernedEvidence {
  const decision = registry.decide(fact.sourceProfileId);
  return {
    ...evidence,
    allowedUse: fact.allowedUse,
    publicRepublishAllowed: decision.publicRepublishAllowed && fact.publicRepublishAllowed,
  };
}

export function canUseFactInPaidAudit(fact: GovernedFact) {
  return fact.auditUseAllowed && fact.allowedUse !== "disallowed";
}

export function canPublishFactPublicly(fact: GovernedFact, confidence: ConfidenceLabel) {
  return fact.publicRepublishAllowed && confidence !== "low";
}

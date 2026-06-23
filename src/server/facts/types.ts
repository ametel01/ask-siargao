import type { AllowedUseState, ConfidenceLabel, SourceType } from "@/server/audit/enums";

export type RawSnapshotReference = {
  id: string;
  sourceProfileId: string;
  fetchedAt: string;
  contentHash: string;
  storageUri?: string;
  allowedUse: AllowedUseState;
};

export type NormalizedSourceRecordInput = {
  id: string;
  sourceProfileId: string;
  providerEntityId?: string;
  entityType: string;
  name: string;
  sourceUrl?: string;
  fetchedAt: string;
  normalizedPayload: Record<string, unknown>;
  rawSnapshot?: RawSnapshotReference;
};

export type NormalizedSourceRecord = NormalizedSourceRecordInput & {
  sourceType: SourceType;
  allowedUse: AllowedUseState;
  rawStorageAllowed: boolean;
};

export type AtomicFactInput = {
  id: string;
  entityId?: string;
  claim: string;
  factType: string;
  fetchedAt: string;
  verifiedAt?: string;
  expiresAt?: string;
  notes?: string;
};

export type EvidenceRecordInput = {
  id: string;
  factId: string;
  sourceRecordId: string;
  label: string;
  citationUrl?: string;
  citationText?: string;
};

export type GovernedFact = AtomicFactInput & {
  sourceProfileId: string;
  sourceRecordId: string;
  sourceType: SourceType;
  allowedUse: AllowedUseState;
  confidenceLabel: ConfidenceLabel;
  sourceAuthority: number;
  publicRepublishAllowed: boolean;
  auditUseAllowed: boolean;
  rawEvidenceAllowed: boolean;
};

export type GovernedEvidence = EvidenceRecordInput & {
  allowedUse: AllowedUseState;
  publicRepublishAllowed: boolean;
};

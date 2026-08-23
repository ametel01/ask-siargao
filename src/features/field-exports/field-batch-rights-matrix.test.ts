import { describe, expect, test } from "bun:test";

import { appendFieldReview, createFieldDeskWork } from "@/features/field-desk/field-desk-state";
import type { FieldDeskWork } from "@/features/field-desk/field-desk-types";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import type {
  ConsentDecision,
  EvidenceAsset,
  FieldObservation,
  FieldVisit,
  SourceStatement,
} from "@/features/field-protocol/generated";
import type { RecorderRecord, RecorderWork } from "@/features/field-recorder/field-recorder-types";
import { recorderSnapshot } from "@/features/field-recorder/test-fixtures";
import { createFieldVaultKey } from "@/features/field-security/crypto";
import { fieldTextEncoder } from "@/features/field-security/encoding";

import type { ActiveRecipientDevice, AuthenticatedRegistrySnapshot } from "./artifact-schemas";
import { createFieldBatchExport, deriveFieldBatchGraph } from "./field-batch";
import { MemoryStagedArtifactSink } from "./package-format";

const examples = baselineFieldProtocolPackage.examples.examples;
const fixedAt = "2026-08-23T02:05:00.000Z";

const rightsStates = ["research_internal", "licensed_internal", "public_use_granted"] as const;
const assetConsentStates = ["not_required", "denied", "granted", "withdrawn"] as const;
const redactionStates = ["not_required", "pending", "complete", "blocked"] as const;
const retentionStates = ["active", "pending_deletion", "deleted"] as const;
const consentDecisions = ["granted", "denied", "withdrawn"] as const;
const consentPurposes = [
  "participation",
  "llmUse",
  "articleUse",
  "quotationUse",
  "publicUse",
] as const;
const observationPermissions = ["llmUse", "articleUse", "quotationUse", "publicUse"] as const;

type MatrixRecord = Extract<
  RecorderRecord,
  { kind: "evidenceAsset" | "fieldObservation" | "sourceStatement" }
>;

describe("Field Batch rights and consent acceptance matrix", () => {
  for (const rights of rightsStates) {
    test(`applies public-export policy to asset rights=${rights}`, async () => {
      const codes = await issueCodes(
        {
          kind: "evidenceAsset",
          value: { ...exampleAsset(), rights },
        },
        "public",
      );
      expect(codes).toEqual(rights === "public_use_granted" ? [] : ["asset_rights_insufficient"]);
    });

    test(`allows asset rights=${rights} for research-internal export`, async () => {
      expect(
        await issueCodes(
          {
            kind: "evidenceAsset",
            value: { ...exampleAsset(), rights },
          },
          "research_internal",
        ),
      ).toEqual([]);
    });
  }

  for (const consentState of assetConsentStates) {
    test(`applies asset consentState=${consentState}`, async () => {
      const codes = await issueCodes({
        kind: "evidenceAsset",
        value: { ...exampleAsset(), consentState },
      });
      expect(codes).toEqual(
        consentState === "denied" || consentState === "withdrawn"
          ? ["asset_consent_insufficient"]
          : [],
      );
    });
  }

  for (const redactionState of redactionStates) {
    test(`applies asset redactionState=${redactionState}`, async () => {
      const codes = await issueCodes({
        kind: "evidenceAsset",
        value: { ...exampleAsset(), redactionState },
      });
      expect(codes).toEqual(
        redactionState === "pending" || redactionState === "blocked"
          ? ["asset_redaction_incomplete"]
          : [],
      );
    });
  }

  for (const retentionState of retentionStates) {
    test(`applies asset retentionState=${retentionState}`, async () => {
      const codes = await issueCodes({
        kind: "evidenceAsset",
        value: { ...exampleAsset(), retentionState },
      });
      expect(codes).toEqual(retentionState === "active" ? [] : ["asset_retention_inactive"]);
    });
  }

  for (const purpose of consentPurposes) {
    for (const decision of consentDecisions) {
      test(`applies Source Statement ${purpose} consent=${decision}`, async () => {
        const statement = exampleStatement();
        statement.consents[purpose] = consent(decision);
        const codes = await issueCodes({ kind: "sourceStatement", value: statement }, "public");
        const blocksParticipation = purpose === "participation" && decision !== "granted";
        const blocksPublicUse =
          (purpose === "articleUse" || purpose === "quotationUse" || purpose === "publicUse") &&
          decision !== "granted";
        expect(codes).toEqual([
          ...(blocksParticipation ? ["source_participation_consent_missing"] : []),
          ...(blocksPublicUse ? ["source_use_consent_insufficient"] : []),
        ]);
      });
    }
  }

  for (const permission of observationPermissions) {
    for (const granted of [false, true] as const) {
      test(`applies Observation ${permission} permission=${granted}`, async () => {
        const observation = exampleObservation();
        observation.permissions = {
          articleUse: true,
          llmUse: true,
          publicUse: true,
          quotationUse: true,
          [permission]: granted,
        };
        expect(
          await issueCodes({ kind: "fieldObservation", value: observation }, "public"),
        ).toEqual(granted ? [] : ["observation_permission_insufficient"]);
      });
    }
  }

  test("encrypts a runtime protected-data canary without exposing it in the public receipt", async () => {
    const sentinel = `field-private-${crypto.randomUUID()}-${Date.now()}`;
    const statement = exampleStatement();
    statement.originalStatement = sentinel;
    const graph = await deriveFieldBatchGraph({
      batchId: "0192f060-4f41-7aa1-b322-4aa9fc9f1710",
      intendedUse: "research_internal",
      selectedRecordIds: [statement.id],
      validateRecorderWork: async () => [],
      works: [await includedWork({ kind: "sourceStatement", value: statement })],
    });
    expect(JSON.stringify(graph.files).includes(sentinel)).toBe(true);

    const { recipient, registry } = await recipientRegistry();
    const sink = new MemoryStagedArtifactSink();
    const receipt = await createFieldBatchExport({
      artifactId: "0192f060-4f41-7aa1-b322-4aa9fc9f1711",
      contentKey: createFieldVaultKey(),
      createdAt: new Date("2026-08-23T02:05:00.000Z"),
      graph,
      recipientDeviceId: recipient.id,
      registry,
      sink,
      transferId: "0192f060-4f41-7aa1-b322-4aa9fc9f1712",
    });
    const stagedBytes = await collectBytes(sink.reopen());

    expect(JSON.stringify(receipt).includes(sentinel)).toBe(false);
    expect(containsBytes(stagedBytes, fieldTextEncoder.encode(sentinel))).toBe(false);
  });

  test("rejects mixed explicit selection when one record is excluded", async () => {
    const included = exampleStatement();
    const excluded = exampleObservation();
    const graph = await deriveFieldBatchGraph({
      batchId: "0192f060-4f41-7aa1-b322-4aa9fc9f1713",
      intendedUse: "research_internal",
      selectedRecordIds: [included.id, excluded.id],
      validateRecorderWork: async () => [],
      works: [
        await includedWork({ kind: "sourceStatement", value: included }),
        await excludedWork(excluded),
      ],
    });
    expect(graph.issues.map((entry) => entry.code)).toContain("effective_review_not_include");
    expect(graph.files).toEqual([]);
    expect(graph.referentialClosureSha256).toBeUndefined();
  });
});

async function issueCodes(
  record: MatrixRecord,
  intendedUse: "public" | "research_internal" = "research_internal",
): Promise<string[]> {
  const work = await includedWork(record);
  const graph = await deriveFieldBatchGraph({
    batchId: "0192f060-4f41-7aa1-b322-4aa9fc9f1701",
    intendedUse,
    selectedRecordIds: [record.value.id],
    validateRecorderWork: async () => [],
    works: [work],
  });
  return graph.issues.map((entry) => entry.code).toSorted();
}

async function includedWork(record: MatrixRecord): Promise<FieldDeskWork> {
  const base = await createFieldDeskWork({
    archiveId: "0192f060-4f41-7aa1-b322-4aa9fc9f1702",
    handedOffAt: fixedAt,
    recorderWork: recorderWork(record),
  });
  const reviewedRoot = await appendFieldReview({
    review: {
      decision: "include",
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1703",
      recordId: record.value.id,
      reviewedAt: fixedAt,
      reviewerId: "reviewer_desk",
      reviewerMatchesResearcher: false,
    },
    work: base,
  });
  const visit = alignedVisit(record);
  return appendFieldReview({
    review: {
      decision: "include",
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1706",
      recordId: visit.id,
      reviewedAt: fixedAt,
      reviewerId: "reviewer_desk",
      reviewerMatchesResearcher: false,
    },
    work: reviewedRoot,
  });
}

async function excludedWork(record: FieldObservation): Promise<FieldDeskWork> {
  const base = await createFieldDeskWork({
    archiveId: "0192f060-4f41-7aa1-b322-4aa9fc9f1714",
    handedOffAt: fixedAt,
    recorderWork: recorderWork({ kind: "fieldObservation", value: record }),
  });
  return appendFieldReview({
    review: {
      decision: "exclude",
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1715",
      recordId: record.id,
      reason: "Adversarial mixed-selection regression.",
      reviewedAt: fixedAt,
      reviewerId: "reviewer_desk",
      reviewerMatchesResearcher: false,
    },
    work: base,
  });
}

function recorderWork(record: MatrixRecord): RecorderWork {
  const snapshot = recorderSnapshot(record.value.assignmentId);
  const visit = alignedVisit(record);
  const mediaReceipts =
    record.kind === "evidenceAsset"
      ? [
          {
            assetId: record.value.id,
            byteSize: record.value.byteSize,
            mediaType: record.value.mediaType,
            opaqueMediaKey: "opaque-test-media-key",
            sha256: record.value.contentSha256,
          },
        ]
      : [];
  return {
    assignmentOutcomes: [],
    assignments: [
      {
        assignmentId: record.value.assignmentId,
        status: "complete",
        unresolvedRequirementIds: [],
        visitIds: [visit.id],
      },
    ],
    createdAt: fixedAt,
    deviceId: record.value.deviceId,
    fieldDayClose: {
      assetIssueRecordIds: [],
      assignmentOutcomeIds: [],
      campaignId: record.value.campaignId,
      closedAt: fixedAt,
      followUpAssignmentIds: [],
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1704",
      permissionIssueRecordIds: [],
      planSnapshotId: snapshot.snapshotId,
      protocolPackageId: record.value.protocolPackageId,
      protocolPackageVersion: record.value.protocolPackageVersion,
      recoveryStatus: "recovery_required",
      schemaVersion: "field-day-close.v1",
      unresolvedRecordIds: [],
    },
    followUps: [],
    id: "0192f060-4f41-7aa1-b322-4aa9fc9f1705",
    mediaReceipts,
    objectiveCoverage: [],
    objectiveCoverageRecords: [],
    planContentHash: snapshot.contentHash,
    planSnapshot: snapshot,
    protocolPackageId: record.value.protocolPackageId,
    protocolPackageVersion: record.value.protocolPackageVersion,
    records: [{ kind: "fieldVisit", value: visit }, record],
    researcherId: record.value.researcherId,
    revision: 2,
    schemaVersion: "field-recorder-work.v1",
    selectedPartialCoverageSetIds: {},
    step: { assignmentId: record.value.assignmentId, name: "outcome" },
    updatedAt: fixedAt,
  };
}

function alignedVisit(record: MatrixRecord): FieldVisit {
  const visit = structuredClone(examples.fieldVisit) as unknown as FieldVisit;
  return {
    ...visit,
    assignmentId: record.value.assignmentId,
    campaignId: record.value.campaignId,
    deviceId: record.value.deviceId,
    id: "visitId" in record.value ? record.value.visitId : visit.id,
    objectiveIds:
      "objectiveId" in record.value
        ? [record.value.objectiveId]
        : (visit.objectiveIds as [string, ...string[]]),
    protocolPackageId: record.value.protocolPackageId,
    protocolPackageVersion: record.value.protocolPackageVersion,
    researcherId: record.value.researcherId,
  };
}

function exampleAsset(): EvidenceAsset {
  return structuredClone(examples.evidenceAsset) as unknown as EvidenceAsset;
}

function exampleStatement(): SourceStatement {
  const statement = structuredClone(examples.sourceStatement) as unknown as SourceStatement;
  for (const purpose of consentPurposes) statement.consents[purpose] = consent("granted");
  return { ...statement, assetIds: [], translationIds: [] };
}

function exampleObservation(): FieldObservation {
  return structuredClone(examples.fieldObservation) as unknown as FieldObservation;
}

function consent(decision: ConsentDecision["decision"]): ConsentDecision {
  return { decision, method: "verbal", recordedAt: fixedAt };
}

async function recipientRegistry(): Promise<{
  recipient: ActiveRecipientDevice;
  registry: AuthenticatedRegistrySnapshot;
}> {
  const agreement = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveBits",
  ]);
  const signing = await crypto.subtle.generateKey(
    { hash: "SHA-256", name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const recipient: ActiveRecipientDevice = {
    agreementPublicKey: await crypto.subtle.exportKey("jwk", agreement.publicKey),
    agreementPublicKeyFingerprint: "a".repeat(64),
    id: "field_device_1234567890123456",
    role: "desk",
    signingPublicKey: await crypto.subtle.exportKey("jwk", signing.publicKey),
    signingPublicKeyFingerprint: "b".repeat(64),
  };
  return {
    recipient,
    registry: {
      accountId: "account-acceptance-matrix",
      authenticatedAt: "2026-08-23T02:00:00.000Z",
      devices: [recipient],
      expiresAt: "2026-08-23T02:10:00.000Z",
      source: "encrypted_registry_snapshot",
      version: "field-device-registry-snapshot.v1",
    },
  };
}

async function collectBytes(source: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    length += chunk.length;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function containsBytes(haystack: Uint8Array, needle: Uint8Array): boolean {
  return haystack.some((_, offset) =>
    needle.every((byte, index) => haystack[offset + index] === byte),
  );
}

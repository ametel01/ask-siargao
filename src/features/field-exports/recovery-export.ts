import { FieldSecurityError } from "@/features/field-security/errors";
import type { FieldRecoveryWrap } from "@/features/field-security/types";
import { IndexedDbFieldVault } from "@/features/field-security/vault";
import {
  type AuthenticatedRegistrySnapshot,
  FIELD_RECOVERY_CONTAINER_VERSION,
  type FieldRecoveryOuterReceipt,
  fieldRecoveryOuterReceiptSchema,
} from "./artifact-schemas";
import {
  type ArtifactRecordFile,
  DEFAULT_ARTIFACT_CHUNK_SIZE,
  packageCanonicalArtifact,
  type StagedArtifactSink,
} from "./package-format";
import { assertRecipientAuthority, sealContentKeyForRecipient } from "./recipient-envelope";

export async function createFieldRecoveryExport(input: {
  artifactId: string;
  contentKey: Uint8Array;
  createdAt: Date;
  recipientDeviceId: string;
  recoveryWrap: FieldRecoveryWrap;
  registry: AuthenticatedRegistrySnapshot;
  sink: StagedArtifactSink;
  transferId: string;
  vault?: IndexedDbFieldVault;
  vaultKey: Uint8Array;
}): Promise<FieldRecoveryOuterReceipt> {
  const vault = input.vault ?? new IndexedDbFieldVault();
  const recipient = assertRecipientAuthority({
    deviceId: input.recipientDeviceId,
    now: input.createdAt,
    registry: input.registry,
  });
  const [contentKeyEnvelope, vaultKeyEnvelope] = await Promise.all([
    sealContentKeyForRecipient({
      artifactKind: "field_recovery",
      contentKey: input.contentKey,
      recipient,
      transferId: input.transferId,
    }),
    sealContentKeyForRecipient({
      artifactKind: "field_recovery",
      contentKey: input.vaultKey,
      recipient,
      transferId: input.transferId,
    }),
  ]);
  const authorizationEnvelopeKey = requireAuthorizationEnvelopeKey(
    (await vault.getMetadata("authorization-envelope"))?.value.opaqueRecordKey,
  );
  const files: ArtifactRecordFile[] = [
    {
      path: "desk-archives.jsonl",
      recordType: "deskArchive",
      records: mapAsync(vault.iterateDeskArchives(), (value) => ({
        id: value.archiveId,
        ...value,
      })),
    },
    {
      path: "encrypted-media-chunks.jsonl",
      recordType: "encryptedMediaChunk",
      records: mapAsync(vault.iterateEncryptedMediaChunks(), (value) => ({
        id: value.chunkKey,
        ...value,
      })),
    },
    {
      path: "encrypted-media-manifests.jsonl",
      recordType: "encryptedMediaManifest",
      records: mapAsync(vault.iterateEncryptedMediaManifests(), (value) => ({
        id: value.opaqueMediaKey,
        ...value,
      })),
    },
    {
      path: "key-recovery.jsonl",
      recordType: "recoveryKeyMaterial",
      records: [
        {
          id: "recovery-wrap",
          recoveryWrap: input.recoveryWrap,
          recipientVaultKeyEnvelope: vaultKeyEnvelope,
        },
      ],
    },
    {
      path: "opaque-envelopes.jsonl",
      recordType: "opaqueEnvelope",
      records: filterMapAsync(vault.iterateEnvelopes(), (value) =>
        value.opaqueRecordKey === authorizationEnvelopeKey
          ? undefined
          : {
              id: value.opaqueRecordKey,
              ...value,
            },
      ),
    },
  ];
  const packaged = await packageCanonicalArtifact({
    authorityExclusions: [
      "device_private_keys",
      "webauthn_credentials",
      "session_authority",
      "offline_field_grants",
    ],
    contentKey: input.contentKey,
    files,
    preamble: {
      containerVersion: FIELD_RECOVERY_CONTAINER_VERSION,
      artifactKind: "field_recovery",
      artifactId: input.artifactId,
      transferId: input.transferId,
      createdAt: input.createdAt.toISOString(),
      chunkSize: DEFAULT_ARTIFACT_CHUNK_SIZE,
      contentKeyEnvelope,
    },
    sink: input.sink,
  });
  const suffix = input.artifactId.replaceAll("-", "").slice(0, 12);
  return fieldRecoveryOuterReceiptSchema.parse({
    schemaVersion: "field-recovery-outer-receipt.v1",
    artifactId: input.artifactId,
    filename: `ask-siargao-field-recovery-${suffix}.asfrecovery`,
    formatVersion: FIELD_RECOVERY_CONTAINER_VERSION,
    createdAtMinute: `${input.createdAt.toISOString().slice(0, 16)}Z`,
    encryptedBytes: packaged.encryptedBytes,
    ciphertextSha256: packaged.ciphertextSha256,
    encryption: "xchacha20-poly1305",
    keyId: input.recoveryWrap.version,
    restoreInstructionsVersion: "1.0.0",
  });
}

async function* mapAsync<T, U>(source: AsyncIterable<T>, map: (value: T) => U): AsyncIterable<U> {
  for await (const value of source) yield map(value);
}

export async function* filterMapAsync<T, U>(
  source: AsyncIterable<T>,
  map: (value: T) => U | undefined,
): AsyncIterable<U> {
  for await (const value of source) {
    const mapped = map(value);
    if (mapped !== undefined) yield mapped;
  }
}

export function requireAuthorizationEnvelopeKey(value: string | undefined): string {
  if (!value) throw new FieldSecurityError("field_artifact_invalid");
  return value;
}

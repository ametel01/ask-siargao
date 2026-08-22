import {
  canonicalStringify,
  compareCanonicalStrings,
} from "@/features/field-protocol/canonical-json";
import { encryptFieldValue } from "@/features/field-security/crypto";
import { fieldTextEncoder, sha256Hex } from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";
import type { FieldEncryptedEnvelope } from "@/features/field-security/types";
import {
  type FieldRestoreQuarantineRow,
  IndexedDbFieldVault,
} from "@/features/field-security/vault";
import {
  FIELD_RESTORE_PREVIEW_VERSION,
  type RestorePreview,
  restorePreviewSchema,
} from "./artifact-schemas";

export type RestoreImmutableItem = Readonly<{
  immutableId: string;
  contentSha256: string;
  envelope: FieldEncryptedEnvelope;
}>;

export async function createRestorePreview(input: {
  artifactId: string;
  createdAt: string;
  destination: ReadonlyMap<string, string>;
  incoming: readonly RestoreImmutableItem[];
  previewId: string;
}): Promise<RestorePreview> {
  const additions: string[] = [];
  const exactReplays: string[] = [];
  const quarantines: RestorePreview["quarantines"] = [];
  const blockers: string[] = [];
  const seen = new Map<string, string>();
  for (const item of input.incoming) {
    const duplicate = seen.get(item.immutableId);
    if (duplicate && duplicate !== item.contentSha256) {
      blockers.push(`incoming_id_conflict:${item.immutableId}`);
      continue;
    }
    seen.set(item.immutableId, item.contentSha256);
    const destinationHash = input.destination.get(item.immutableId);
    if (!destinationHash) additions.push(item.immutableId);
    else if (destinationHash === item.contentSha256) exactReplays.push(item.immutableId);
    else {
      quarantines.push({
        immutableId: item.immutableId,
        destinationSha256: destinationHash,
        incomingSha256: item.contentSha256,
      });
    }
  }
  additions.sort(compareCanonicalStrings);
  exactReplays.sort(compareCanonicalStrings);
  quarantines.sort((left, right) => compareCanonicalStrings(left.immutableId, right.immutableId));
  blockers.sort(compareCanonicalStrings);
  const destinationStateSha256 = await sha256Hex(
    fieldTextEncoder.encode(
      canonicalStringify(
        [...input.destination.entries()].toSorted(([left], [right]) =>
          compareCanonicalStrings(left, right),
        ),
      ),
    ),
  );
  const withoutHash = {
    schemaVersion: FIELD_RESTORE_PREVIEW_VERSION,
    previewId: input.previewId,
    artifactId: input.artifactId,
    createdAt: input.createdAt,
    additions,
    exactReplays,
    quarantines,
    blockers,
    destinationStateSha256,
  } as const;
  return restorePreviewSchema.parse({
    ...withoutHash,
    previewSha256: await sha256Hex(fieldTextEncoder.encode(canonicalStringify(withoutHash))),
  });
}

export async function commitConfirmedRestore(input: {
  confirmedPreviewSha256: string;
  incoming: readonly RestoreImmutableItem[];
  key: Uint8Array;
  now: string;
  preview: RestorePreview;
  vault?: IndexedDbFieldVault;
}): Promise<{ additions: number; exactReplays: number; quarantines: number }> {
  const preview = restorePreviewSchema.parse(input.preview);
  if (preview.blockers.length > 0 || preview.previewSha256 !== input.confirmedPreviewSha256) {
    throw new FieldSecurityError("field_artifact_invalid");
  }
  const byId = new Map(input.incoming.map((item) => [item.immutableId, item]));
  const additions = preview.additions.map((id) => requiredItem(byId, id).envelope);
  const quarantines: FieldRestoreQuarantineRow[] = preview.quarantines.map((entry) => ({
    quarantineId: `restore_quarantine_${crypto.randomUUID().replaceAll("-", "")}`,
    immutableId: entry.immutableId,
    destinationSha256: entry.destinationSha256,
    incomingEnvelope: requiredItem(byId, entry.immutableId).envelope,
    incomingSha256: entry.incomingSha256,
    quarantinedAt: input.now,
  }));
  const auditEnvelope = encryptFieldValue({
    applicationVersion: "0.1.0",
    key: input.key,
    value: {
      operation: "restore_committed",
      artifactId: preview.artifactId,
      previewSha256: preview.previewSha256,
      additions: additions.length,
      exactReplays: preview.exactReplays.length,
      quarantines: quarantines.length,
      occurredAt: input.now,
    },
  });
  await (input.vault ?? new IndexedDbFieldVault()).commitRestore({
    additions,
    auditEnvelope,
    quarantines,
  });
  return {
    additions: additions.length,
    exactReplays: preview.exactReplays.length,
    quarantines: quarantines.length,
  };
}

function requiredItem(
  items: ReadonlyMap<string, RestoreImmutableItem>,
  id: string,
): RestoreImmutableItem {
  const item = items.get(id);
  if (!item) throw new FieldSecurityError("field_artifact_invalid");
  return item;
}

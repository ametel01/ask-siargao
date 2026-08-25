import { decryptFieldValue, encryptFieldValue } from "@/features/field-security/crypto";
import type { FieldTransferStateRow, IndexedDbFieldVault } from "@/features/field-security/vault";
import { type FieldBatchOuterReceipt, fieldBatchOuterReceiptSchema } from "./artifact-schemas";

const transferCustodyApplicationVersion = "0.1.0";

export async function persistOutstandingTransfer(input: {
  row: FieldTransferStateRow;
  sourceReceipt?: FieldBatchOuterReceipt;
  vault: IndexedDbFieldVault;
  vaultKey: Uint8Array;
}): Promise<void> {
  if (!input.sourceReceipt) {
    await input.vault.putOutstandingTransfer(input.row);
    return;
  }

  const sourceReceipt = fieldBatchOuterReceiptSchema.parse(input.sourceReceipt);
  assertReceiptMatchesTransfer(input.row, sourceReceipt);
  const envelope = encryptFieldValue({
    applicationVersion: transferCustodyApplicationVersion,
    key: input.vaultKey,
    value: sourceReceipt,
  });
  await input.vault.putOutstandingTransfer(
    { ...input.row, sourceReceiptEnvelopeKey: envelope.opaqueRecordKey },
    envelope,
  );
}

export async function loadLatestOutstandingFieldBatchTransfer(input: {
  vault: IndexedDbFieldVault;
  vaultKey: Uint8Array;
}): Promise<
  | {
      receipt: FieldBatchOuterReceipt;
      transfer: FieldTransferStateRow;
    }
  | undefined
> {
  const transfer = (await input.vault.listTransfers())
    .filter(
      (candidate) =>
        candidate.artifactKind === "field_batch" &&
        candidate.state === "outstanding" &&
        candidate.sourceReceiptEnvelopeKey,
    )
    .toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  if (!transfer?.sourceReceiptEnvelopeKey) return undefined;

  const envelope = await input.vault.getEnvelope(transfer.sourceReceiptEnvelopeKey);
  if (!envelope) throw new Error("field_transfer_receipt_missing");
  const receipt = fieldBatchOuterReceiptSchema.parse(
    decryptFieldValue<unknown>(envelope, input.vaultKey),
  );
  assertReceiptMatchesTransfer(transfer, receipt);
  return { receipt, transfer };
}

function assertReceiptMatchesTransfer(
  transfer: FieldTransferStateRow,
  receipt: FieldBatchOuterReceipt,
): void {
  if (
    transfer.artifactKind !== "field_batch" ||
    transfer.transferId !== receipt.transferId ||
    transfer.ciphertextSha256 !== receipt.ciphertextSha256 ||
    transfer.recipientDeviceId !== receipt.recipientDeviceId
  ) {
    throw new Error("field_transfer_receipt_invalid");
  }
}

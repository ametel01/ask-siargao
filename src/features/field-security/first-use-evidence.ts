import { decryptFieldValue, encryptFieldValue } from "@/features/field-security/crypto";
import type { FieldEncryptedEnvelope } from "@/features/field-security/types";
import { type FieldReadinessEvidence, IndexedDbFieldVault } from "@/features/field-security/vault";

export const fieldResearchTimezone = "Asia/Manila";
export const offlineReloadSessionKey = "ask-siargao-field-offline-reload-challenge";

const readinessSample = {
  kind: "field-readiness-encrypted-sample",
  sentinel: "synthetic-non-protected-capture",
  version: 1,
} as const;

export function emptyFieldReadinessEvidence(): FieldReadinessEvidence {
  return {
    offlineReloadVerified: false,
    cameraScanPermissionVerified: false,
    restoreVerified: false,
    sampleCaptureVerified: false,
    timeAndTimezoneVerified: false,
  };
}

export function createEncryptedReadinessSample(input: {
  applicationVersion: string;
  vaultKey: Uint8Array;
}): FieldEncryptedEnvelope {
  return encryptFieldValue({
    applicationVersion: input.applicationVersion,
    key: input.vaultKey,
    value: readinessSample,
  });
}

export function verifyEncryptedReadinessSample(
  envelope: FieldEncryptedEnvelope,
  vaultKey: Uint8Array,
): boolean {
  try {
    const restored = decryptFieldValue<Record<string, unknown>>(envelope, vaultKey);
    return (
      restored.kind === readinessSample.kind &&
      restored.sentinel === readinessSample.sentinel &&
      restored.version === readinessSample.version &&
      Object.keys(restored).length === Object.keys(readinessSample).length
    );
  } catch {
    return false;
  }
}

export async function verifyCameraScanPermission(
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream> = (constraints) =>
    navigator.mediaDevices.getUserMedia(constraints),
): Promise<boolean> {
  let stream: MediaStream | undefined;
  try {
    stream = await getUserMedia({ audio: false, video: { facingMode: "environment" } });
    return stream.getVideoTracks().some((track) => track.readyState === "live");
  } catch {
    return false;
  } finally {
    for (const track of stream?.getTracks() ?? []) track.stop();
  }
}

export function verifyAttendedLocalTimeAndTimezone(input: {
  confirmed: boolean;
  now: Date;
  timeZone: string;
}): boolean {
  return (
    input.confirmed &&
    Number.isFinite(input.now.getTime()) &&
    input.timeZone === fieldResearchTimezone
  );
}

export function isVerifiedOfflineReload(input: {
  expectedChallenge: string | undefined;
  navigationType: string | undefined;
  online: boolean;
  sessionChallenge: string | null;
}): boolean {
  return (
    input.online === false &&
    input.navigationType === "reload" &&
    typeof input.expectedChallenge === "string" &&
    /^[0-9a-f-]{36}$/u.test(input.expectedChallenge) &&
    input.sessionChallenge === input.expectedChallenge
  );
}

type FieldOriginFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function isFieldOriginReachable(
  fetchOrigin: FieldOriginFetcher = fetch,
): Promise<boolean> {
  try {
    await fetchOrigin("/api/health/live", { cache: "no-store", credentials: "same-origin" });
    return true;
  } catch {
    return false;
  }
}

type ReadinessEvidenceVault = Pick<IndexedDbFieldVault, "getMetadata" | "putMetadata">;

export async function persistFieldReadinessEvidence(input: {
  buildId: string;
  evidence: FieldReadinessEvidence;
  now?: Date;
  offlineReloadChallenge?: string;
  vault?: ReadinessEvidenceVault;
}): Promise<FieldReadinessEvidence> {
  const vault = input.vault ?? new IndexedDbFieldVault();
  const existing = await vault.getMetadata("field-readiness-evidence");
  const evidence =
    existing?.value.buildId === input.buildId
      ? mergeVerifiedEvidence(existing.value.readinessEvidence, input.evidence)
      : input.evidence;
  await vault.putMetadata({
    key: "field-readiness-evidence",
    value: {
      buildId: input.buildId,
      ...(input.offlineReloadChallenge
        ? { offlineReloadChallenge: input.offlineReloadChallenge }
        : {}),
      readinessEvidence: evidence,
      updatedAt: (input.now ?? new Date()).toISOString(),
      version: 1,
    },
  });
  return evidence;
}

export async function consumeOfflineReloadEvidence(input: {
  buildId: string;
  navigationType: string | undefined;
  online: boolean;
  sessionStorage: Pick<Storage, "getItem" | "removeItem">;
  vault?: ReadinessEvidenceVault;
}): Promise<boolean> {
  const vault = input.vault ?? new IndexedDbFieldVault();
  const row = await vault.getMetadata("field-readiness-evidence");
  const sessionChallenge = input.sessionStorage.getItem(offlineReloadSessionKey);
  input.sessionStorage.removeItem(offlineReloadSessionKey);
  if (!row || row.value.buildId !== input.buildId) return false;

  const verified = isVerifiedOfflineReload({
    expectedChallenge: row.value.offlineReloadChallenge,
    navigationType: input.navigationType,
    online: input.online,
    sessionChallenge,
  });
  const evidence = verified
    ? { ...row.value.readinessEvidence, offlineReloadVerified: true }
    : row.value.readinessEvidence;
  await persistFieldReadinessEvidence({ buildId: input.buildId, evidence, vault });
  return verified;
}

function mergeVerifiedEvidence(
  current: FieldReadinessEvidence,
  incoming: FieldReadinessEvidence,
): FieldReadinessEvidence {
  return {
    offlineReloadVerified: current.offlineReloadVerified || incoming.offlineReloadVerified,
    cameraScanPermissionVerified:
      current.cameraScanPermissionVerified || incoming.cameraScanPermissionVerified,
    restoreVerified: current.restoreVerified || incoming.restoreVerified,
    sampleCaptureVerified: current.sampleCaptureVerified || incoming.sampleCaptureVerified,
    timeAndTimezoneVerified: current.timeAndTimezoneVerified || incoming.timeAndTimezoneVerified,
  };
}

"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useEffect, useRef, useState } from "react";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import {
  createFieldRecoverySecret,
  createFieldVaultKey,
  decryptFieldValue,
  encryptFieldValue,
  unwrapFieldVaultKey,
  unwrapFieldVaultKeyForDevice,
  wrapFieldVaultKey,
  wrapFieldVaultKeyForDevice,
} from "@/features/field-security/crypto";
import { sha256Hex, zeroize } from "@/features/field-security/encoding";
import {
  createEncryptedReadinessSample,
  emptyFieldReadinessEvidence,
  fieldResearchTimezone,
  offlineReloadSessionKey,
  persistFieldReadinessEvidence,
  verifyAttendedLocalTimeAndTimezone,
  verifyCameraScanPermission,
  verifyEncryptedReadinessSample,
} from "@/features/field-security/first-use-evidence";
import {
  completeFirstUseFieldReadiness,
  isVerifiedFieldGrantUsable,
  verifyFirstUseFieldAuthority,
} from "@/features/field-security/first-use-readiness";
import { hasCompletePreparedFieldShell } from "@/features/field-security/prepared-device";
import { prepareFieldOfflineShell } from "@/features/field-security/service-worker-client";
import type { StoredFieldAuthorization } from "@/features/field-security/unlock";
import {
  estimateFieldStorage,
  evaluateFieldReadiness,
  type FieldReadinessEvidence,
  IndexedDbFieldVault,
  requestPersistentFieldStorage,
} from "@/features/field-security/vault";
import type { DeviceBoundCredentialEvidence } from "@/features/field-security/webauthn";
import { FieldMain } from "@/features/field-workspace/FieldMain";

const applicationVersion = "0.1.0";
const applicationBuildId = process.env.NEXT_PUBLIC_FIELD_CACHE_GENERATION ?? "unconfigured";

type SetupState = {
  deviceRole: "desk" | "recorder";
  deviceAuthorized: boolean;
  grantExpiresAt?: string;
  offlineShellPrepared: boolean;
  protocolVerified: boolean;
  readinessEvidence: FieldReadinessEvidence;
  recoverySecret?: string;
  recoveryVerified: boolean;
  storage?: { availableBytes: number; persisted: boolean };
  pendingAuthorization?: {
    authorization: StoredFieldAuthorization;
    unlockCredential: DeviceBoundCredentialEvidence;
  };
};

type InFlightPromise<T> = { current: Promise<T> | null };

/** Coalesce repeated activation of a security-sensitive async operation. */
export function runFieldAuthorizationSingleFlight<T>(
  inFlight: InFlightPromise<T>,
  operation: () => Promise<T>,
): Promise<T> {
  if (inFlight.current) return inFlight.current;

  let attempt: Promise<T>;
  try {
    attempt = Promise.resolve(operation());
  } catch (error) {
    attempt = Promise.reject(error);
  }
  inFlight.current = attempt;
  void attempt.then(
    () => {
      if (inFlight.current === attempt) inFlight.current = null;
    },
    () => {
      if (inFlight.current === attempt) inFlight.current = null;
    },
  );
  return attempt;
}

async function restoreFirstUseSetup(): Promise<{
  deviceCustodyPresent: boolean;
  offlineReloadCompleted: boolean;
  state: Partial<SetupState>;
}> {
  const vault = new IndexedDbFieldVault();
  const [deviceCustodyPresent, evidenceRow, recovery, role, storage, offlineShellPrepared] =
    await Promise.all([
      vault.hasDeviceKeys().catch(() => false),
      vault.getMetadata("field-readiness-evidence").catch(() => undefined),
      vault.getMetadata("recovery-verified").catch(() => undefined),
      vault.getMetadata("device-role").catch(() => undefined),
      Promise.all([
        estimateFieldStorage(),
        navigator.storage?.persisted?.().catch(() => false) ?? Promise.resolve(false),
      ]),
      hasCompletePreparedFieldShell(applicationBuildId).catch(() => false),
    ]);
  const evidence =
    evidenceRow?.value.buildId === applicationBuildId
      ? { ...emptyFieldReadinessEvidence(), ...evidenceRow.value.readinessEvidence }
      : emptyFieldReadinessEvidence();
  const offlineReloadCompleted = evidence.offlineReloadVerified;

  let deviceAuthorized = false;
  let grantExpiresAt: string | undefined;
  let protocolVerified = false;
  let vaultKey: Uint8Array | undefined;
  try {
    const [deviceWrap, pointer] = await Promise.all([
      vault.getMetadata("device-wrap"),
      vault.getMetadata("authorization-envelope"),
    ]);
    if (deviceWrap && pointer) {
      const envelope = await vault.getEnvelope(pointer.value.opaqueRecordKey);
      if (envelope) {
        vaultKey = await unwrapFieldVaultKeyForDevice({
          agreementPrivateKey: await vault.getDeviceKey("agreement-private"),
          wrap: deviceWrap.value,
        });
        const authorization = decryptFieldValue<StoredFieldAuthorization>(envelope, vaultKey);
        if (authorization.version !== 1) throw new Error("field_authorization_invalid");
        const claims = await verifyFirstUseFieldAuthority({
          applicationBuildId,
          applicationVersion,
          deviceId: authorization.device.id,
          devicePublicKeyFingerprint: authorization.device.signingPublicKeyFingerprint,
          grantResponse: authorization.grantResponse,
        });
        deviceAuthorized = isVerifiedFieldGrantUsable(claims.expiresAt);
        grantExpiresAt = claims.expiresAt;
        protocolVerified = true;
      }
    }
  } catch {
    // Existing custody remains fail-closed and available through the normal unlock/recovery path.
  } finally {
    if (vaultKey) zeroize(vaultKey);
  }

  return {
    deviceCustodyPresent,
    offlineReloadCompleted,
    state: {
      deviceAuthorized,
      deviceRole: role?.value.role ?? "recorder",
      grantExpiresAt,
      offlineShellPrepared,
      protocolVerified,
      readinessEvidence: evidence,
      recoveryVerified: Boolean(recovery),
      storage: { availableBytes: storage[0].availableBytes, persisted: storage[1] },
    },
  };
}

export function FieldSecurityWorkspace() {
  const [state, setState] = useState<SetupState>({
    deviceRole: "recorder",
    deviceAuthorized: false,
    offlineShellPrepared: false,
    protocolVerified: false,
    readinessEvidence: emptyFieldReadinessEvidence(),
    recoveryVerified: false,
  });
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("Locked. No Protected Field Data is available.");
  const [authorizationInFlight, setAuthorizationInFlight] = useState(false);
  const [deviceCustodyPresent, setDeviceCustodyPresent] = useState(false);
  const [localClock, setLocalClock] = useState<{ displayedAt: string; timeZone: string }>();
  const authorizationPromise = useRef<Promise<void> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const now = new Date();
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setLocalClock({ displayedAt: now.toLocaleString("en-PH", { timeZone }), timeZone });
    void restoreFirstUseSetup()
      .then((restored) => {
        if (cancelled) return;
        setDeviceCustodyPresent(restored.deviceCustodyPresent);
        setState((current) => ({ ...current, ...restored.state }));
        if (restored.offlineReloadCompleted) {
          setStatus("Offline hard reload verified. Complete any remaining evidence below.");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDeviceCustodyPresent(false);
          setStatus(
            "Stored preparation evidence could not be verified. Field Readiness is blocked.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const readiness = evaluateFieldReadiness({
    availableBytes: state.storage?.availableBytes ?? 0,
    grantUsable: state.deviceAuthorized && isVerifiedFieldGrantUsable(state.grantExpiresAt),
    offlineShellPrepared: state.offlineShellPrepared,
    persisted: state.storage?.persisted ?? false,
    protocolVerified: state.protocolVerified,
    readinessEvidence: state.readinessEvidence,
    recoveryVerified: state.recoveryVerified,
  });

  async function authorizeDevice() {
    if (authorizationPromise.current) return authorizationPromise.current;
    setAuthorizationInFlight(true);
    const attempt = runFieldAuthorizationSingleFlight(authorizationPromise, async () => {
      setStatus("Waiting for verified device-bound WebAuthn registration…");
      try {
        const vault = new IndexedDbFieldVault();
        if (await vault.hasDeviceKeys()) {
          setStatus(
            "Existing encrypted device custody is preserved. Unlock or recover this device before reauthorization.",
          );
          return;
        }
        const keyAlgorithm = { name: "ECDSA", namedCurve: "P-256" } as const;
        const signingKeys = await crypto.subtle.generateKey(keyAlgorithm, false, [
          "sign",
          "verify",
        ]);
        const agreementKeys = await crypto.subtle.generateKey(
          { name: "ECDH", namedCurve: "P-256" },
          false,
          ["deriveBits"],
        );
        const [signingPublicKey, agreementPublicKey] = await Promise.all([
          crypto.subtle.exportKey("jwk", signingKeys.publicKey),
          crypto.subtle.exportKey("jwk", agreementKeys.publicKey),
        ]);
        const challengeResponse = await fetch("/api/operator/field/devices/challenge", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        if (!challengeResponse.ok) throw new Error("challenge_failed");
        const challenge = (await challengeResponse.json()) as {
          options: Parameters<typeof startRegistration>[0]["optionsJSON"];
        };
        const registrationResponse = await startRegistration({ optionsJSON: challenge.options });
        const canonical = (key: JsonWebKey) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(key)
                .filter(([name]) => ["crv", "kty", "x", "y"].includes(name))
                .sort(),
            ),
          );
        const response = await fetch("/api/operator/field/devices", {
          body: JSON.stringify({
            agreementPublicKey,
            agreementPublicKeyFingerprint: await sha256Hex(
              new TextEncoder().encode(canonical(agreementPublicKey)),
            ),
            applicationVersion,
            registrationResponse,
            role: state.deviceRole,
            signingPublicKey,
            signingPublicKeyFingerprint: await sha256Hex(
              new TextEncoder().encode(canonical(signingPublicKey)),
            ),
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (!response.ok) throw new Error("registration_failed");
        const registered = (await response.json()) as {
          device: {
            id: string;
            signingPublicKey: JsonWebKey;
            signingPublicKeyFingerprint: string;
            unlockCredential: DeviceBoundCredentialEvidence;
          };
        };
        const grantResponse = await fetch("/api/operator/field/grants", {
          body: JSON.stringify({
            applicationBuildId,
            applicationVersion,
            deviceId: registered.device.id,
            protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
            protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (!grantResponse.ok) throw new Error("grant_failed");
        const grantResponseBody: unknown = await grantResponse.json();
        const verifiedGrant = await verifyFirstUseFieldAuthority({
          applicationBuildId,
          applicationVersion,
          deviceId: registered.device.id,
          devicePublicKeyFingerprint: registered.device.signingPublicKeyFingerprint,
          grantResponse: grantResponseBody,
        });
        await vault.putDeviceKeys({
          agreementPrivateKey: agreementKeys.privateKey,
          signingPrivateKey: signingKeys.privateKey,
        });
        await vault.putMetadata({
          key: "device-id",
          value: { deviceId: registered.device.id, version: 1 },
        });
        setState((current) => ({
          ...current,
          grantExpiresAt: verifiedGrant.expiresAt,
          pendingAuthorization: {
            authorization: {
              device: {
                id: registered.device.id,
                signingPublicKey: registered.device.signingPublicKey,
                signingPublicKeyFingerprint: registered.device.signingPublicKeyFingerprint,
              },
              grantResponse: grantResponseBody,
              version: 1,
            },
            unlockCredential: registered.device.unlockCredential,
          },
          protocolVerified: true,
        }));
        setStatus(
          "Authorized Field Device and Offline Field Grant created. Establish recovery next.",
        );
      } catch {
        setStatus("Device authorization failed closed. No offline grant was created.");
      }
    });
    try {
      await attempt;
    } finally {
      setAuthorizationInFlight(false);
    }
  }

  async function renewDeviceGrant() {
    if (authorizationPromise.current) return authorizationPromise.current;
    setAuthorizationInFlight(true);
    const attempt = runFieldAuthorizationSingleFlight(authorizationPromise, async () => {
      let vaultKey: Uint8Array | undefined;
      try {
        setStatus("Requesting a fresh verified Offline Field Grant…");
        const vault = new IndexedDbFieldVault();
        const deviceWrap = await vault.getMetadata("device-wrap");
        const pointer = await vault.getMetadata("authorization-envelope");
        if (!deviceWrap || !pointer) throw new Error("field_key_unavailable");
        const envelope = await vault.getEnvelope(pointer.value.opaqueRecordKey);
        if (!envelope) throw new Error("field_key_unavailable");
        vaultKey = await unwrapFieldVaultKeyForDevice({
          agreementPrivateKey: await vault.getDeviceKey("agreement-private"),
          wrap: deviceWrap.value,
        });
        const authorization = decryptFieldValue<StoredFieldAuthorization>(envelope, vaultKey);
        const deviceId =
          (await vault.getMetadata("device-id"))?.value.deviceId ?? authorization.device.id;
        if (authorization.device.id !== deviceId) throw new Error("field_device_not_authorized");
        const grantResponse = await fetch("/api/operator/field/grants", {
          body: JSON.stringify({
            applicationBuildId,
            applicationVersion,
            deviceId,
            protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
            protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
          }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (!grantResponse.ok) throw new Error("grant_renewal_failed");
        const grantResponseBody: unknown = await grantResponse.json();
        const verifiedGrant = await verifyFirstUseFieldAuthority({
          applicationBuildId,
          applicationVersion,
          deviceId,
          devicePublicKeyFingerprint: authorization.device.signingPublicKeyFingerprint,
          grantResponse: grantResponseBody,
        });
        const renewedEnvelope = encryptFieldValue({
          applicationVersion,
          key: vaultKey,
          opaqueRecordKey: envelope.opaqueRecordKey,
          value: { ...authorization, grantResponse: grantResponseBody },
        });
        await vault.putEnvelopeBatch([renewedEnvelope]);
        setState((current) => ({
          ...current,
          deviceAuthorized: true,
          grantExpiresAt: verifiedGrant.expiresAt,
          protocolVerified: true,
        }));
        setStatus("Offline Field Grant renewed. Existing encrypted custody was preserved.");
      } catch {
        setStatus("Grant renewal failed closed. Existing encrypted custody was preserved.");
      } finally {
        vaultKey?.fill(0);
      }
    });
    try {
      await attempt;
    } finally {
      setAuthorizationInFlight(false);
    }
  }

  async function establishRecovery() {
    setStatus("Deriving the recovery wrapping key…");
    if (!state.pendingAuthorization) {
      setStatus("Authorize this device and issue its Offline Field Grant first.");
      return;
    }
    const vaultKey = createFieldVaultKey();
    const recoverySecret = createFieldRecoverySecret();
    try {
      const wrap = await wrapFieldVaultKey({ secret: recoverySecret, vaultKey });
      const vault = new IndexedDbFieldVault();
      const deviceWrap = await wrapFieldVaultKeyForDevice({
        agreementPrivateKey: await vault.getDeviceKey("agreement-private"),
        vaultKey,
      });
      const authorizationEnvelope = encryptFieldValue({
        applicationVersion,
        key: vaultKey,
        value: state.pendingAuthorization.authorization,
      });
      const readinessSample = createEncryptedReadinessSample({ applicationVersion, vaultKey });
      await vault.putEnvelopeBatch([authorizationEnvelope, readinessSample]);
      const persistedSample = await vault.getEnvelope(readinessSample.opaqueRecordKey);
      if (!persistedSample || !verifyEncryptedReadinessSample(persistedSample, vaultKey)) {
        throw new Error("field_readiness_sample_write_failed");
      }
      await vault.putMetadata({ key: "recovery-wrap", value: wrap });
      await vault.putMetadata({ key: "device-wrap", value: deviceWrap });
      await vault.putMetadata({
        key: "device-role",
        value: { role: state.deviceRole, version: 1 },
      });
      await vault.putMetadata({
        key: "unlock-credential",
        value: state.pendingAuthorization.unlockCredential,
      });
      await vault.putMetadata({
        key: "authorization-envelope",
        value: { opaqueRecordKey: authorizationEnvelope.opaqueRecordKey, version: 1 },
      });
      await vault.putMetadata({
        key: "field-readiness-sample",
        value: { opaqueRecordKey: readinessSample.opaqueRecordKey, version: 1 },
      });
      setState((current) => ({ ...current, recoverySecret }));
      setStatus("Copy the Field Recovery Secret outside this device, then re-enter it below.");
    } catch {
      setStatus("Recovery setup failed closed. Field Readiness remains blocked.");
    } finally {
      vaultKey.fill(0);
    }
  }

  async function verifyRecovery() {
    const vault = new IndexedDbFieldVault();
    const [wrap, samplePointer] = await Promise.all([
      vault.getMetadata("recovery-wrap"),
      vault.getMetadata("field-readiness-sample"),
    ]);
    if (!wrap || !samplePointer) {
      setStatus("Recovery exercise unavailable. Start again.");
      return;
    }
    let restoredVaultKey: Uint8Array | undefined;
    try {
      restoredVaultKey = await unwrapFieldVaultKey(wrap.value, confirmation);
      const sample = await vault.getEnvelope(samplePointer.value.opaqueRecordKey);
      if (!sample || !verifyEncryptedReadinessSample(sample, restoredVaultKey)) {
        throw new Error("field_readiness_sample_restore_failed");
      }
      const evidence = await persistFieldReadinessEvidence({
        buildId: applicationBuildId,
        evidence: {
          ...state.readinessEvidence,
          restoreVerified: true,
          sampleCaptureVerified: true,
        },
        vault,
      });
      await vault.putMetadata({
        key: "recovery-verified",
        value: { at: new Date().toISOString(), version: 1 },
      });
      setConfirmation("");
      setState((current) => ({
        ...current,
        recoverySecret: undefined,
        recoveryVerified: true,
        readinessEvidence: evidence,
        pendingAuthorization: undefined,
        deviceAuthorized: true,
      }));
      setStatus("Recovery secret restored the encrypted sample. Ask Siargao keeps no bypass copy.");
    } catch {
      setStatus("Recovery verification failed. Field Readiness remains blocked.");
    } finally {
      if (restoredVaultKey) zeroize(restoredVaultKey);
    }
  }

  async function prepareOffline() {
    try {
      const [storage] = await Promise.all([
        requestPersistentFieldStorage(),
        prepareFieldOfflineShell({ activeVisit: false, buildId: applicationBuildId }),
      ]);
      setState((current) => ({ ...current, offlineShellPrepared: true, storage }));
      setStatus(
        "Offline shell prepared. Complete the attended evidence checks before finalizing readiness.",
      );
    } catch {
      setStatus("Offline preparation failed. Field Readiness is blocked.");
    }
  }

  async function verifyCameraPermission() {
    try {
      setStatus("Requesting camera access for capture and document scanning…");
      if (!(await verifyCameraScanPermission())) {
        setStatus(
          "Camera/scan permission was denied or unavailable. Field Readiness remains blocked.",
        );
        return;
      }
      const evidence = await persistFieldReadinessEvidence({
        buildId: applicationBuildId,
        evidence: { ...state.readinessEvidence, cameraScanPermissionVerified: true },
      });
      setState((current) => ({ ...current, readinessEvidence: evidence }));
      setStatus("Camera/scan access verified and the test camera stream was closed.");
    } catch {
      setStatus("Camera/scan evidence could not be saved. Field Readiness remains blocked.");
    }
  }

  async function verifyLocalTime() {
    try {
      const now = new Date();
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!verifyAttendedLocalTimeAndTimezone({ confirmed: true, now, timeZone })) {
        setStatus(
          `Time verification failed. Set this device to ${fieldResearchTimezone} and compare it with a trusted clock.`,
        );
        return;
      }
      const evidence = await persistFieldReadinessEvidence({
        buildId: applicationBuildId,
        evidence: { ...state.readinessEvidence, timeAndTimezoneVerified: true },
      });
      setState((current) => ({ ...current, readinessEvidence: evidence }));
      setStatus(`Local time and ${fieldResearchTimezone} were confirmed by the researcher.`);
    } catch {
      setStatus("Time evidence could not be saved. Field Readiness remains blocked.");
    }
  }

  async function beginOfflineReloadVerification() {
    if (!state.offlineShellPrepared) {
      setStatus("Prepare the offline shell before testing an offline hard reload.");
      return;
    }
    if (navigator.onLine) {
      setStatus("Turn off Wi-Fi and mobile data, then start the offline reload check again.");
      return;
    }
    try {
      const challenge = crypto.randomUUID();
      await persistFieldReadinessEvidence({
        buildId: applicationBuildId,
        evidence: state.readinessEvidence,
        offlineReloadChallenge: challenge,
      });
      sessionStorage.setItem(offlineReloadSessionKey, challenge);
      window.location.reload();
    } catch {
      setStatus("Offline reload evidence could not be armed. Field Readiness remains blocked.");
    }
  }

  async function finalizeReadiness() {
    try {
      const [storage, offlineShellPrepared] = await Promise.all([
        requestPersistentFieldStorage(),
        hasCompletePreparedFieldShell(applicationBuildId),
      ]);
      const verifiedReadiness = completeFirstUseFieldReadiness({
        availableBytes: storage.availableBytes,
        buildId: applicationBuildId,
        grantUsable: state.deviceAuthorized && isVerifiedFieldGrantUsable(state.grantExpiresAt),
        offlineShellPrepared,
        persisted: storage.persisted,
        preparedAt: new Date().toISOString(),
        protocolVerified: state.protocolVerified,
        readinessEvidence: state.readinessEvidence,
        recoveryVerified: state.recoveryVerified,
      });
      setState((current) => ({ ...current, offlineShellPrepared, storage }));
      if (!verifiedReadiness.ready) {
        setStatus(`Field Readiness blocked. Missing: ${verifiedReadiness.reasons.join(", ")}.`);
        return;
      }
      await new IndexedDbFieldVault().putMetadata(verifiedReadiness.metadata);
      setStatus(
        "First-use Field Readiness evidence is complete on this device. External physical-device and Product Owner acceptance remain separate.",
      );
    } catch {
      setStatus("Field Readiness finalization failed closed.");
    }
  }

  return (
    <FieldMain className="mx-auto min-h-screen max-w-3xl bg-stone-50 px-6 py-12 text-stone-950">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-800">
        Field Workspace · Security boundary
      </p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Prepare this field device</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-stone-700">
        Protected Field Data stays encrypted on this device. Authorization expiry locks evidence; it
        never erases it. Recovery depends on the secret you hold—there is no administrative bypass.
      </p>

      <div className="mt-8 rounded-2xl border border-stone-300 bg-white p-5" role="status">
        <p className="font-medium">{readiness.ready ? "Field Ready" : "Field Readiness blocked"}</p>
        <p className="mt-1 text-sm text-stone-600">{status}</p>
        {!readiness.ready && (
          <p className="mt-2 text-xs text-amber-800">Missing: {readiness.reasons.join(", ")}</p>
        )}
      </div>

      <ol className="mt-8 space-y-5">
        <SetupStep number="1" title="Authorize this device">
          <p>
            Requires fresh identity verification and a user-verified, non-backup-eligible
            credential.
          </p>
          <label className="mt-3 block text-sm font-semibold" htmlFor="field-device-role">
            Device workspace
          </label>
          <select
            className="mt-1 min-h-11 w-full rounded-lg border border-stone-400 bg-white px-3 text-sm"
            disabled={state.deviceAuthorized || Boolean(state.pendingAuthorization)}
            id="field-device-role"
            onChange={(event) =>
              setState((current) => ({
                ...current,
                deviceRole: event.target.value === "desk" ? "desk" : "recorder",
              }))
            }
            value={state.deviceRole}
          >
            <option value="recorder">Recorder — plan and capture</option>
            <option value="desk">Desk — review and protected exports</option>
          </select>
          <button
            className="mt-3 rounded-lg bg-stone-950 px-4 py-2 text-sm text-white"
            disabled={
              authorizationInFlight || state.deviceAuthorized || Boolean(state.pendingAuthorization)
            }
            onClick={authorizeDevice}
            type="button"
          >
            {authorizationInFlight ? "Verifying…" : "Verify and authorize"}
          </button>
          {deviceCustodyPresent ? (
            <button
              className="mt-3 ml-2 rounded-lg border border-stone-400 px-4 py-2 text-sm"
              disabled={authorizationInFlight}
              onClick={() => void renewDeviceGrant()}
              type="button"
            >
              Renew existing grant
            </button>
          ) : null}
        </SetupStep>
        <SetupStep number="2" title="Establish recovery">
          <p>
            Losing this secret and every Authorized Field Device makes encrypted evidence
            unrecoverable.
          </p>
          {!state.recoverySecret ? (
            <button
              className="mt-3 rounded-lg border border-stone-400 px-4 py-2 text-sm"
              onClick={establishRecovery}
              type="button"
            >
              Create recovery secret
            </button>
          ) : (
            <div className="mt-3 space-y-3">
              <output className="block break-all rounded-lg bg-amber-50 p-3 font-mono text-sm">
                {state.recoverySecret}
              </output>
              <label className="block text-sm" htmlFor="recovery-confirmation">
                Re-enter the complete secret
              </label>
              <input
                className="w-full rounded-lg border border-stone-400 px-3 py-2 font-mono text-sm"
                id="recovery-confirmation"
                onChange={(event) => setConfirmation(event.target.value)}
                value={confirmation}
              />
              <button
                className="rounded-lg bg-stone-950 px-4 py-2 text-sm text-white"
                onClick={verifyRecovery}
                type="button"
              >
                Verify recovery exercise
              </button>
            </div>
          )}
        </SetupStep>
        <SetupStep number="3" title="Prepare offline operation">
          <p>
            Installs the generic offline shell and requests persistent storage. Browser eviction can
            still occur.
          </p>
          <button
            className="mt-3 rounded-lg border border-stone-400 px-4 py-2 text-sm"
            onClick={prepareOffline}
            type="button"
          >
            Prepare offline shell
          </button>
        </SetupStep>
        <SetupStep number="4" title="Complete first-use acceptance evidence">
          <p>
            Each check below performs or records the attended action on this device. These proofs
            are not inferred from authorization, storage, or a prepared shell.
          </p>
          <ul className="mt-3 space-y-1" aria-label="First-use evidence status">
            <EvidenceStatus
              complete={state.readinessEvidence.cameraScanPermissionVerified}
              label="Camera and document scanner permission exercised"
            />
            <EvidenceStatus
              complete={state.readinessEvidence.timeAndTimezoneVerified}
              label="Local time and Asia/Manila timezone confirmed"
            />
            <EvidenceStatus
              complete={state.readinessEvidence.sampleCaptureVerified}
              label="Synthetic sample encrypted and persisted"
            />
            <EvidenceStatus
              complete={state.readinessEvidence.restoreVerified}
              label="Recovery secret restored and decrypted the sample"
            />
            <EvidenceStatus
              complete={state.readinessEvidence.offlineReloadVerified}
              label="Hard reload completed with the network disabled"
            />
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className="rounded-lg border border-stone-400 px-4 py-2 text-sm"
              onClick={() => void verifyCameraPermission()}
              type="button"
            >
              Check camera / scanner
            </button>
            <button
              className="rounded-lg border border-stone-400 px-4 py-2 text-sm"
              disabled={!localClock}
              onClick={() => void verifyLocalTime()}
              type="button"
            >
              Confirm displayed time
            </button>
          </div>
          <p className="mt-3 font-mono text-xs text-stone-600">
            Device clock:{" "}
            {localClock ? `${localClock.displayedAt} · ${localClock.timeZone}` : "Reading…"}
          </p>
          <p className="mt-3">
            After preparing the shell, turn off Wi-Fi and mobile data. The next action records a
            one-time challenge and reloads this page; it passes only when the browser reports a real
            offline reload.
          </p>
          <button
            className="mt-3 rounded-lg border border-stone-400 px-4 py-2 text-sm"
            onClick={() => void beginOfflineReloadVerification()}
            type="button"
          >
            Reload and verify offline
          </button>
          <button
            className="mt-3 ml-2 rounded-lg bg-stone-950 px-4 py-2 text-sm text-white"
            onClick={() => void finalizeReadiness()}
            type="button"
          >
            Finalize Field Readiness
          </button>
        </SetupStep>
      </ol>
    </FieldMain>
  );
}

function EvidenceStatus(props: { complete: boolean; label: string }) {
  return (
    <li>
      <span className="font-semibold">{props.complete ? "Verified" : "Required"}:</span>{" "}
      {props.label}
    </li>
  );
}

function SetupStep(props: { children: React.ReactNode; number: string; title: string }) {
  return (
    <li className="rounded-2xl border border-stone-300 bg-white p-5">
      <p className="text-sm font-semibold">
        {props.number}. {props.title}
      </p>
      <div className="mt-2 text-sm leading-6 text-stone-700">{props.children}</div>
    </li>
  );
}

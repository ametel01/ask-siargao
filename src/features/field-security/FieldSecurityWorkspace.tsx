"use client";

import { startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import {
  createFieldRecoverySecret,
  createFieldVaultKey,
  encryptFieldValue,
  verifyFieldRecoveryExercise,
  wrapFieldVaultKey,
  wrapFieldVaultKeyForDevice,
} from "@/features/field-security/crypto";
import { sha256Hex } from "@/features/field-security/encoding";
import { prepareFieldOfflineShell } from "@/features/field-security/service-worker-client";
import type { StoredFieldAuthorization } from "@/features/field-security/unlock";
import {
  evaluateFieldReadiness,
  IndexedDbFieldVault,
  requestPersistentFieldStorage,
} from "@/features/field-security/vault";
import type { DeviceBoundCredentialEvidence } from "@/features/field-security/webauthn";

const applicationVersion = "0.1.0";
const applicationBuildId = process.env.NEXT_PUBLIC_FIELD_CACHE_GENERATION ?? "unconfigured";

type SetupState = {
  deviceAuthorized: boolean;
  offlineShellPrepared: boolean;
  recoverySecret?: string;
  recoveryVerified: boolean;
  storage?: { availableBytes: number; persisted: boolean };
  vaultKey?: Uint8Array;
  pendingAuthorization?: {
    authorization: StoredFieldAuthorization;
    unlockCredential: DeviceBoundCredentialEvidence;
  };
};

export function FieldSecurityWorkspace() {
  const [state, setState] = useState<SetupState>({
    deviceAuthorized: false,
    offlineShellPrepared: false,
    recoveryVerified: false,
  });
  const [confirmation, setConfirmation] = useState("");
  const [status, setStatus] = useState("Locked. No Protected Field Data is available.");
  const readiness = evaluateFieldReadiness({
    availableBytes: state.storage?.availableBytes ?? 0,
    grantUsable: state.deviceAuthorized,
    offlineShellPrepared: state.offlineShellPrepared,
    persisted: state.storage?.persisted ?? false,
    protocolVerified: true,
    recoveryVerified: state.recoveryVerified,
  });

  async function authorizeDevice() {
    setStatus("Waiting for verified device-bound WebAuthn registration…");
    try {
      const keyAlgorithm = { name: "ECDSA", namedCurve: "P-256" } as const;
      const signingKeys = await crypto.subtle.generateKey(keyAlgorithm, false, ["sign", "verify"]);
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
          role: "recorder",
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
      await new IndexedDbFieldVault().putDeviceKeys({
        agreementPrivateKey: agreementKeys.privateKey,
        signingPrivateKey: signingKeys.privateKey,
      });
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
      setState((current) => ({
        ...current,
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
      }));
      setStatus(
        "Authorized Field Device and Offline Field Grant created. Establish recovery next.",
      );
    } catch {
      setStatus("Device authorization failed closed. No offline grant was created.");
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
      await vault.putEnvelopeBatch([authorizationEnvelope]);
      await vault.putMetadata({ key: "recovery-wrap", value: wrap });
      await vault.putMetadata({ key: "device-wrap", value: deviceWrap });
      await vault.putMetadata({
        key: "unlock-credential",
        value: state.pendingAuthorization.unlockCredential,
      });
      await vault.putMetadata({
        key: "authorization-envelope",
        value: { opaqueRecordKey: authorizationEnvelope.opaqueRecordKey, version: 1 },
      });
      setState((current) => ({ ...current, recoverySecret, vaultKey: new Uint8Array(vaultKey) }));
      setStatus("Copy the Field Recovery Secret outside this device, then re-enter it below.");
    } finally {
      vaultKey.fill(0);
    }
  }

  async function verifyRecovery() {
    const vault = new IndexedDbFieldVault();
    const wrap = await vault.getMetadata("recovery-wrap");
    if (!wrap || !state.vaultKey) return setStatus("Recovery exercise unavailable. Start again.");
    const expectedVaultKey = state.vaultKey;
    const verified = await verifyFieldRecoveryExercise({
      expectedVaultKey,
      secretConfirmation: confirmation,
      wrap: wrap.value,
    });
    expectedVaultKey.fill(0);
    if (!verified)
      return setStatus("Recovery verification failed. Field Readiness remains blocked.");
    await vault.putMetadata({
      key: "recovery-verified",
      value: { at: new Date().toISOString(), version: 1 },
    });
    setConfirmation("");
    setState((current) => ({
      ...current,
      recoverySecret: undefined,
      recoveryVerified: true,
      vaultKey: undefined,
      pendingAuthorization: undefined,
      deviceAuthorized: true,
    }));
    setStatus("Field Recovery Secret verified. Ask Siargao keeps no bypass copy.");
  }

  async function prepareOffline() {
    try {
      const [storage] = await Promise.all([
        requestPersistentFieldStorage(),
        prepareFieldOfflineShell({ activeVisit: false, buildId: applicationBuildId }),
      ]);
      setState((current) => ({ ...current, offlineShellPrepared: true, storage }));
      setStatus(
        storage.persisted
          ? "Offline shell prepared and persistent storage requested. Eviction is still possible."
          : "Offline shell prepared, but persistent storage was denied. Field Readiness is blocked.",
      );
    } catch {
      setStatus("Offline preparation failed. Field Readiness is blocked.");
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-stone-50 px-6 py-12 text-stone-950">
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
          <button
            className="mt-3 rounded-lg bg-stone-950 px-4 py-2 text-sm text-white"
            onClick={authorizeDevice}
            type="button"
          >
            Verify and authorize
          </button>
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
      </ol>
    </main>
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

"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { encodeBase64Url, zeroize } from "@/features/field-security/encoding";
import { fieldSecurityErrorCode } from "@/features/field-security/errors";
import { useFieldSecuritySession } from "@/features/field-security/FieldSecuritySessionProvider";
import {
  discoverPreparedFieldDevice,
  type PreparedFieldDeviceDiscovery,
} from "@/features/field-security/prepared-device";
import { createOfflineUnlockRequest, unlockFieldVault } from "@/features/field-security/unlock";

const applicationVersion = "0.1.0";
const applicationBuildId = process.env.NEXT_PUBLIC_FIELD_CACHE_GENERATION ?? "unconfigured";

export function OfflineFieldUnlock(props: { children?: ReactNode }) {
  const security = useFieldSecuritySession();
  const [message, setMessage] = useState(
    "Offline shell loaded. Vault key material is unavailable.",
  );
  const [preparedDevice, setPreparedDevice] = useState<PreparedFieldDeviceDiscovery>();
  const unlocked = security.status === "unlocked";

  useEffect(() => {
    let mounted = true;
    discoverPreparedFieldDevice()
      .then((result) => {
        if (!mounted) return;
        setPreparedDevice(result);
        if (!result.prepared) {
          setMessage("This device is not fully prepared. Reconnect and complete Field Readiness.");
        }
      })
      .catch(() => {
        if (mounted)
          setMessage("Device preparation could not be verified. Unlock remains blocked.");
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (security.state.status !== "locked") return;
    if (security.state.reason === "inactivity") {
      setMessage("Locked after inactivity. Verify locally again to continue.");
    } else if (security.state.reason === "grant") {
      setMessage(
        "Offline Field Grant expired. Encrypted evidence remains available for reauthorization.",
      );
    } else if (security.state.reason === "clock") {
      setMessage("Device clock safety check failed. Reconnect before unlocking fieldwork.");
    }
  }, [security.state]);

  async function unlock() {
    setMessage("Waiting for local user verification…");
    try {
      if (!preparedDevice?.prepared) throw new Error("field_key_unavailable");
      const request = await createOfflineUnlockRequest();
      const response = await startAuthentication({
        optionsJSON: {
          allowCredentials: [{ id: request.credential.credentialId, type: "public-key" }],
          challenge: encodeBase64Url(request.challenge),
          rpId: window.location.hostname,
          timeout: 60_000,
          userVerification: "required",
        },
      });
      const result = await unlockFieldVault({
        applicationBuildId,
        applicationVersion,
        assertion: {
          authenticatorData: response.response.authenticatorData,
          clientDataJson: response.response.clientDataJSON,
          credentialId: response.id,
          signature: response.response.signature,
        },
        challenge: request.challenge,
        expectedOrigin: window.location.origin,
        now: new Date(),
        rpId: window.location.hostname,
      });
      try {
        security.unlockWithKey({ claims: result.claims, key: result.vaultKey });
      } finally {
        zeroize(result.vaultKey);
      }
      setMessage("Protected fieldwork unlocked on this Authorized Field Device.");
    } catch (error) {
      security.lock("manual");
      setMessage(
        `Unlock denied (${fieldSecurityErrorCode(error)}). Encrypted evidence was preserved.`,
      );
    }
  }

  function lock() {
    security.lock("manual");
    setMessage("Locked manually. Encrypted evidence remains on this device.");
  }

  return (
    <div className="mt-8 rounded-2xl border border-stone-300 bg-white p-5" role="status">
      <p className="font-medium">
        {unlocked ? "Protected fieldwork unlocked" : "Offline shell loaded"}
      </p>
      <p className="mt-1 text-sm text-stone-600">{message}</p>
      <button
        className="mt-4 rounded-lg bg-stone-950 px-4 py-2 text-sm text-white"
        disabled={!unlocked && preparedDevice?.prepared !== true}
        onClick={unlocked ? lock : unlock}
        type="button"
      >
        {unlocked ? "Lock now" : "Verify and unlock"}
      </button>
      {unlocked && props.children}
    </div>
  );
}

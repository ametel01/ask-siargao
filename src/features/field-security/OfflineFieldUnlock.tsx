"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useRef, useState } from "react";

import { encodeBase64Url, zeroize } from "@/features/field-security/encoding";
import { fieldSecurityErrorCode } from "@/features/field-security/errors";
import { FieldSecuritySession } from "@/features/field-security/security-state";
import { createOfflineUnlockRequest, unlockFieldVault } from "@/features/field-security/unlock";

const applicationVersion = "0.1.0";
const applicationBuildId = process.env.NEXT_PUBLIC_FIELD_CACHE_GENERATION ?? "unconfigured";

export function OfflineFieldUnlock() {
  const session = useRef(new FieldSecuritySession());
  const expiryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [status, setStatus] = useState("Offline shell loaded. Vault key material is unavailable.");
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    const recordActivity = () => session.current.touch(Date.now());
    const timer = setInterval(() => {
      if (session.current.enforceInactivity(Date.now())) {
        setUnlocked(false);
        setStatus("Locked after inactivity. Verify locally again to continue.");
      }
    }, 10_000);
    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    return () => {
      clearInterval(timer);
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      session.current.lock("manual");
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
    };
  }, []);

  async function unlock() {
    setStatus("Waiting for local user verification…");
    try {
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
      session.current.unlock(result.vaultKey, Date.now());
      zeroize(result.vaultKey);
      setUnlocked(true);
      setStatus("Protected fieldwork unlocked on this Authorized Field Device.");
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
      expiryTimer.current = setTimeout(
        () => {
          session.current.lock("grant");
          setUnlocked(false);
          setStatus(
            "Offline Field Grant expired. Encrypted evidence remains available for reauthorization.",
          );
        },
        Math.max(0, Date.parse(result.claims.expiresAt) - Date.now()),
      );
    } catch (error) {
      session.current.lock("manual");
      setUnlocked(false);
      setStatus(
        `Unlock denied (${fieldSecurityErrorCode(error)}). Encrypted evidence was preserved.`,
      );
    }
  }

  function lock() {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    session.current.lock("manual");
    setUnlocked(false);
    setStatus("Locked manually. Encrypted evidence remains on this device.");
  }

  return (
    <div className="mt-8 rounded-2xl border border-stone-300 bg-white p-5" role="status">
      <p className="font-medium">
        {unlocked ? "Protected fieldwork unlocked" : "Offline shell loaded"}
      </p>
      <p className="mt-1 text-sm text-stone-600">{status}</p>
      <button
        className="mt-4 rounded-lg bg-stone-950 px-4 py-2 text-sm text-white"
        onClick={unlocked ? lock : unlock}
        type="button"
      >
        {unlocked ? "Lock now" : "Verify and unlock"}
      </button>
    </div>
  );
}

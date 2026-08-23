"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FieldSecurityError } from "@/features/field-security/errors";
import {
  FieldSecuritySession,
  type FieldSecurityState,
} from "@/features/field-security/security-state";
import type { OfflineFieldGrantClaims } from "@/features/field-security/types";

const clockRollbackToleranceMs = 2 * 60 * 1_000;

export function registerFieldSecurityBackgroundLock(input: {
  documentTarget: EventTarget;
  getVisibilityState: () => DocumentVisibilityState;
  lock: (reason: "manual") => void;
  windowTarget: EventTarget;
}) {
  const lockOnBackground: EventListener = () => input.lock("manual");
  const lockOnVisibilityChange: EventListener = () => {
    if (input.getVisibilityState() === "hidden") input.lock("manual");
  };
  input.windowTarget.addEventListener("pagehide", lockOnBackground);
  input.documentTarget.addEventListener("visibilitychange", lockOnVisibilityChange);
  return () => {
    input.windowTarget.removeEventListener("pagehide", lockOnBackground);
    input.documentTarget.removeEventListener("visibilitychange", lockOnVisibilityChange);
  };
}

export type FieldSecuritySessionValue = {
  claims?: OfflineFieldGrantClaims;
  lock: (reason?: "inactivity" | "grant" | "manual" | "clock") => void;
  state: FieldSecurityState;
  status: FieldSecurityState["status"];
  touch: (nowMs?: number) => void;
  unlockWithKey: (input: {
    claims: OfflineFieldGrantClaims;
    key: Uint8Array;
    nowMs?: number;
  }) => void;
  withVaultKey: {
    <T>(callback: (key: Uint8Array) => Promise<T>): Promise<T>;
    <T>(callback: (key: Uint8Array) => T): T;
  };
};

const FieldSecuritySessionContext = createContext<FieldSecuritySessionValue | undefined>(undefined);

export function FieldSecuritySessionProvider(props: {
  children: ReactNode;
  inactivityMs?: number;
}) {
  const [session] = useState(() => new FieldSecuritySession(props.inactivityMs));
  const claims = useRef<OfflineFieldGrantClaims | undefined>(undefined);
  const lastObservedWallClockMs = useRef(0);
  const [snapshot, setSnapshot] = useState<{
    claims?: OfflineFieldGrantClaims;
    state: FieldSecurityState;
  }>({ state: session.state });

  const lock = useCallback(
    (reason: "inactivity" | "grant" | "manual" | "clock" = "manual") => {
      session.lock(reason);
      claims.current = undefined;
      setSnapshot({ state: session.state });
    },
    [session],
  );

  const touch = useCallback(
    (nowMs = Date.now()) => {
      session.touch(nowMs);
    },
    [session],
  );

  const unlockWithKey = useCallback(
    (input: { claims: OfflineFieldGrantClaims; key: Uint8Array; nowMs?: number }) => {
      const nowMs = input.nowMs ?? Date.now();
      if (Date.parse(input.claims.expiresAt) <= nowMs) {
        lock("grant");
        throw new FieldSecurityError("field_grant_expired");
      }
      session.unlock(input.key, nowMs);
      claims.current = input.claims;
      lastObservedWallClockMs.current = nowMs;
      setSnapshot({
        claims: input.claims,
        state: session.state,
      });
    },
    [lock, session],
  );

  const withVaultKey = useCallback(
    <T,>(callback: (key: Uint8Array) => T | Promise<T>): T | Promise<T> => {
      return session.withKey(callback as (key: Uint8Array) => T);
    },
    [session],
  ) as FieldSecuritySessionValue["withVaultKey"];

  useEffect(() => {
    lastObservedWallClockMs.current = Date.now();
    const recordActivity = () => touch();
    const timer = setInterval(() => {
      const nowMs = Date.now();
      if (nowMs + clockRollbackToleranceMs < lastObservedWallClockMs.current) {
        lock("clock");
        return;
      }
      lastObservedWallClockMs.current = Math.max(lastObservedWallClockMs.current, nowMs);
      if (claims.current && Date.parse(claims.current.expiresAt) <= nowMs) {
        lock("grant");
        return;
      }
      if (session.enforceInactivity(nowMs)) {
        claims.current = undefined;
        setSnapshot({ state: session.state });
      }
    }, 10_000);
    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    const releaseBackgroundLock = registerFieldSecurityBackgroundLock({
      documentTarget: document,
      getVisibilityState: () => document.visibilityState,
      lock,
      windowTarget: window,
    });
    return () => {
      clearInterval(timer);
      session.lock("manual");
      claims.current = undefined;
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      releaseBackgroundLock();
    };
  }, [lock, session, touch]);

  const value = useMemo<FieldSecuritySessionValue>(
    () => ({
      claims: snapshot.claims,
      lock,
      state: snapshot.state,
      status: snapshot.state.status,
      touch,
      unlockWithKey,
      withVaultKey,
    }),
    [lock, snapshot, touch, unlockWithKey, withVaultKey],
  );

  return (
    <FieldSecuritySessionContext.Provider value={value}>
      {props.children}
    </FieldSecuritySessionContext.Provider>
  );
}

export function useFieldSecuritySession(): FieldSecuritySessionValue {
  const value = useContext(FieldSecuritySessionContext);
  if (!value) throw new Error("useFieldSecuritySession requires FieldSecuritySessionProvider");
  return value;
}

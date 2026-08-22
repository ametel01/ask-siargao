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
  const session = useRef<FieldSecuritySession | undefined>(undefined);
  if (!session.current) session.current = new FieldSecuritySession(props.inactivityMs);
  const claims = useRef<OfflineFieldGrantClaims | undefined>(undefined);
  const lastObservedWallClockMs = useRef(Date.now());
  const [snapshot, setSnapshot] = useState<{
    claims?: OfflineFieldGrantClaims;
    state: FieldSecurityState;
  }>({ state: session.current.state });

  const lock = useCallback((reason: "inactivity" | "grant" | "manual" | "clock" = "manual") => {
    session.current?.lock(reason);
    claims.current = undefined;
    setSnapshot({ state: session.current?.state ?? { reason, status: "locked" } });
  }, []);

  const touch = useCallback((nowMs = Date.now()) => {
    session.current?.touch(nowMs);
  }, []);

  const unlockWithKey = useCallback(
    (input: { claims: OfflineFieldGrantClaims; key: Uint8Array; nowMs?: number }) => {
      const nowMs = input.nowMs ?? Date.now();
      if (Date.parse(input.claims.expiresAt) <= nowMs) {
        lock("grant");
        throw new FieldSecurityError("field_grant_expired");
      }
      session.current?.unlock(input.key, nowMs);
      claims.current = input.claims;
      lastObservedWallClockMs.current = nowMs;
      setSnapshot({
        claims: input.claims,
        state: session.current?.state ?? { status: "unprepared" },
      });
    },
    [lock],
  );

  const withVaultKey = useCallback(
    <T,>(callback: (key: Uint8Array) => T | Promise<T>): T | Promise<T> => {
      const current = session.current;
      if (!current) throw new FieldSecurityError("field_key_unavailable");
      return current.withKey(callback as (key: Uint8Array) => T);
    },
    [],
  ) as FieldSecuritySessionValue["withVaultKey"];

  useEffect(() => {
    const recordActivity = () => touch();
    const lockOnPageHide = () => lock("manual");
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
      if (session.current?.enforceInactivity(nowMs)) {
        claims.current = undefined;
        setSnapshot({ state: session.current.state });
      }
    }, 10_000);
    window.addEventListener("pointerdown", recordActivity, { passive: true });
    window.addEventListener("keydown", recordActivity);
    window.addEventListener("pagehide", lockOnPageHide, { once: true });
    return () => {
      clearInterval(timer);
      session.current?.lock("manual");
      claims.current = undefined;
      window.removeEventListener("pointerdown", recordActivity);
      window.removeEventListener("keydown", recordActivity);
      window.removeEventListener("pagehide", lockOnPageHide);
    };
  }, [lock, touch]);

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

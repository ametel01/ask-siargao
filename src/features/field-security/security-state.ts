import { zeroize } from "@/features/field-security/encoding";
import { FieldSecurityError } from "@/features/field-security/errors";

export type FieldSecurityState =
  | { status: "unprepared" }
  | { status: "locked"; reason: "inactivity" | "grant" | "manual" | "clock" }
  | { status: "unlocked"; lastActivityAtMs: number };

export class FieldSecuritySession {
  #borrowedKeys = new Set<Uint8Array>();
  #inactivityMs: number;
  #key?: Uint8Array;
  #state: FieldSecurityState = { status: "unprepared" };

  constructor(inactivityMs = 5 * 60 * 1_000) {
    this.#inactivityMs = inactivityMs;
  }

  get state(): FieldSecurityState {
    return this.#state;
  }

  unlock(key: Uint8Array, nowMs: number): void {
    this.lock("manual");
    this.#key = new Uint8Array(key);
    this.#state = { lastActivityAtMs: nowMs, status: "unlocked" };
  }

  touch(nowMs: number): void {
    if (this.#state.status === "unlocked") {
      this.#state = { lastActivityAtMs: nowMs, status: "unlocked" };
    }
  }

  enforceInactivity(nowMs: number): boolean {
    if (
      this.#state.status === "unlocked" &&
      nowMs - this.#state.lastActivityAtMs >= this.#inactivityMs
    ) {
      this.lock("inactivity");
      return true;
    }
    return false;
  }

  lock(reason: "inactivity" | "grant" | "manual" | "clock"): void {
    if (this.#key) zeroize(this.#key);
    for (const borrowedKey of this.#borrowedKeys) zeroize(borrowedKey);
    this.#borrowedKeys.clear();
    this.#key = undefined;
    this.#state = { reason, status: "locked" };
  }

  withKey<T>(callback: (key: Uint8Array) => Promise<T>): Promise<T>;
  withKey<T>(callback: (key: Uint8Array) => T): T;
  withKey<T>(callback: (key: Uint8Array) => T | Promise<T>): T | Promise<T> {
    if (this.#state.status !== "unlocked" || !this.#key) {
      throw new FieldSecurityError("field_key_unavailable");
    }
    const temporaryKey = new Uint8Array(this.#key);
    this.#borrowedKeys.add(temporaryKey);
    const release = () => {
      this.#borrowedKeys.delete(temporaryKey);
      zeroize(temporaryKey);
    };
    try {
      const result = callback(temporaryKey);
      if (isPromiseLike(result)) {
        return Promise.resolve(result).finally(release);
      }
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

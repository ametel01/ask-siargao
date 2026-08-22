import { zeroize } from "@/features/field-security/encoding";

export type FieldSecurityState =
  | { status: "unprepared" }
  | { status: "locked"; reason: "inactivity" | "grant" | "manual" | "clock" }
  | { status: "unlocked"; lastActivityAtMs: number };

export class FieldSecuritySession {
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
    this.#key = undefined;
    this.#state = { reason, status: "locked" };
  }

  withKey<T>(callback: (key: Uint8Array) => T): T {
    if (this.#state.status !== "unlocked" || !this.#key) {
      throw new Error("field_key_unavailable");
    }
    return callback(this.#key);
  }
}

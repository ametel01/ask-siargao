import { describe, expect, test } from "bun:test";

import { discoverFieldWorkspaceDestination } from "./FieldWorkspaceRouter";

describe("FieldWorkspaceRouter", () => {
  test("routes unprepared devices to Field Readiness without reading recorder state", async () => {
    let pointerReads = 0;
    const destination = await discoverFieldWorkspaceDestination({
      discoverPreparedDevice: async () => ({ prepared: false }),
      getDeviceRole: async () => "recorder",
      getRecorderPointer: async () => {
        pointerReads += 1;
        return { opaqueRecordKey: "must-not-be-read" };
      },
    });

    expect(destination).toBe("/operator/field/security-workspace");
    expect(pointerReads).toBe(0);
  });

  test("routes prepared devices without recorder state to planning", async () => {
    const destination = await discoverFieldWorkspaceDestination({
      discoverPreparedDevice: async () => ({ prepared: true }),
      getDeviceRole: async () => "recorder",
      getRecorderPointer: async () => undefined,
    });

    expect(destination).toBe("/operator/field/plan");
  });

  test("routes prepared devices with recorder state to capture", async () => {
    const destination = await discoverFieldWorkspaceDestination({
      discoverPreparedDevice: async () => ({ prepared: true }),
      getDeviceRole: async () => "recorder",
      getRecorderPointer: async () => ({ opaqueRecordKey: "opaque" }),
    });

    expect(destination).toBe("/operator/field/capture");
  });

  test("fails closed to Field Readiness when IndexedDB discovery fails", async () => {
    const destination = await discoverFieldWorkspaceDestination({
      discoverPreparedDevice: async () => {
        throw new Error("IndexedDB unavailable");
      },
      getDeviceRole: async () => undefined,
      getRecorderPointer: async () => undefined,
    });

    expect(destination).toBe("/operator/field/security-workspace");
  });

  test("routes a prepared Desk to review instead of sending it to Plan", async () => {
    const destination = await discoverFieldWorkspaceDestination({
      discoverPreparedDevice: async () => ({ prepared: true }),
      getDeviceRole: async () => "desk",
      getRecorderPointer: async () => undefined,
    });

    expect(destination).toBe("/operator/field/review");
  });
});

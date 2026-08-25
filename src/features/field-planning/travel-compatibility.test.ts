import { describe, expect, test } from "bun:test";

import { createTestPlannerFixture } from "./fixtures/test-fixtures";
import { findConservativeTravelPath } from "./travel-compatibility";

describe("Travel Compatibility Graph", () => {
  test("uses the conservative upper band and explicit bidirectional return semantics", () => {
    const { protocol } = createTestPlannerFixture();
    expect(findConservativeTravelPath(protocol, "area_start", "area_remote", "car")).toEqual({
      success: true,
      minutes: 10,
      areaIds: ["area_start", "area_remote"],
    });
    expect(findConservativeTravelPath(protocol, "area_remote", "area_start", "car")).toEqual({
      success: true,
      minutes: 10,
      areaIds: ["area_remote", "area_start"],
    });
  });

  test("does not infer straight-line compatibility for the wrong mode", () => {
    const { protocol } = createTestPlannerFixture();
    expect(findConservativeTravelPath(protocol, "area_start", "area_remote", "walk")).toEqual({
      success: false,
      code: "transport_incompatible",
    });
  });

  test("never traverses a transfer boundary", () => {
    const { protocol } = createTestPlannerFixture();
    const boundaryProtocol = {
      ...protocol,
      travelEdges: protocol.travelEdges.map((edge) => ({ ...edge, transferBoundary: true })),
    };
    expect(
      findConservativeTravelPath(boundaryProtocol, "area_start", "area_remote", "car"),
    ).toEqual({
      success: false,
      code: "transfer_boundary",
    });
  });
});

import { describe, expect, test } from "bun:test";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";

import { captureExceptionReasons } from "./field-recorder-types";
import { buildCaptureException, buildRouteRun } from "./record-builders";

const common = {
  campaignId: baselineFieldProtocolPackage.campaign.campaignId,
  captureWindowIds: ["0192f060-4f41-7aa1-b322-4aa9fc9f1511"] as const,
  deviceId: "device_example",
  localTimezone: "Asia/Manila" as const,
  protocol: baselineFieldProtocolPackage,
  protocolPackageId: baselineFieldProtocolPackage.manifest.packageId,
  protocolPackageVersion: baselineFieldProtocolPackage.manifest.packageVersion,
  recordedAt: "2026-08-22T09:35:00+08:00",
  researcherId: "researcher_example",
};

describe("Recorder record builders", () => {
  test("creates every governed Capture Exception without arbitrary reasons", () => {
    for (const [index, reason] of captureExceptionReasons.entries()) {
      const value = buildCaptureException({
        captureContext: "planning",
        context: {
          ...common,
          assignmentId: "assignment_pilar_access",
          coverageRequirementId: "coverage_access_state",
          objectiveId: "objective_pilar_observe_conditions",
        },
        id: `0192f060-4f41-7aa1-b322-4aa9fc9f15${String(20 + index)}`,
        reason,
        reasonDetails: `Governed ${reason} detail`,
      });
      expect(value).toMatchObject({ captureState: "captured", context: "planning", reason });
    }
  });

  test("enforces Route Run timestamp order and canonical condition tags", () => {
    const context = {
      ...common,
      assignmentId: "assignment_airport_arrival",
      coverageRequirementId: "coverage_route_time",
      objectiveId: "objective_airport_traverse_arrival",
      visitId: "0192f060-4f41-7aa1-b322-4aa9fc9f1501",
    };
    const route = {
      accessContext: "Walk-up curbside pickup",
      arrivedAt: "2026-08-22T09:30:00+08:00",
      barriers: [],
      bookingMethod: "walk_up" as const,
      conditions: ["weather_cloudy", "road_dry"] as ("weather_cloudy" | "road_dry")[],
      context,
      departedAt: "2026-08-22T08:45:00+08:00",
      destinationSubjectId: "subject_area_del_carmen",
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1503",
      luggageContext: "One cabin bag",
      notTested: [],
      originSubjectId: "subject_sayak_airport",
      partyContext: "One adult",
      requestedAt: "2026-08-22T08:30:00+08:00",
      signalCheckpoints: [],
      stops: [],
      transportMode: "van" as const,
    };
    expect(buildRouteRun(route).conditions).toEqual(["weather_cloudy", "road_dry"]);
    expect(() => buildRouteRun({ ...route, arrivedAt: "2026-08-22T08:40:00+08:00" })).toThrow(
      "times must follow",
    );
    expect(() => buildRouteRun({ ...route, conditions: ["invented"] as never })).toThrow();
  });
});

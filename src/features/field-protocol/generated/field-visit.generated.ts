// Generated from field-protocol/canonical/v1. Do not edit by hand.

export type VisitTarget =
  | {
      kind: "governed_subject";
      subjectId: string;
    }
  | {
      kind: "governed_area";
      areaId: string;
    }
  | {
      kind: "governed_route";
      routeId: string;
    }
  | {
      kind: "provisional_subject";
      provisionalSubject: ProvisionalSubject;
    };

export interface FieldVisit {
  schemaVersion: "field-visit.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  researcherId: string;
  deviceId: string;
  recordedAt: string;
  localTimezone: "Asia/Manila";
  supersedesId?: string;
  captureState: "draft" | "captured";
  startedAt: string;
  endedAt?: string;
  /**
   * @minItems 1
   */
  captureWindows: [CaptureWindow, ...CaptureWindow[]];
  target: VisitTarget;
  locationPermissionState: "denied" | "coarse" | "precise_active_visit";
  publicLocationPrecision: "withheld" | "governed_area" | "route_corridor" | "approximate_100m";
  conditions: Conditions;
  /**
   * @minItems 1
   */
  objectiveIds: [string, ...string[]];
  assetIds: string[];
  privateContextNote?: string;
}
export interface CaptureWindow {
  id: string;
  windowIdentity: "local_hour";
  localHourStartedAt: string;
  utcOffsetMinutes: number;
}
export interface ProvisionalSubject {
  id: string;
  displayedName: string;
  category: "place" | "service" | "route" | "organisation";
  governedAreaId: string;
  distinguishingDetails: string;
}
export interface Conditions {
  tags: (
    | "weather_clear"
    | "weather_cloudy"
    | "weather_rain"
    | "tide_low"
    | "tide_mid"
    | "tide_high"
    | "road_dry"
    | "road_wet"
    | "crowd_quiet"
    | "crowd_moderate"
    | "crowd_busy"
    | "noise_quiet"
    | "noise_moderate"
    | "noise_loud"
    | "power_available"
    | "power_outage"
    | "access_open"
    | "access_restricted"
    | "disruption_none"
    | "disruption_active"
  )[];
}

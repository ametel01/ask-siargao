// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface RouteRun {
  schemaVersion: "route-run.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  visitId: string;
  objectiveId: string;
  coverageRequirementId: string;
  researcherId: string;
  deviceId: string;
  recordedAt: string;
  localTimezone: "Asia/Manila";
  captureState: "draft" | "captured";
  /**
   * @minItems 1
   */
  captureWindowIds: [string, ...string[]];
  supersedesId?: string;
  originSubjectId: string;
  destinationSubjectId: string;
  transportMode: "walk" | "bicycle" | "motorbike" | "tricycle" | "car" | "van" | "boat";
  requestedAt: string;
  queueStartedAt?: string;
  departedAt: string;
  arrivedAt: string;
  stops: string[];
  partyContext: string;
  luggageContext: string;
  accessContext: string;
  bookingMethod: "walk_up" | "phone" | "web" | "app" | "prearranged" | "not_applicable";
  distanceMeters?: number;
  methodProfileId: string;
  price?: {
    amount: string;
    currency: "PHP";
    basis: "posted" | "quoted" | "paid";
    receiptAssetId?: string;
  };
  conditions: (
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
  signalCheckpoints: string[];
  barriers: string[];
  notTested: string[];
}

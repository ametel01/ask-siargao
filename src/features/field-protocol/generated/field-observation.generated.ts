// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface FieldObservation {
  schemaVersion: "field-observation.v1";
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
  supersedesId?: string;
  captureState: "draft" | "captured";
  subject:
    | {
        kind: "governed";
        subjectId: string;
      }
    | {
        kind: "provisional";
        provisionalSubjectId: string;
      };
  observationKind: string;
  valueSchemaVersion: string;
  directness:
    | "direct_observation"
    | "instrument_measurement"
    | "transaction_record"
    | "posted_notice"
    | "source_stated"
    | "derived";
  observedAt: string;
  utcOffsetMinutes: number;
  timeCorrected: boolean;
  value: {
    [k: string]: unknown;
  };
  methodProfileId: string;
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
  rawMeasurement?: {
    id: string;
    value: number;
    unit: string;
  };
  normalizedMeasurement?: {
    value: number;
    unit: string;
    sourceRawMeasurementId: string;
    conversionVersion: string;
  };
  captureConfidence: "high" | "medium" | "low";
  captureConfidenceReason?: string;
  caveat?: string;
  validUntil?: string;
  reviewDueAt: string;
  permissions: {
    llmUse: boolean;
    articleUse: boolean;
    quotationUse: boolean;
    publicUse: boolean;
  };
  assetIds?: string[];
  contradictsObservationIds?: string[];
  comparisonGroupId?: string;
}

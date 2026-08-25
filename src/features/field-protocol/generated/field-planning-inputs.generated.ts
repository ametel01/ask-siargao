// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface FieldPlanningInputs {
  schemaVersion: "field-planning-inputs.v1";
  protocolPackageId: string;
  protocolPackageVersion: string;
  coverageSnapshotId: string;
  coverageSnapshotVersion: string;
  planningAt: string;
  startingAreaId: string;
  transportMode: string;
  availableMinutes: number;
  reserveMinutes: {
    safety: number;
    documentation: number;
    rest: number;
    daylight: number;
  };
  preciseLocation?: {
    label: string;
    permission: "granted";
  };
  assignmentGates: {
    id: string;
    assignmentId: string;
    safety: "allowed" | "blocked" | "unknown";
    permission: "allowed" | "blocked" | "unknown";
    access: "allowed" | "blocked" | "unknown";
    sourceId: string;
    retrievedAt: string;
    validUntil: string;
    fingerprint: string;
  }[];
  eligibilityEvidence: {
    id: string;
    assignmentId: string;
    kind: string;
    value: string;
    state: "allowed" | "blocked" | "unknown";
    sourceId: string;
    retrievedAt: string;
    validUntil: string;
    fingerprint: string;
  }[];
}

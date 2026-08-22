// Generated from field-protocol/canonical/v1. Do not edit by hand.

export interface RouteRun {
  schemaVersion: "route-run.v1";
  id: string;
  protocolPackageId: string;
  protocolPackageVersion: string;
  campaignId: string;
  assignmentId: string;
  visitId: string;
  researcherId: string;
  deviceId: string;
  recordedAt: string;
  localTimezone: "Asia/Manila";
  captureState: "draft" | "captured";
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
  conditions: string[];
  signalCheckpoints: string[];
  barriers: string[];
  notTested: string[];
}

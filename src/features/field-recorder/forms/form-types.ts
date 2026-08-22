import type {
  CaptureException,
  EvidenceAsset,
  FieldObservation,
  FieldVisit,
  ObservationKind,
  ObservationValueByKind,
  RouteRun,
  SchemaGap,
  SourceStatement,
  StatementTranslation,
} from "@/features/field-protocol/generated";

export type FieldVisitDraftInput = Pick<
  FieldVisit,
  "conditions" | "locationPermissionState" | "publicLocationPrecision" | "target"
>;

export type ObservationCaptureSubmission = Readonly<{
  type: "observation";
  kind: ObservationKind;
  subject: FieldObservation["subject"];
  value: ObservationValueByKind[ObservationKind];
  directness: FieldObservation["directness"];
  captureConfidence: FieldObservation["captureConfidence"];
  captureConfidenceReason?: string;
  timeCorrected: boolean;
  observedAt: string;
  validUntil?: string;
  conditions: FieldObservation["conditions"];
  permissions: FieldObservation["permissions"];
}>;

export type RouteRunCaptureSubmission = Readonly<{
  type: "routeRun";
  value: Pick<
    RouteRun,
    | "accessContext"
    | "arrivedAt"
    | "barriers"
    | "bookingMethod"
    | "conditions"
    | "departedAt"
    | "destinationSubjectId"
    | "luggageContext"
    | "notTested"
    | "originSubjectId"
    | "partyContext"
    | "price"
    | "queueStartedAt"
    | "requestedAt"
    | "signalCheckpoints"
    | "stops"
    | "transportMode"
  >;
}>;

export type SourceStatementCaptureSubmission = Readonly<{
  type: "sourceStatement";
  value: Pick<
    SourceStatement,
    | "assetIds"
    | "attribution"
    | "basisOfKnowledge"
    | "captureContext"
    | "consents"
    | "originalLanguage"
    | "originalStatement"
    | "questionAsked"
    | "recontactAfter"
    | "sourceRole"
    | "statementForm"
    | "subjectId"
    | "validUntil"
    | "withdrawalRoute"
  >;
}>;

export type TranslationCaptureSubmission = Readonly<{
  type: "statementTranslation";
  value: Pick<
    StatementTranslation,
    | "originalLanguage"
    | "recordedAt"
    | "sourceStatementId"
    | "targetLanguage"
    | "translatedText"
    | "translator"
  >;
}>;

export type AssetCaptureSubmission = Readonly<{
  type: "evidenceAsset";
  file: File;
  value: Pick<
    EvidenceAsset,
    | "assetKind"
    | "consentState"
    | "peoplePresent"
    | "permittedLocation"
    | "purpose"
    | "recordIds"
    | "redactionState"
    | "rights"
  >;
}>;

export type ExceptionCaptureSubmission = Readonly<{
  type: "captureException";
  value: Pick<CaptureException, "context" | "reason" | "reasonDetails">;
}>;

export type SchemaGapCaptureSubmission = Readonly<{
  type: "schemaGap";
  value: Pick<SchemaGap, "attemptedAt" | "description" | "permittedLocation" | "subject">;
}>;

export type CaptureFormSubmission =
  | ObservationCaptureSubmission
  | RouteRunCaptureSubmission
  | SourceStatementCaptureSubmission
  | TranslationCaptureSubmission
  | AssetCaptureSubmission
  | ExceptionCaptureSubmission
  | SchemaGapCaptureSubmission;

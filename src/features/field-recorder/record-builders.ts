import { validateFieldProtocolRecord } from "@/features/field-protocol/field-protocol";
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

import type { CaptureExceptionReason } from "./field-recorder-types";
import type { RecorderProtocol } from "./load-recorder-protocol";

export type RecorderCaptureContext = Readonly<{
  protocol: RecorderProtocol;
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
  captureWindowIds: readonly [string, ...string[]];
}>;

export function buildFieldVisit(input: {
  context: Omit<
    RecorderCaptureContext,
    "visitId" | "objectiveId" | "coverageRequirementId" | "captureWindowIds"
  >;
  id: string;
  startedAt: string;
  target: FieldVisit["target"];
  locationPermissionState: FieldVisit["locationPermissionState"];
  publicLocationPrecision: FieldVisit["publicLocationPrecision"];
  conditions: FieldVisit["conditions"];
  objectiveIds: FieldVisit["objectiveIds"];
  captureWindows: readonly {
    id: string;
    windowIdentity: "local_hour";
    localHourStartedAt: string;
    utcOffsetMinutes: number;
  }[];
  orientationAssetId?: string;
}): FieldVisit {
  const visit = {
    schemaVersion: "field-visit.v1",
    id: input.id,
    protocolPackageId: input.context.protocolPackageId,
    protocolPackageVersion: input.context.protocolPackageVersion,
    campaignId: input.context.campaignId,
    assignmentId: input.context.assignmentId,
    researcherId: input.context.researcherId,
    deviceId: input.context.deviceId,
    recordedAt: input.context.recordedAt,
    localTimezone: input.context.localTimezone,
    captureState: "draft",
    startedAt: input.startedAt,
    target: input.target,
    locationPermissionState: input.locationPermissionState,
    publicLocationPrecision: input.publicLocationPrecision,
    conditions: input.conditions,
    objectiveIds: input.objectiveIds,
    assetIds: input.orientationAssetId ? [input.orientationAssetId] : [],
    captureWindows: input.captureWindows,
  } as FieldVisit;
  return validated("fieldVisit", visit, input.context.protocol);
}

export function buildObservation<K extends ObservationKind>(input: {
  context: RecorderCaptureContext;
  id: string;
  kind: K;
  subject: FieldObservation["subject"];
  value: ObservationValueByKind[K];
  directness: FieldObservation["directness"];
  observedAt: string;
  utcOffsetMinutes: number;
  timeCorrected: boolean;
  conditions: FieldObservation["conditions"];
  captureConfidence: FieldObservation["captureConfidence"];
  captureConfidenceReason?: string;
  validUntil?: string;
  permissions: FieldObservation["permissions"];
  assetIds?: readonly string[];
  supersedesId?: string;
}): FieldObservation {
  const registry = input.context.protocol.observationKinds.kinds.find(
    (entry) => entry.kind === input.kind,
  );
  if (!registry) throw new Error("The selected Observation Kind is not in the pinned protocol.");
  const method = input.context.protocol.methodProfiles.profiles.find((profile) =>
    (profile.supportedKinds as readonly string[]).includes(input.kind),
  );
  if (!method) throw new Error("No compatible Method Profile exists for this Observation Kind.");
  const defaultReviewMinutes = registry.freshness.defaultReviewMinutes;
  const reviewDueAt = new Date(
    Date.parse(input.observedAt) + defaultReviewMinutes * 60_000,
  ).toISOString();
  const observation = {
    ...commonRecord(input.context, input.id),
    assetIds: input.assetIds ? [...input.assetIds] : [],
    captureConfidence: input.captureConfidence,
    captureConfidenceReason: input.captureConfidenceReason,
    captureState: "captured",
    captureWindowIds: [...input.context.captureWindowIds] as [string, ...string[]],
    conditions: input.conditions,
    directness: input.directness,
    methodProfileId: method.id,
    observationKind: input.kind,
    observedAt: input.observedAt,
    permissions: input.permissions,
    reviewDueAt,
    schemaVersion: "field-observation.v1",
    subject: input.subject,
    supersedesId: input.supersedesId,
    timeCorrected: input.timeCorrected,
    utcOffsetMinutes: input.utcOffsetMinutes,
    validUntil: input.validUntil,
    value: input.value,
    valueSchemaVersion: registry.valueSchemaVersion,
  } as unknown as FieldObservation;
  return validated("fieldObservation", observation, input.context.protocol);
}

export function buildRouteRun(input: {
  context: RecorderCaptureContext;
  id: string;
  originSubjectId: string;
  destinationSubjectId: string;
  transportMode: RouteRun["transportMode"];
  requestedAt: string;
  queueStartedAt?: string;
  departedAt: string;
  arrivedAt: string;
  stops: readonly string[];
  partyContext: string;
  luggageContext: string;
  accessContext: string;
  bookingMethod: RouteRun["bookingMethod"];
  price?: RouteRun["price"];
  conditions: RouteRun["conditions"];
  signalCheckpoints: readonly string[];
  barriers: readonly string[];
  notTested: readonly string[];
  supersedesId?: string;
}): RouteRun {
  const instants = [input.requestedAt, input.queueStartedAt, input.departedAt, input.arrivedAt]
    .filter((value): value is string => Boolean(value))
    .map(Date.parse);
  if (instants.some((instant) => !Number.isFinite(instant))) {
    throw new Error("Route Run times must be valid timestamps.");
  }
  if (instants.some((instant, index) => index > 0 && instant < instants[index - 1])) {
    throw new Error("Route Run times must follow request, queue, departure, and arrival order.");
  }
  return validated(
    "routeRun",
    {
      ...commonRecord(input.context, input.id),
      accessContext: input.accessContext,
      arrivedAt: input.arrivedAt,
      barriers: [...input.barriers],
      bookingMethod: input.bookingMethod,
      captureState: "captured",
      captureWindowIds: [...input.context.captureWindowIds] as [string, ...string[]],
      conditions: input.conditions,
      departedAt: input.departedAt,
      destinationSubjectId: input.destinationSubjectId,
      luggageContext: input.luggageContext,
      methodProfileId: "method_timed_route@1.0.0",
      notTested: [...input.notTested],
      originSubjectId: input.originSubjectId,
      partyContext: input.partyContext,
      price: input.price,
      queueStartedAt: input.queueStartedAt,
      requestedAt: input.requestedAt,
      schemaVersion: "route-run.v1",
      signalCheckpoints: [...input.signalCheckpoints],
      stops: [...input.stops],
      supersedesId: input.supersedesId,
      transportMode: input.transportMode,
    } as RouteRun,
    input.context.protocol,
  );
}

export function buildSourceStatement(input: {
  context: RecorderCaptureContext;
  id: string;
  subjectId: string;
  sourceRole: SourceStatement["sourceRole"];
  basisOfKnowledge: SourceStatement["basisOfKnowledge"];
  questionAsked: string;
  originalLanguage: string;
  statementForm: SourceStatement["statementForm"];
  originalStatement: string;
  attribution: SourceStatement["attribution"];
  captureContext: string;
  consents: SourceStatement["consents"];
  withdrawalRoute: string;
  validUntil?: string;
  recontactAfter?: string;
  assetIds?: readonly string[];
  supersedesId?: string;
}): SourceStatement {
  if (input.consents.participation.decision !== "granted") {
    throw new Error("Participation consent must be granted before a Source Statement is captured.");
  }
  return validated(
    "sourceStatement",
    {
      ...commonRecord(input.context, input.id),
      assetIds: [...(input.assetIds ?? [])],
      attribution: input.attribution,
      basisOfKnowledge: input.basisOfKnowledge,
      captureContext: input.captureContext,
      captureState: "captured",
      captureWindowIds: [...input.context.captureWindowIds] as [string, ...string[]],
      consents: input.consents,
      originalLanguage: input.originalLanguage,
      originalStatement: input.originalStatement,
      questionAsked: input.questionAsked,
      recontactAfter: input.recontactAfter,
      schemaVersion: "source-statement.v1",
      sourceRole: input.sourceRole,
      statementForm: input.statementForm,
      subjectId: input.subjectId,
      supersedesId: input.supersedesId,
      translationIds: [],
      validUntil: input.validUntil,
      withdrawalRoute: input.withdrawalRoute,
    } as SourceStatement,
    input.context.protocol,
  );
}

export function buildStatementTranslation(input: {
  context: RecorderCaptureContext;
  id: string;
  sourceStatementId: string;
  originalLanguage: string;
  targetLanguage: string;
  translatedText: string;
  translator: StatementTranslation["translator"];
  supersedesId?: string;
}): StatementTranslation {
  if (input.originalLanguage === input.targetLanguage) {
    throw new Error("A translation must use a different target language.");
  }
  return validated(
    "statementTranslation",
    {
      ...commonRecord(input.context, input.id),
      captureState: "captured",
      captureWindowIds: [...input.context.captureWindowIds] as [string, ...string[]],
      originalLanguage: input.originalLanguage,
      schemaVersion: "statement-translation.v1",
      sourceStatementId: input.sourceStatementId,
      supersedesId: input.supersedesId,
      targetLanguage: input.targetLanguage,
      translatedText: input.translatedText,
      translator: input.translator,
    } as StatementTranslation,
    input.context.protocol,
  );
}

export function buildEvidenceAsset(input: {
  context: RecorderCaptureContext;
  id: string;
  assetKind: EvidenceAsset["assetKind"];
  byteSize: number;
  mediaType: EvidenceAsset["mediaType"];
  contentSha256: string;
  capturedAt: string;
  purpose: EvidenceAsset["purpose"];
  objectiveIds: EvidenceAsset["objectiveIds"];
  coverageRequirementIds: EvidenceAsset["coverageRequirementIds"];
  recordIds: readonly string[];
  permittedLocation: EvidenceAsset["permittedLocation"];
  peoplePresent: EvidenceAsset["peoplePresent"];
  rights: EvidenceAsset["rights"];
  consentState: EvidenceAsset["consentState"];
  redactionState: EvidenceAsset["redactionState"];
  supersedesId?: string;
}): EvidenceAsset {
  if (input.peoplePresent === "consenting_people" && input.consentState !== "granted") {
    throw new Error("People-present assets require explicit granted consent.");
  }
  return validated(
    "evidenceAsset",
    {
      ...commonRecord(input.context, input.id),
      assetKind: input.assetKind,
      byteSize: input.byteSize,
      captureState: "captured",
      captureWindowIds: [...input.context.captureWindowIds] as [string, ...string[]],
      capturedAt: input.capturedAt,
      consentState: input.consentState,
      contentSha256: input.contentSha256,
      coverageRequirementIds: input.coverageRequirementIds,
      mediaType: input.mediaType,
      objectiveIds: input.objectiveIds,
      peoplePresent: input.peoplePresent,
      permittedLocation: input.permittedLocation,
      purpose: input.purpose,
      recordIds: [...input.recordIds],
      redactionState: input.redactionState,
      retentionState: "active",
      rights: input.rights,
      schemaVersion: "evidence-asset.v1",
      supersedesId: input.supersedesId,
    } as EvidenceAsset,
    input.context.protocol,
  );
}

export function buildCaptureException(input: {
  context: Omit<RecorderCaptureContext, "visitId"> & { visitId?: string };
  id: string;
  reason: CaptureExceptionReason;
  reasonDetails: string;
  captureContext: CaptureException["context"];
  supersedesId?: string;
}): CaptureException {
  return validated(
    "captureException",
    {
      ...commonLineage(input.context, input.id),
      captureState: "captured",
      context: input.captureContext,
      reason: input.reason,
      reasonDetails: input.reasonDetails,
      schemaVersion: "capture-exception.v1",
      supersedesId: input.supersedesId,
      visitId: input.context.visitId,
    } as CaptureException,
    input.context.protocol,
  );
}

export function buildSchemaGap(input: {
  context: RecorderCaptureContext;
  id: string;
  subject: SchemaGap["subject"];
  attemptedAt: string;
  permittedLocation: SchemaGap["permittedLocation"];
  description: string;
  assetId?: string;
  supersedesId?: string;
}): SchemaGap {
  return validated(
    "schemaGap",
    {
      ...commonRecord(input.context, input.id),
      assetId: input.assetId,
      attemptedAt: input.attemptedAt,
      captureState: "captured",
      description: input.description,
      permittedLocation: input.permittedLocation,
      resolutionState: "blocked_pending_protocol",
      schemaVersion: "schema-gap.v1",
      subject: input.subject,
      supersedesId: input.supersedesId,
    } as SchemaGap,
    input.context.protocol,
  );
}

function commonRecord(context: RecorderCaptureContext, id: string) {
  return {
    ...commonLineage(context, id),
    visitId: context.visitId,
  };
}

function commonLineage(
  context: Omit<RecorderCaptureContext, "visitId"> & { visitId?: string },
  id: string,
) {
  return {
    assignmentId: context.assignmentId,
    campaignId: context.campaignId,
    coverageRequirementId: context.coverageRequirementId,
    deviceId: context.deviceId,
    id,
    localTimezone: context.localTimezone,
    objectiveId: context.objectiveId,
    protocolPackageId: context.protocolPackageId,
    protocolPackageVersion: context.protocolPackageVersion,
    recordedAt: context.recordedAt,
    researcherId: context.researcherId,
  };
}

function validated<T>(
  kind: Parameters<typeof validateFieldProtocolRecord>[0],
  value: unknown,
  protocol: RecorderProtocol,
): T {
  const result = validateFieldProtocolRecord(kind, value, { protocolPackage: protocol });
  if (!result.success) {
    throw new Error(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return result.data as T;
}

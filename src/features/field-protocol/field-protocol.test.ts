import { describe, expect, test } from "bun:test";
import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";

import { canonicalStringify } from "@/features/field-protocol/canonical-json";
import {
  activateFieldProtocolPackage,
  baselineFieldProtocolPackage,
  captureWindowIdsForRecord,
  coverageWindowIdentityForRequirement,
  type FieldProtocolRecordKind,
  observationCoverageDisposition,
  previewProtocolMigration,
  resolveProtocolForWork,
  validateFieldProtocolRecord,
  verifyFieldProtocolPackage,
} from "@/features/field-protocol/field-protocol";
import type {
  FieldProtocolPackageManifest,
  ProtocolMigration,
} from "@/features/field-protocol/generated";

type TestFieldProtocolBundle = {
  campaign: {
    campaignId: string;
    assignments: Array<{
      id: string;
      objectives: Array<{ id: string; observationKinds?: string[] }>;
    }>;
  };
  manifest: FieldProtocolPackageManifest;
  migration: ProtocolMigration;
  subjects: { subjects: Array<{ id: string }> };
};

const testSignerPrivateKey = createPrivateKey({
  key: Buffer.from(
    "302e020100300506032b657004220420000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    "hex",
  ),
  format: "der",
  type: "pkcs8",
});
const testSignerKeyId = "ask-siargao-field-protocol-test";
const testSignerPublicKey = createPublicKey(testSignerPrivateKey)
  .export({ format: "der", type: "spki" })
  .toString("base64");

function authenticateTestBundle(bundle: TestFieldProtocolBundle) {
  const rehash = (filename: string, component: unknown) => {
    const file = bundle.manifest.files.find((entry) => entry.path.endsWith(filename));
    if (!file) throw new Error(`Test bundle is missing its ${filename} artifact entry.`);
    file.sha256 = createHash("sha256").update(canonicalStringify(component)).digest("hex");
  };
  rehash("migration-legacy-0.9.0.v1.json", bundle.migration);
  rehash("campaign-island-baseline.v1.json", bundle.campaign);
  rehash("subjects.v1.json", bundle.subjects);
  bundle.manifest.signerKeyId = testSignerKeyId;
  const unsignedManifest: Record<string, unknown> = { ...bundle.manifest };
  delete unsignedManifest.signature;
  bundle.manifest.signature = {
    algorithm: "Ed25519",
    value: sign(
      null,
      Buffer.from(canonicalStringify(unsignedManifest)),
      testSignerPrivateKey,
    ).toString("base64"),
  };
  return {
    schemaVersion: "field-protocol-trusted-signers.v1",
    signers: [
      {
        keyId: testSignerKeyId,
        algorithm: "Ed25519",
        publicKeySpkiBase64: testSignerPublicKey,
        status: "trusted",
      },
    ],
  } as const;
}

describe("canonical field protocol records", () => {
  test("validates every generated baseline example through its canonical schema", () => {
    const examples = Object.entries(baselineFieldProtocolPackage.examples.examples) as Array<
      [FieldProtocolRecordKind, unknown]
    >;

    expect(examples.map(([kind]) => kind).sort()).toEqual([
      "assignmentOutcome",
      "captureException",
      "evidenceAsset",
      "fieldBatch",
      "fieldDayClose",
      "fieldObservation",
      "fieldRecoveryExport",
      "fieldReview",
      "fieldVisit",
      "followUpAssignment",
      "objectiveCoverage",
      "routeRun",
      "schemaGap",
      "sourceStatement",
      "statementTranslation",
    ]);

    for (const [kind, example] of examples) {
      const validation = validateFieldProtocolRecord(kind, example);
      expect(validation.success).toBe(true);
      if (validation.success) expect(validation.data).toEqual(example as typeof validation.data);
    }
  });

  test("governs local-hour windows and dispositions for all 19 Observation Kinds", () => {
    const kinds = baselineFieldProtocolPackage.observationKinds.kinds;
    expect(kinds).toHaveLength(19);
    expect(baselineFieldProtocolPackage.observationKinds.coverageSemantics).toEqual({
      windowIdentity: "local_hour",
      negativeEvidenceCountsTowardMinimumRecords: true,
    });

    for (const entry of kinds) {
      const rule = entry.coverageDisposition;
      if (rule.strategy === "constant") {
        expect(observationCoverageDisposition(entry.kind, {}), entry.kind).toBe(rule.value);
        continue;
      }
      for (const value of rule.positiveValues) {
        expect(
          observationCoverageDisposition(entry.kind, { [rule.path]: value }),
          `${entry.kind}:${value}`,
        ).toBe("positive");
      }
      for (const value of rule.negativeValues) {
        expect(
          observationCoverageDisposition(entry.kind, { [rule.path]: value }),
          `${entry.kind}:${value}`,
        ).toBe("negative");
      }
      for (const value of rule.unknownValues) {
        expect(
          observationCoverageDisposition(entry.kind, { [rule.path]: value }),
          `${entry.kind}:${value}`,
        ).toBe("unknown");
      }
      expect(observationCoverageDisposition(entry.kind, { [rule.path]: "not_governed" })).toBe(
        "unknown",
      );
      const dispositionProperty = (
        entry.valueSchema as unknown as {
          properties: Record<string, { enum?: readonly string[] }>;
        }
      ).properties[rule.path];
      const governedValues: string[] = [
        ...rule.positiveValues,
        ...rule.negativeValues,
        ...rule.unknownValues,
      ];
      expect(governedValues.sort(), `${entry.kind}:${rule.path}`).toEqual(
        [...(dispositionProperty?.enum ?? [])].sort(),
      );
    }

    for (const assignment of baselineFieldProtocolPackage.campaign.assignments) {
      for (const requirement of assignment.coverageRequirements) {
        expect(coverageWindowIdentityForRequirement(requirement)).toBe("local_hour");
      }
    }
    const examples = baselineFieldProtocolPackage.examples.examples;
    expect(examples.fieldVisit.captureWindows).toHaveLength(2);
    for (const record of [
      examples.fieldObservation,
      examples.routeRun,
      examples.sourceStatement,
      examples.evidenceAsset,
    ]) {
      expect(captureWindowIdsForRecord(record).length).toBeGreaterThan(0);
    }
    expect(
      validateFieldProtocolRecord("fieldObservation", {
        ...examples.fieldObservation,
        captureWindowIds: [],
      }).success,
    ).toBe(false);
    expect(
      validateFieldProtocolRecord("fieldVisit", {
        ...examples.fieldVisit,
        captureWindows: [],
      }).success,
    ).toBe(false);
  });

  test("validates canonical Recorder lifecycle records and recovery handoff states", () => {
    const examples = baselineFieldProtocolPackage.examples.examples;
    for (const kind of [
      "objectiveCoverage",
      "assignmentOutcome",
      "followUpAssignment",
      "fieldDayClose",
    ] as const) {
      expect(validateFieldProtocolRecord(kind, examples[kind]).success, kind).toBe(true);
    }
    expect(
      validateFieldProtocolRecord("fieldDayClose", {
        ...examples.fieldDayClose,
        recoveryStatus: "verified",
      }).success,
    ).toBe(true);
    expect(
      validateFieldProtocolRecord("fieldDayClose", {
        ...examples.fieldDayClose,
        recoveryStatus: "export_skipped",
      }).success,
    ).toBe(false);
    for (const reasonCode of [
      "invalid_capture_window_link",
      "invalid_permission_link",
      "invalid_asset_link",
    ] as const) {
      expect(
        validateFieldProtocolRecord("objectiveCoverage", {
          ...examples.objectiveCoverage,
          status: "needs_resolution",
          requirements: examples.objectiveCoverage.requirements.map((requirement) => ({
            ...requirement,
            status: "needs_resolution",
            reasonCodes: [reasonCode],
          })),
        }).success,
        reasonCode,
      ).toBe(true);
    }
  });

  test("validates active records against their exact pinned package instead of the baseline", () => {
    const pinnedPackage = structuredClone(baselineFieldProtocolPackage) as unknown as {
      manifest: { packageVersion: string };
    };
    pinnedPackage.manifest.packageVersion = "1.0.2";
    const record = {
      ...baselineFieldProtocolPackage.examples.examples.fieldObservation,
      protocolPackageVersion: "1.0.2",
    };

    expect(validateFieldProtocolRecord("fieldObservation", record).success).toBe(false);
    expect(
      validateFieldProtocolRecord("fieldObservation", record, {
        protocolPackage: pinnedPackage,
      }).success,
    ).toBe(true);
  });

  test("rejects Field Visit references outside the signed package and Assignment", () => {
    const example = baselineFieldProtocolPackage.examples.examples.fieldVisit;
    const invalidCases = [
      {
        candidate: {
          ...example,
          target: { kind: "governed_subject", subjectId: "subject_missing" },
        },
        code: "unknown_subject",
      },
      {
        candidate: {
          ...example,
          target: { kind: "governed_area", areaId: "area_missing" },
        },
        code: "unknown_area",
      },
      {
        candidate: {
          ...example,
          target: { kind: "governed_route", routeId: "route_missing" },
        },
        code: "unknown_route",
      },
      {
        candidate: {
          ...example,
          target: {
            kind: "provisional_subject",
            provisionalSubject: {
              id: "0192f060-4f41-7aa1-b322-4aa9fc9f1599",
              displayedName: "Unresolved place",
              category: "place",
              governedAreaId: "area_missing",
              distinguishingDetails: "An unresolved place outside the governed area registry.",
            },
          },
        },
        code: "unknown_area",
      },
      {
        candidate: {
          ...example,
          objectiveIds: ["objective_airport_traverse_arrival"],
        },
        code: "unknown_objective",
      },
    ];

    for (const invalidCase of invalidCases) {
      const validation = validateFieldProtocolRecord("fieldVisit", invalidCase.candidate);
      expect(validation.success, invalidCase.code).toBe(false);
      if (!validation.success) {
        expect(validation.issues.map((validationIssue) => validationIssue.code)).toContain(
          invalidCase.code,
        );
      }
    }
  });

  test("rejects governed Subjects and Method Profiles outside the signed package", () => {
    const examples = baselineFieldProtocolPackage.examples.examples;
    const invalidCases: Array<{
      kind: FieldProtocolRecordKind;
      candidate: unknown;
      code: string;
    }> = [
      {
        kind: "routeRun",
        candidate: { ...examples.routeRun, originSubjectId: "subject_missing" },
        code: "unknown_subject",
      },
      {
        kind: "routeRun",
        candidate: { ...examples.routeRun, destinationSubjectId: "subject_missing" },
        code: "unknown_subject",
      },
      {
        kind: "routeRun",
        candidate: { ...examples.routeRun, methodProfileId: "method_missing@1.0.0" },
        code: "unknown_method_profile",
      },
      {
        kind: "routeRun",
        candidate: { ...examples.routeRun, methodProfileId: "method_sound_meter@1.0.0" },
        code: "incompatible_method_profile",
      },
      {
        kind: "sourceStatement",
        candidate: { ...examples.sourceStatement, subjectId: "subject_missing" },
        code: "unknown_subject",
      },
      {
        kind: "schemaGap",
        candidate: {
          ...examples.schemaGap,
          subject: { kind: "governed", subjectId: "subject_missing" },
        },
        code: "unknown_subject",
      },
    ];

    for (const invalidCase of invalidCases) {
      const validation = validateFieldProtocolRecord(invalidCase.kind, invalidCase.candidate);
      expect(validation.success, `${invalidCase.kind}:${invalidCase.code}`).toBe(false);
      if (!validation.success) {
        expect(validation.issues.map((validationIssue) => validationIssue.code)).toContain(
          invalidCase.code,
        );
      }
    }
  });

  test("rejects valid package geography outside the record's Assignment", () => {
    const examples = baselineFieldProtocolPackage.examples.examples;
    const invalidCases: Array<{
      kind: FieldProtocolRecordKind;
      candidate: unknown;
      path: string;
    }> = [
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          target: { kind: "governed_subject", subjectId: "subject_area_general_luna" },
        },
        path: "target.subjectId",
      },
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          assignmentId: "assignment_del_carmen_boat",
          objectiveIds: ["objective_boat_attempt_booking"],
          target: { kind: "governed_subject", subjectId: "subject_area_del_carmen" },
        },
        path: "target.subjectId",
      },
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          assignmentId: "assignment_airport_arrival",
          objectiveIds: ["objective_airport_traverse_arrival"],
          target: {
            kind: "governed_subject",
            subjectId: "subject_del_carmen_departure_points",
          },
        },
        path: "target.subjectId",
      },
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          assignmentId: "assignment_del_carmen_boat",
          objectiveIds: ["objective_boat_attempt_booking"],
          target: { kind: "governed_area", areaId: "area_del_carmen" },
        },
        path: "target.areaId",
      },
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          assignmentId: "assignment_del_carmen_boat",
          objectiveIds: ["objective_boat_attempt_booking"],
          target: { kind: "governed_route", routeId: "route_airport_del_carmen" },
        },
        path: "target.routeId",
      },
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          assignmentId: "assignment_del_carmen_boat",
          objectiveIds: ["objective_boat_attempt_booking"],
          target: {
            kind: "provisional_subject",
            provisionalSubject: {
              id: "0192f060-4f41-7aa1-b322-4aa9fc9f1597",
              displayedName: "Unresolved departure point",
              category: "place",
              governedAreaId: "area_del_carmen",
              distinguishingDetails: "A same-area place that omits the principal access point.",
            },
          },
        },
        path: "target.provisionalSubject.governedAreaId",
      },
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          target: { kind: "governed_area", areaId: "area_general_luna" },
        },
        path: "target.areaId",
      },
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          target: { kind: "governed_route", routeId: "route_santa_monica_alegria" },
        },
        path: "target.routeId",
      },
      {
        kind: "fieldVisit",
        candidate: {
          ...examples.fieldVisit,
          target: {
            kind: "provisional_subject",
            provisionalSubject: {
              id: "0192f060-4f41-7aa1-b322-4aa9fc9f1598",
              displayedName: "Unresolved place",
              category: "place",
              governedAreaId: "area_general_luna",
              distinguishingDetails: "An unresolved place outside the Assignment geography.",
            },
          },
        },
        path: "target.provisionalSubject.governedAreaId",
      },
      {
        kind: "fieldObservation",
        candidate: {
          ...examples.fieldObservation,
          subject: { kind: "governed", subjectId: "subject_area_general_luna" },
        },
        path: "subject.subjectId",
      },
      {
        kind: "fieldObservation",
        candidate: {
          ...examples.fieldObservation,
          assignmentId: "assignment_airport_arrival",
          objectiveId: "objective_airport_observe_arrival_conditions",
          coverageRequirementId: "coverage_fare_basis",
          subject: {
            kind: "governed",
            subjectId: "subject_del_carmen_departure_points",
          },
        },
        path: "subject.subjectId",
      },
      {
        kind: "sourceStatement",
        candidate: { ...examples.sourceStatement, subjectId: "subject_area_general_luna" },
        path: "subjectId",
      },
      {
        kind: "sourceStatement",
        candidate: {
          ...examples.sourceStatement,
          assignmentId: "assignment_del_carmen_boat",
          objectiveId: "objective_boat_ask_policy",
          coverageRequirementId: "coverage_operating_policy_statement",
          subjectId: "subject_area_del_carmen",
        },
        path: "subjectId",
      },
      {
        kind: "schemaGap",
        candidate: {
          ...examples.schemaGap,
          subject: { kind: "governed", subjectId: "subject_area_general_luna" },
        },
        path: "subject.subjectId",
      },
      {
        kind: "schemaGap",
        candidate: {
          ...examples.schemaGap,
          assignmentId: "assignment_airport_arrival",
          objectiveId: "objective_airport_observe_arrival_conditions",
          coverageRequirementId: "coverage_access",
          subject: {
            kind: "governed",
            subjectId: "subject_del_carmen_departure_points",
          },
        },
        path: "subject.subjectId",
      },
      {
        kind: "routeRun",
        candidate: { ...examples.routeRun, originSubjectId: "subject_area_dapa" },
        path: "originSubjectId",
      },
      {
        kind: "routeRun",
        candidate: { ...examples.routeRun, destinationSubjectId: "subject_area_pilar" },
        path: "destinationSubjectId",
      },
      {
        kind: "routeRun",
        candidate: {
          ...examples.routeRun,
          assignmentId: "assignment_del_carmen_boat",
          objectiveId: "objective_boat_traverse_journey",
          coverageRequirementId: "coverage_boarding",
          originSubjectId: "subject_sayak_airport",
          destinationSubjectId: "subject_area_del_carmen",
        },
        path: "originSubjectId",
      },
    ];

    for (const invalidCase of invalidCases) {
      const validation = validateFieldProtocolRecord(invalidCase.kind, invalidCase.candidate);
      expect(validation.success, `${invalidCase.kind}:${invalidCase.path}`).toBe(false);
      if (!validation.success) {
        expect(validation.issues).toContainEqual(
          expect.objectContaining({
            code: "assignment_geography_mismatch",
            path: invalidCase.path,
          }),
        );
      }
    }
  });

  test("rejects nested Route Duration endpoints outside the package and Assignment", () => {
    const example = baselineFieldProtocolPackage.examples.examples.fieldObservation;
    const routeDurationObservation = {
      ...example,
      assignmentId: "assignment_airport_arrival",
      objectiveId: "objective_airport_traverse_arrival",
      coverageRequirementId: "coverage_route_time",
      subject: { kind: "governed", subjectId: "subject_route_airport_del_carmen" },
      observationKind: "route_duration",
      valueSchemaVersion: "1.0.0",
      value: {
        originSubjectId: "subject_sayak_airport",
        destinationSubjectId: "subject_area_del_carmen",
        transportMode: "van",
        durationSeconds: 2700,
      },
      methodProfileId: "method_timed_route@1.0.0",
    };

    for (const [path, subjectId, code] of [
      ["value.originSubjectId", "subject_missing", "unknown_subject"],
      ["value.destinationSubjectId", "subject_missing", "unknown_subject"],
      ["value.originSubjectId", "subject_area_dapa", "assignment_geography_mismatch"],
      ["value.destinationSubjectId", "subject_area_pilar", "assignment_geography_mismatch"],
    ] as const) {
      const endpoint = path.endsWith("originSubjectId")
        ? { originSubjectId: subjectId }
        : { destinationSubjectId: subjectId };
      const validation = validateFieldProtocolRecord("fieldObservation", {
        ...routeDurationObservation,
        value: { ...routeDurationObservation.value, ...endpoint },
      });
      expect(validation.success, path).toBe(false);
      if (!validation.success) {
        expect(validation.issues).toContainEqual(expect.objectContaining({ code, path }));
      }
    }

    const missingAccessPoint = validateFieldProtocolRecord("fieldObservation", {
      ...routeDurationObservation,
      assignmentId: "assignment_del_carmen_boat",
      objectiveId: "objective_boat_traverse_journey",
      coverageRequirementId: "coverage_boarding",
      subject: {
        kind: "governed",
        subjectId: "subject_del_carmen_departure_points",
      },
      value: {
        ...routeDurationObservation.value,
        originSubjectId: "subject_sayak_airport",
        destinationSubjectId: "subject_area_del_carmen",
      },
    });
    expect(missingAccessPoint.success).toBe(false);
    if (!missingAccessPoint.success) {
      expect(missingAccessPoint.issues).toContainEqual(
        expect.objectContaining({
          code: "assignment_geography_mismatch",
          path: "value.originSubjectId",
        }),
      );
    }
  });

  test("rejects Campaign and Objective references outside the signed Assignment graph", () => {
    const examples = baselineFieldProtocolPackage.examples.examples;
    const assignmentRecordKinds = [
      "captureException",
      "evidenceAsset",
      "fieldObservation",
      "fieldVisit",
      "routeRun",
      "schemaGap",
      "sourceStatement",
    ] as const;

    for (const kind of assignmentRecordKinds) {
      const example = examples[kind] as Record<string, unknown>;
      const unknownCampaign = validateFieldProtocolRecord(kind, {
        ...example,
        campaignId: "campaign_missing",
      });
      expect(unknownCampaign.success, `${kind}:unknown_campaign`).toBe(false);
      if (!unknownCampaign.success) {
        expect(unknownCampaign.issues.map((validationIssue) => validationIssue.code)).toContain(
          "unknown_campaign",
        );
      }

      const unknownAssignment = validateFieldProtocolRecord(kind, {
        ...example,
        assignmentId: "assignment_missing",
      });
      expect(unknownAssignment.success, `${kind}:unknown_assignment`).toBe(false);
      if (!unknownAssignment.success) {
        expect(unknownAssignment.issues.map((validationIssue) => validationIssue.code)).toContain(
          "unknown_assignment",
        );
      }
    }

    const singleObjectiveKinds = [
      "captureException",
      "fieldObservation",
      "routeRun",
      "schemaGap",
      "sourceStatement",
    ] as const;
    for (const kind of singleObjectiveKinds) {
      const validation = validateFieldProtocolRecord(kind, {
        ...examples[kind],
        objectiveId: "objective_missing",
      });
      expect(validation.success, `${kind}:unknown_objective`).toBe(false);
      if (!validation.success) {
        expect(validation.issues.map((validationIssue) => validationIssue.code)).toContain(
          "unknown_objective",
        );
      }
    }

    const unknownAssetObjective = validateFieldProtocolRecord("evidenceAsset", {
      ...examples.evidenceAsset,
      objectiveIds: [...examples.evidenceAsset.objectiveIds, "objective_missing"],
    });
    expect(unknownAssetObjective.success).toBe(false);
    if (!unknownAssetObjective.success) {
      expect(unknownAssetObjective.issues.map((validationIssue) => validationIssue.code)).toContain(
        "unknown_objective",
      );
    }
  });

  test("rejects Field Batch package and lineage references outside the signed package", () => {
    const example = baselineFieldProtocolPackage.examples.examples.fieldBatch;
    const declaredPackage = example.protocolPackages[0];
    const invalidCases = [
      {
        candidate: {
          ...example,
          protocolPackages: [{ ...declaredPackage, packageId: "field-protocol-missing" }],
        },
        code: "unknown_protocol_package",
      },
      {
        candidate: {
          ...example,
          protocolPackages: [{ ...declaredPackage, version: "9.9.9" }],
        },
        code: "protocol_package_mismatch",
      },
      {
        candidate: {
          ...example,
          protocolPackages: [
            {
              ...declaredPackage,
              componentVersions: { ...declaredPackage.componentVersions, subjects: "9.9.9" },
            },
          ],
        },
        code: "component_version_mismatch",
      },
      {
        candidate: {
          ...example,
          lineage: { ...example.lineage, campaignIds: ["campaign_missing"] },
        },
        code: "unknown_campaign",
      },
      {
        candidate: {
          ...example,
          lineage: { ...example.lineage, assignmentIds: ["assignment_missing"] },
        },
        code: "unknown_assignment",
      },
    ];

    for (const invalidCase of invalidCases) {
      const validation = validateFieldProtocolRecord("fieldBatch", invalidCase.candidate);
      expect(validation.success, invalidCase.code).toBe(false);
      if (!validation.success) {
        expect(validation.issues.map((validationIssue) => validationIssue.code)).toContain(
          invalidCase.code,
        );
      }
    }
  });

  test("binds every package-bearing record kind to the signed package identity", () => {
    const examples = baselineFieldProtocolPackage.examples.examples;
    const packageBearingRecordKinds = [
      "captureException",
      "evidenceAsset",
      "fieldObservation",
      "fieldReview",
      "fieldVisit",
      "routeRun",
      "schemaGap",
      "sourceStatement",
      "statementTranslation",
    ] as const;

    for (const kind of packageBearingRecordKinds) {
      const example = examples[kind] as Record<string, unknown>;
      for (const candidate of [
        { ...example, protocolPackageId: "field-protocol-missing" },
        { ...example, protocolPackageVersion: "9.9.9" },
      ]) {
        const validation = validateFieldProtocolRecord(kind, candidate);
        expect(validation.success, kind).toBe(false);
        if (!validation.success) {
          expect(validation.issues.map((validationIssue) => validationIssue.code)).toContain(
            "protocol_package_mismatch",
          );
        }
      }
    }
  });

  test("rejects placeholder kinds, arbitrary values, units, and condition tags", () => {
    const example = baselineFieldProtocolPackage.examples.examples.fieldObservation;
    const invalidCases = [
      { ...example, observationKind: "replace_with_controlled_kind" },
      { ...example, value: { ...example.value, amount: "TBD" } },
      { ...example, value: { ...example.value, arbitrary: { nested: true } } },
      { ...example, conditions: [...example.conditions, "whatever_the_researcher_types"] },
      {
        ...example,
        observationKind: "connectivity",
        value: {
          network: "Example network",
          deviceClass: "phone",
          zone: "outdoors",
          measurements: [
            { metric: "download", value: 12, unit: "Mbps" },
            { metric: "upload", value: 4, unit: "Mbps" },
            { metric: "latency", value: 40, unit: "ms" },
          ],
        },
        methodProfileId: "method_network_three_test@1.0.0",
        rawMeasurement: {
          id: "0192f060-4f41-7aa1-b322-4aa9fc9f1590",
          value: 12,
          unit: "bytes_per_vibe",
        },
      },
    ];

    for (const candidate of invalidCases) {
      expect(validateFieldProtocolRecord("fieldObservation", candidate).success).toBe(false);
    }

    expect(
      validateFieldProtocolRecord("routeRun", {
        ...baselineFieldProtocolPackage.examples.examples.routeRun,
        conditions: ["whatever_the_researcher_types"],
      }).success,
    ).toBe(false);
    expect(
      baselineFieldProtocolPackage.schemas.records.routeRun.properties.conditions.items.enum,
    ).toEqual(
      baselineFieldProtocolPackage.schemas.records.fieldObservation.properties.conditions.items
        .enum,
    );
  });

  test("requires exactly one governed or Provisional Subject and conversion lineage", () => {
    const example = baselineFieldProtocolPackage.examples.examples.fieldObservation;
    const mixedSubject = {
      ...example,
      subject: {
        kind: "governed",
        subjectId: "subject_area_del_carmen",
        provisionalSubjectId: "0192f060-4f41-7aa1-b322-4aa9fc9f1591",
      },
    };
    expect(validateFieldProtocolRecord("fieldObservation", mixedSubject).success).toBe(false);

    const badLineage = {
      ...example,
      observationKind: "route_duration",
      valueSchemaVersion: "1.0.0",
      value: {
        originSubjectId: "subject_sayak_airport",
        destinationSubjectId: "subject_area_del_carmen",
        transportMode: "van",
        durationSeconds: 2700,
      },
      methodProfileId: "method_timed_route@1.0.0",
      rawMeasurement: {
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1592",
        value: 2700,
        unit: "s",
      },
      normalizedMeasurement: {
        value: 2700,
        unit: "minutes",
        sourceRawMeasurementId: "0192f060-4f41-7aa1-b322-4aa9fc9f1593",
        conversionVersion: "1.0.0",
      },
    };
    const validation = validateFieldProtocolRecord("fieldObservation", badLineage);
    expect(validation.success).toBe(false);
    if (!validation.success) {
      expect(validation.issues.map((issue) => issue.code)).toContain("conversion_lineage_mismatch");
      expect(validation.issues.map((issue) => issue.code)).toContain("unit_not_allowed");
    }
  });

  test("links each observation to exactly one governed Coverage Requirement", () => {
    const example = baselineFieldProtocolPackage.examples.examples.fieldObservation;
    expect(
      validateFieldProtocolRecord("fieldObservation", {
        ...example,
        coverageRequirementId: ["coverage_payment", "coverage_food"],
      }).success,
    ).toBe(false);

    const unrelated = validateFieldProtocolRecord("fieldObservation", {
      ...example,
      coverageRequirementId: "coverage_offline_readiness",
    });
    expect(unrelated.success).toBe(false);
    if (!unrelated.success) {
      expect(unrelated.issues.map((issue) => issue.code)).toContain("unknown_coverage_requirement");
    }

    const wrongObjective = validateFieldProtocolRecord("fieldObservation", {
      ...example,
      objectiveId: "objective_del_carmen_ask_service_leads",
    });
    expect(wrongObjective.success).toBe(false);
    if (!wrongObjective.success) {
      expect(wrongObjective.issues.map((issue) => issue.code)).toContain(
        "coverage_objective_mismatch",
      );
    }

    const wrongKind = validateFieldProtocolRecord("fieldObservation", {
      ...example,
      observationKind: "facility",
      value: {
        facilityType: "toilet",
        state: "available",
        accessConditions: "Public access during operating hours.",
      },
      directness: "direct_observation",
      methodProfileId: "method_structured_visual_check@1.0.0",
      coverageRequirementId: "coverage_payment",
    });
    expect(wrongKind.success).toBe(false);
    if (!wrongKind.success) {
      expect(wrongKind.issues.map((issue) => issue.code)).toContain(
        "coverage_observation_kind_mismatch",
      );
    }

    for (const packageMismatch of [
      { ...example, protocolPackageId: "field-protocol-other" },
      { ...example, protocolPackageVersion: "9.9.9" },
    ]) {
      const validation = validateFieldProtocolRecord("fieldObservation", packageMismatch);
      expect(validation.success).toBe(false);
      if (!validation.success) {
        expect(validation.issues.map((issue) => issue.code)).toContain("protocol_package_mismatch");
      }
    }
  });

  test("keeps Source Statement translations separate and consent scopes independent", () => {
    const example = baselineFieldProtocolPackage.examples.examples.sourceStatement;
    const embeddedTranslation = {
      ...example,
      translation: { language: "fr", text: "Embedded translations are forbidden." },
    };
    expect(validateFieldProtocolRecord("sourceStatement", embeddedTranslation).success).toBe(false);

    const missingOriginal = { ...example, originalStatement: undefined };
    expect(validateFieldProtocolRecord("sourceStatement", missingOriginal).success).toBe(false);

    const independentConsent = {
      ...example,
      consents: {
        ...example.consents,
        publicUse: {
          decision: "granted",
          method: "written",
          recordedAt: "2026-08-22T09:15:00+08:00",
        },
      },
    };
    expect(validateFieldProtocolRecord("sourceStatement", independentConsent).success).toBe(true);

    const translation = baselineFieldProtocolPackage.examples.examples.statementTranslation;
    expect(validateFieldProtocolRecord("statementTranslation", translation).success).toBe(true);
    expect(
      validateFieldProtocolRecord("statementTranslation", {
        ...translation,
        sourceStatementId: undefined,
      }).success,
    ).toBe(false);
    expect(
      validateFieldProtocolRecord("statementTranslation", {
        ...translation,
        captureState: undefined,
      }).success,
    ).toBe(false);

    for (const kind of ["captureException", "schemaGap", "statementTranslation"] as const) {
      const original = baselineFieldProtocolPackage.examples.examples[kind];
      const correction = {
        ...original,
        id: "0192f060-4f41-7aa1-b322-4aa9fc9f1598",
        supersedesId: original.id,
      };
      expect(validateFieldProtocolRecord(kind, correction).success, kind).toBe(true);
    }
  });

  test("cannot confuse a Field Recovery Export with a Field Batch", () => {
    const recovery = baselineFieldProtocolPackage.examples.examples.fieldRecoveryExport;
    const batch = baselineFieldProtocolPackage.examples.examples.fieldBatch;

    expect(validateFieldProtocolRecord("fieldRecoveryExport", batch).success).toBe(false);
    expect(validateFieldProtocolRecord("fieldBatch", recovery).success).toBe(false);
    expect(
      validateFieldProtocolRecord("fieldRecoveryExport", {
        ...recovery,
        filename: batch.filename,
      }).success,
    ).toBe(false);
    expect(
      validateFieldProtocolRecord("fieldBatch", {
        ...batch,
        files: batch.files.map(({ sha256: _sha256, ...file }) => file),
      }).success,
    ).toBe(false);
    expect(
      validateFieldProtocolRecord("fieldBatch", {
        ...batch,
        recordCounts: { ...batch.recordCounts, fieldObservation: 2 },
      }).success,
    ).toBe(false);
  });
});

describe("baseline Field Protocol Package", () => {
  test("contains the controlled registry and unscheduled baseline campaign", () => {
    const kinds = baselineFieldProtocolPackage.observationKinds.kinds;
    expect(kinds).toHaveLength(19);
    expect(
      kinds.every(
        (kind) =>
          kind.valueSchemaVersion === "1.0.0" &&
          Array.isArray(kind.allowedUnits) &&
          kind.requiredContext.length > 0 &&
          kind.freshness.defaultReviewMinutes > 0,
      ),
    ).toBe(true);

    const campaignJson = JSON.stringify(baselineFieldProtocolPackage.campaign);
    expect(campaignJson).not.toMatch(/20\d{2}-\d{2}-\d{2}/);
    expect(baselineFieldProtocolPackage.campaign.assignments).toHaveLength(13);
    expect(
      baselineFieldProtocolPackage.campaign.assignments.every(
        (assignment) =>
          assignment.state === "unscheduled" &&
          assignment.eligibilityWindows.length > 0 &&
          assignment.partialCoverageSets.length > 0 &&
          assignment.safeFallbackAssignmentId.length > 0,
      ),
    ).toBe(true);
    expect(
      [
        ...new Set(
          baselineFieldProtocolPackage.campaign.assignments.flatMap((assignment) =>
            assignment.objectives.map((objective) => objective.action),
          ),
        ),
      ].sort(),
    ).toEqual(["ask", "attempt", "document", "measure", "observe", "repeat", "traverse"]);

    const home = baselineFieldProtocolPackage.campaign.assignments.find(
      (assignment) => assignment.id === "assignment_home_base_readiness",
    );
    expect(JSON.stringify(home)).toContain("offline_field_readiness");
    expect(JSON.stringify(home)).toContain("drinking_water");
    expect(JSON.stringify(home)).toContain("waste_disposal");
    expect(JSON.stringify(home)).toContain("food");

    const airport = baselineFieldProtocolPackage.campaign.assignments.find(
      (assignment) => assignment.id === "assignment_airport_arrival",
    );
    for (const requiredKind of [
      "route_wait",
      "price",
      "accessibility",
      "connectivity",
      "payment_method",
    ]) {
      expect(JSON.stringify(airport)).toContain(requiredKind);
    }

    const expectedCoverageRequirementLabels: Record<string, string[]> = {
      assignment_home_base_readiness: [
        "offline_readiness",
        "water",
        "power",
        "waste",
        "noise",
        "connectivity",
        "nearby_essentials",
      ],
      assignment_del_carmen_essentials: [
        "identity",
        "wayfinding",
        "cash",
        "payment",
        "pharmacy_clinic_leads",
        "fuel",
        "food",
        "toilets",
        "shade",
        "access",
        "connectivity",
        "opening",
      ],
      assignment_airport_arrival: [
        "pickup",
        "signage",
        "wait",
        "luggage",
        "fare_basis",
        "route_time",
        "access",
        "signal",
      ],
      assignment_general_luna_journey: [
        "arrival",
        "parking_dropoff",
        "wayfinding",
        "price_payment",
        "facilities",
        "access_barriers",
        "crowd",
        "connectivity",
      ],
      assignment_connectivity_transect: [
        "three_test_measurement_sets",
        "device_network_method",
        "power",
        "socket_permission",
        "noise",
        "seating",
      ],
      assignment_dapa_hub: [
        "port_journey",
        "luggage",
        "signs",
        "transport_transaction",
        "cash",
        "market",
        "health_leads",
        "fuel",
        "toilets",
        "shade",
        "access",
      ],
      assignment_south_central_corridor: [
        "route_segments",
        "surface",
        "stops",
        "access",
        "price",
        "facilities",
        "signal",
        "map_discrepancies",
      ],
      assignment_northbound_services: [
        "route_time",
        "road",
        "food",
        "fuel",
        "cash",
        "health_leads",
        "beach_access",
        "service",
        "remote_work_checks",
      ],
      assignment_santa_monica_alegria: [
        "full_route",
        "return_constraints",
        "transport_availability",
        "facilities",
        "cash",
        "fuel",
        "signal",
      ],
      assignment_pilar_access: [
        "tide_context",
        "route",
        "entrance",
        "paid_amount",
        "facilities",
        "surface",
        "access_state",
      ],
      assignment_del_carmen_boat: [
        "booking",
        "check_in",
        "wait",
        "price",
        "boarding",
        "transfers",
        "facilities",
        "operating_policy_statement",
      ],
      assignment_no_scooter_accessibility: [
        "booking_burden",
        "pickup",
        "fare",
        "transfers",
        "surfaces",
        "steps",
        "toilets",
        "shelter",
        "luggage_barriers",
      ],
      assignment_conflict_follow_up: [
        "volatile_price",
        "route",
        "opening",
        "connectivity",
        "provisional_identity",
        "contradiction",
      ],
    };
    expect(
      Object.fromEntries(
        baselineFieldProtocolPackage.campaign.assignments.map((assignment) => [
          assignment.id,
          assignment.coverageRequirements.map((requirement) => requirement.labelKey),
        ]),
      ) as Record<string, string[]>,
    ).toEqual(expectedCoverageRequirementLabels);
    for (const assignment of baselineFieldProtocolPackage.campaign.assignments) {
      const objectives = new Map(
        assignment.objectives.map((objective) => [objective.id, objective]),
      );
      expect(
        assignment.coverageRequirements.every((requirement) => {
          const objective = objectives.get(requirement.objectiveId);
          const objectiveObservationKinds: readonly string[] =
            objective && "observationKinds" in objective ? objective.observationKinds : [];
          const objectiveRecordKinds: readonly string[] =
            objective && "recordKinds" in objective ? objective.recordKinds : [];
          return (
            Boolean(objective) &&
            requirement.required &&
            requirement.minimumRecords > 0 &&
            requirement.supportingAsset.length > 0 &&
            requirement.repetition.minimumDistinctWindows > 0 &&
            requirement.admissibleRecordKinds.length > 0 &&
            requirement.admissibleObservationKinds.every((kind) =>
              objectiveObservationKinds.includes(kind),
            ) &&
            requirement.admissibleRecordKinds
              .filter((kind) => kind !== "field-observation.v1")
              .every((kind) => objectiveRecordKinds.includes(kind))
          );
        }),
      ).toBe(true);
    }
  });

  test("governs every campaign geography and migration mapping target", () => {
    const areaIds = new Set<string>(
      baselineFieldProtocolPackage.geography.areas.map((area) => area.id),
    );
    const routeIds = new Set<string>(
      baselineFieldProtocolPackage.geography.routes.map((route) => route.id),
    );
    const subjectIds = new Set<string>(
      baselineFieldProtocolPackage.subjects.subjects.map((subject) => subject.id),
    );
    for (const assignment of baselineFieldProtocolPackage.campaign.assignments) {
      const geography = assignment.geography as {
        areaId?: string;
        areaIds?: readonly string[];
        routeId?: string;
        originSubjectId?: string;
        destinationSubjectId?: string;
        subjectId?: string;
      };
      if (geography.areaId) expect(areaIds.has(geography.areaId)).toBe(true);
      for (const areaId of geography.areaIds ?? []) expect(areaIds.has(areaId)).toBe(true);
      if (geography.routeId) expect(routeIds.has(geography.routeId)).toBe(true);
      for (const subjectId of [
        geography.originSubjectId,
        geography.destinationSubjectId,
        geography.subjectId,
      ].filter((value): value is string => Boolean(value))) {
        expect(subjectIds.has(subjectId)).toBe(true);
      }
    }
    for (const route of baselineFieldProtocolPackage.geography.routes) {
      expect(subjectIds.has(route.subjectId)).toBe(true);
      expect(subjectIds.has(route.originSubjectId)).toBe(true);
      expect(subjectIds.has(route.destinationSubjectId)).toBe(true);
      expect(route.areaIds.every((areaId) => areaIds.has(areaId))).toBe(true);
    }

    const kinds = new Set(
      baselineFieldProtocolPackage.observationKinds.kinds.map((kind) => kind.kind),
    );
    const methods = new Set(
      baselineFieldProtocolPackage.methodProfiles.profiles.map((profile) => profile.id),
    );
    for (const mapping of baselineFieldProtocolPackage.migration.kindMappings) {
      expect(kinds.has(mapping.to)).toBe(true);
    }
    for (const mapping of baselineFieldProtocolPackage.migration.subjectMappings) {
      expect(subjectIds.has(mapping.to)).toBe(true);
    }
    for (const mapping of baselineFieldProtocolPackage.migration.methodMappings) {
      expect(methods.has(mapping.to)).toBe(true);
    }
  });

  test("verifies signature, integrity, compatibility, and migration declaration before activation", async () => {
    await expect(verifyFieldProtocolPackage({ applicationVersion: "0.1.0" })).resolves.toEqual({
      success: true,
      packageId: "field-protocol-siargao-baseline",
      packageVersion: "1.0.1",
      signerKeyId: "ask-siargao-field-protocol-2026-04",
    });

    const tampered = structuredClone(baselineFieldProtocolPackage) as unknown as {
      campaign: { name: string };
    };
    tampered.campaign.name = "Tampered campaign";
    const integrity = await verifyFieldProtocolPackage({
      applicationVersion: "0.1.0",
      bundle: tampered,
    });
    expect(integrity).toMatchObject({ success: false, code: "integrity_mismatch" });

    const unknownSigner = await verifyFieldProtocolPackage({
      applicationVersion: "0.1.0",
      trustedSigners: { signers: [] },
    });
    expect(unknownSigner).toMatchObject({ success: false, code: "unknown_signer" });

    const incomplete = structuredClone(baselineFieldProtocolPackage) as unknown as {
      manifest: { files: Array<{ path: string; sha256: string }> };
    };
    incomplete.manifest.files.pop();
    const incompleteIntegrity = await verifyFieldProtocolPackage({
      applicationVersion: "0.1.0",
      bundle: incomplete,
    });
    expect(incompleteIntegrity).toMatchObject({ success: false, code: "integrity_mismatch" });

    const incompatible = await verifyFieldProtocolPackage({ applicationVersion: "1.0.0" });
    expect(incompatible).toMatchObject({ success: false, code: "incompatible_application" });

    const missingMigration = structuredClone(baselineFieldProtocolPackage) as unknown as {
      manifest: Record<string, unknown>;
    };
    delete missingMigration.manifest.migrationDeclaration;
    const migrationDeclaration = await verifyFieldProtocolPackage({
      applicationVersion: "0.1.0",
      bundle: missingMigration,
    });
    expect(migrationDeclaration).toMatchObject({ success: false, code: "invalid_package" });

    const activation = await activateFieldProtocolPackage({
      applicationVersion: "0.1.0",
      activeWork: [
        {
          protocolPackageId: "field-protocol-siargao-baseline",
          protocolPackageVersion: "1.0.1",
        },
      ],
      installedBundles: [baselineFieldProtocolPackage],
    });
    expect(activation).toEqual({
      success: true,
      activePackage: {
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.1",
      },
      pinnedWork: [
        {
          protocolPackageId: "field-protocol-siargao-baseline",
          protocolPackageVersion: "1.0.1",
        },
      ],
    });

    const rejectedActivation = await activateFieldProtocolPackage({
      applicationVersion: "0.1.0",
      bundle: tampered,
    });
    expect(rejectedActivation).toMatchObject({ success: false, code: "integrity_mismatch" });
  });

  test("resolves active work through its exact verified pinned package", async () => {
    const laterPackage = structuredClone(baselineFieldProtocolPackage) as unknown as {
      manifest: { packageId: string; packageVersion: string };
    };
    laterPackage.manifest.packageVersion = "1.1.0";
    const resolved = await resolveProtocolForWork(
      {
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.1",
      },
      [laterPackage, baselineFieldProtocolPackage],
    );
    expect(resolved).toBe(baselineFieldProtocolPackage);
    await expect(
      resolveProtocolForWork(
        {
          protocolPackageId: "field-protocol-siargao-baseline",
          protocolPackageVersion: "0.8.0",
        },
        [baselineFieldProtocolPackage],
      ),
    ).rejects.toThrow("is not installed");

    const manifestOnly = { manifest: baselineFieldProtocolPackage.manifest };
    await expect(
      resolveProtocolForWork(
        {
          protocolPackageId: "field-protocol-siargao-baseline",
          protocolPackageVersion: "1.0.1",
        },
        [manifestOnly],
      ),
    ).rejects.toThrow("is not verified");
  });

  test("rejects authenticated migration declarations that disagree with the pinned migration", async () => {
    const mismatches: Array<{
      name: string;
      mutate: (bundle: TestFieldProtocolBundle) => void;
    }> = [
      {
        name: "migration strategy",
        mutate: (bundle) => {
          bundle.manifest.migrationDeclaration.strategy = "initial_install";
        },
      },
      {
        name: "migration ID",
        mutate: (bundle) => {
          bundle.manifest.migrationDeclaration.migrationIds = ["migration_other"];
        },
      },
      {
        name: "source package version",
        mutate: (bundle) => {
          bundle.manifest.migrationDeclaration.supportedFromVersions = ["0.8.0"];
        },
      },
      {
        name: "target package",
        mutate: (bundle) => {
          bundle.migration.targetProtocolPackageId = "field-protocol-other";
        },
      },
      {
        name: "target package version",
        mutate: (bundle) => {
          bundle.migration.toPackageVersion = "2.0.0";
        },
      },
      {
        name: "target campaign",
        mutate: (bundle) => {
          bundle.migration.targetCampaignId = "campaign_other";
        },
      },
      {
        name: "legacy observation route",
        mutate: (bundle) => {
          bundle.migration.legacyObservationRoutes[0].assignmentId = "assignment_missing";
        },
      },
      {
        name: "route objective observation kind",
        mutate: (bundle) => {
          const assignment = bundle.campaign.assignments.find(
            (candidate) => candidate.id === "assignment_del_carmen_essentials",
          );
          const objective = assignment?.objectives.find(
            (candidate) => candidate.id === "objective_del_carmen_observe_services",
          );
          if (!objective?.observationKinds) throw new Error("Test objective is missing.");
          objective.observationKinds = objective.observationKinds.filter(
            (kind) => kind !== "opening_signal",
          );
        },
      },
      {
        name: "route governed subject",
        mutate: (bundle) => {
          bundle.migration.subjectMappings[0].to = "subject_missing";
          bundle.migration.legacyObservationRoutes[0].subjectId = "subject_missing";
        },
      },
      {
        name: "route assignment geography",
        mutate: (bundle) => {
          bundle.migration.legacyObservationRoutes[1] = {
            subjectId: "subject_area_del_carmen",
            observationKind: "connectivity",
            assignmentId: "assignment_general_luna_journey",
            objectiveId: "objective_general_luna_repeat_crowd",
            coverageRequirementId: "coverage_connectivity",
          };
        },
      },
    ];

    for (const mismatch of mismatches) {
      const bundle = structuredClone(
        baselineFieldProtocolPackage,
      ) as unknown as TestFieldProtocolBundle;
      mismatch.mutate(bundle);
      const trustedSigners = authenticateTestBundle(bundle);

      const verification = await verifyFieldProtocolPackage({
        applicationVersion: "0.1.0",
        bundle,
        trustedSigners,
      });

      expect(verification, mismatch.name).toMatchObject({
        success: false,
        code: "invalid_package",
      });
    }
  });
});

describe("Protocol Migration preview", () => {
  test("migrates actual Legacy Capture shape and distinguishes ambiguity and failure", async () => {
    const visit = {
      schemaVersion: "field-record.v1",
      recordType: "visit",
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1522",
      clientBatchId: "0192f060-4f41-7aa1-b322-4aa9fc9f1521",
      campaignSlug: "island-baseline-2026",
      capturedAt: "2026-08-22T09:30:00+08:00",
      localTimezone: "Asia/Manila",
      observerKey: "legacy-researcher",
      entityId: "legacy_del_carmen",
      purposeCodes: ["guide_fact_check"],
      startedAt: "2026-08-22T09:30:00+08:00",
    };
    const source = {
      schemaVersion: "field-record.v1",
      recordType: "observation",
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1520",
      clientBatchId: "0192f060-4f41-7aa1-b322-4aa9fc9f1521",
      campaignSlug: "island-baseline-2026",
      capturedAt: "2026-08-22T09:32:00+08:00",
      localTimezone: "Asia/Manila",
      visitId: "0192f060-4f41-7aa1-b322-4aa9fc9f1522",
      observationKind: "opening_hours",
      directness: "direct_observation",
      observedAt: "2026-08-22T09:32:00+08:00",
      value: { state: "open", basis: "observed", postedHoursSeparatelyEvidenced: false },
      method: "structured_visual_check",
      conditionTags: ["weather_cloudy", "road_dry"],
      fieldConfidence: "high",
      reviewDueAt: "2026-08-29T09:32:00+08:00",
      status: "captured",
      llmUseAllowed: false,
      articleUseAllowed: false,
      publicRepublishAllowed: false,
    };
    const ambiguous = { ...source, observationKind: "free_text_observation" };
    const unsupported = { ...source, observationKind: "legacy_arbitrary_json" };
    const connectivity = {
      ...source,
      id: "0192f060-4f41-7aa1-b322-4aa9fc9f1523",
      observationKind: "internet_speed",
      method: "network_test",
      value: {
        network: "Example network",
        deviceClass: "phone",
        zone: "outdoors",
        measurements: [
          { metric: "download", value: 12, unit: "Mbps" },
          { metric: "upload", value: 4, unit: "Mbps" },
          { metric: "latency", value: 40, unit: "ms" },
        ],
      },
    };
    const preview = await previewProtocolMigration({
      records: [visit, source, connectivity, ambiguous, unsupported],
    });

    expect(preview.results.map((result) => result.status)).toEqual([
      "needs_resolution",
      "migrated",
      "migrated",
      "needs_resolution",
      "failed",
    ]);
    expect(preview.results[1]?.original).toEqual(source);
    expect(preview.results[1]?.migrated).toMatchObject({
      protocolPackageVersion: "1.0.1",
      assignmentId: "assignment_del_carmen_essentials",
      objectiveId: "objective_del_carmen_observe_services",
      coverageRequirementId: "coverage_opening",
      observationKind: "opening_signal",
      subject: { kind: "governed", subjectId: "subject_area_del_carmen" },
      methodProfileId: "method_structured_visual_check@1.0.0",
    });
    expect(preview.results[2]?.migrated).toMatchObject({
      observationKind: "connectivity",
      methodProfileId: "method_network_three_test@1.0.0",
    });
    expect(source.schemaVersion).toBe("field-record.v1");
    expect(source.observationKind).toBe("opening_hours");
  });

  test("refuses to execute a raw unsigned migration artifact", async () => {
    const migration = structuredClone(
      baselineFieldProtocolPackage.migration,
    ) as unknown as ProtocolMigration;
    migration.legacyObservationRoutes = [
      {
        subjectId: "subject_area_del_carmen",
        observationKind: "opening_signal",
        assignmentId: "assignment_general_luna_journey",
        objectiveId: "objective_general_luna_repeat_crowd",
        coverageRequirementId: "coverage_connectivity",
      },
    ];
    const input = { migration, records: [] } as unknown as Parameters<
      typeof previewProtocolMigration
    >[0];

    await expect(previewProtocolMigration(input)).rejects.toThrow(
      "Raw Protocol Migration artifacts cannot be previewed",
    );
  });
});

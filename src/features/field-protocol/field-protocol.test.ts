import { describe, expect, test } from "bun:test";

import {
  activateFieldProtocolPackage,
  baselineFieldProtocolPackage,
  type FieldProtocolRecordKind,
  previewProtocolMigration,
  resolveProtocolForWork,
  validateFieldProtocolRecord,
  verifyFieldProtocolPackage,
} from "@/features/field-protocol/field-protocol";

describe("canonical field protocol records", () => {
  test("validates every generated baseline example through its canonical schema", () => {
    const examples = Object.entries(baselineFieldProtocolPackage.examples.examples) as Array<
      [FieldProtocolRecordKind, unknown]
    >;

    expect(examples.map(([kind]) => kind).sort()).toEqual([
      "captureException",
      "evidenceAsset",
      "fieldBatch",
      "fieldObservation",
      "fieldRecoveryExport",
      "fieldReview",
      "fieldVisit",
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
  });

  test("verifies signature, integrity, compatibility, and migration declaration before activation", async () => {
    await expect(verifyFieldProtocolPackage({ applicationVersion: "0.1.0" })).resolves.toEqual({
      success: true,
      packageId: "field-protocol-siargao-baseline",
      packageVersion: "1.0.0",
      signerKeyId: "ask-siargao-field-protocol-2026-01",
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
          protocolPackageVersion: "1.0.0",
        },
      ],
      installedBundles: [baselineFieldProtocolPackage],
    });
    expect(activation).toEqual({
      success: true,
      activePackage: {
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
      },
      pinnedWork: [
        {
          protocolPackageId: "field-protocol-siargao-baseline",
          protocolPackageVersion: "1.0.0",
        },
      ],
    });

    const rejectedActivation = await activateFieldProtocolPackage({
      applicationVersion: "0.1.0",
      bundle: tampered,
    });
    expect(rejectedActivation).toMatchObject({ success: false, code: "integrity_mismatch" });
  });

  test("resolves active work through its exact pinned package", () => {
    const laterPackage = structuredClone(baselineFieldProtocolPackage) as unknown as {
      manifest: { packageId: string; packageVersion: string };
    };
    laterPackage.manifest.packageVersion = "1.1.0";
    const resolved = resolveProtocolForWork(
      {
        protocolPackageId: "field-protocol-siargao-baseline",
        protocolPackageVersion: "1.0.0",
      },
      [laterPackage, baselineFieldProtocolPackage],
    );
    expect(resolved).toBe(baselineFieldProtocolPackage);
    expect(() =>
      resolveProtocolForWork(
        {
          protocolPackageId: "field-protocol-siargao-baseline",
          protocolPackageVersion: "0.8.0",
        },
        [baselineFieldProtocolPackage],
      ),
    ).toThrow("is not installed");
  });
});

describe("Protocol Migration preview", () => {
  test("migrates actual Legacy Capture shape and distinguishes ambiguity and failure", () => {
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
    const preview = previewProtocolMigration({ records: [visit, source, ambiguous, unsupported] });

    expect(preview.results.map((result) => result.status)).toEqual([
      "needs_resolution",
      "migrated",
      "needs_resolution",
      "failed",
    ]);
    expect(preview.results[1]?.original).toEqual(source);
    expect(preview.results[1]?.migrated).toMatchObject({
      protocolPackageVersion: "1.0.0",
      observationKind: "opening_signal",
      subject: { kind: "governed", subjectId: "subject_area_del_carmen" },
      methodProfileId: "method_structured_visual_check@1.0.0",
    });
    expect(source.schemaVersion).toBe("field-record.v1");
    expect(source.observationKind).toBe("opening_hours");
  });
});

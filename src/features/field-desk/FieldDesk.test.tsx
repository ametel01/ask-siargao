import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import type {
  CaptureException,
  EvidenceAsset,
  RouteRun,
  SchemaGap,
  SourceStatement,
  StatementTranslation,
} from "@/features/field-protocol/generated";
import { exampleObservation, exampleVisit } from "@/features/field-recorder/test-fixtures";
import {
  availableFieldDeskDecisions,
  normalizeFieldDeskDecision,
  RecordSummary,
} from "./FieldDesk";
import type { FieldDeskWork } from "./field-desk-types";

const examples = baselineFieldProtocolPackage.examples.examples;

const work = {
  recorderWork: {
    assignments: [
      {
        assignmentId: exampleObservation.assignmentId,
        outcomeId: "outcome-1",
        status: "closed_with_gaps",
        unresolvedRequirementIds: [exampleObservation.coverageRequirementId],
        visitIds: [exampleVisit.id],
      },
    ],
    assignmentOutcomes: [
      {
        id: "outcome-1",
        assignmentId: exampleObservation.assignmentId,
        status: "closed_with_gaps",
        unresolvedRequirementIds: [exampleObservation.coverageRequirementId],
        followUpAssignmentIds: ["follow-up-1"],
      },
    ],
    objectiveCoverage: [
      {
        objectiveId: exampleObservation.objectiveId,
        sourceRecordIds: [exampleObservation.id],
        status: "needs_resolution",
        requirements: [
          {
            capturedRecordIds: [exampleObservation.id],
            capturedRecords: 1,
            coverageRequirementId: exampleObservation.coverageRequirementId,
            distinctWindowIds: [exampleObservation.captureWindowIds[0]],
            distinctWindows: 1,
            objectiveId: exampleObservation.objectiveId,
            reasonCodes: ["needs_more_evidence"],
            requiredDistinctWindows: 2,
            requiredRecords: 2,
            status: "needs_resolution",
            supportingAssetIds: [],
            supportingAssets: 0,
          },
        ],
      },
    ],
    records: [{ kind: "fieldVisit", value: exampleVisit }],
  },
} as unknown as FieldDeskWork;

describe("Field Desk record context", () => {
  test("shows actionable coverage, visit and provenance context for observations", () => {
    const html = renderToStaticMarkup(
      <RecordSummary
        record={{ kind: "fieldObservation", value: structuredClone(exampleObservation) }}
        work={work}
      />,
    );

    expect(html).toContain("Coverage status");
    expect(html).toContain("Assignment status");
    expect(html).toContain("Assignment outcome");
    expect(html).toContain("Objective status");
    expect(html).toContain("Captured / required");
    expect(html).toContain("Windows / required");
    expect(html).toContain("Visit started");
    expect(html).toContain("Protocol");
    expect(html).toContain("Researcher");
    expect(html).toContain("Rights");
    expect(html).toContain("Conflicts");
    expect(html).toContain("amount: 50");
    expect(html).toContain("currency: PHP");
    expect(html).toContain("item: Tricycle journey");
  });

  test.each([
    ["identity", { displayedName: "Governed clinic", rawOperatorNote: "do not render" }],
    ["opening_signal", { state: "open", rawOperatorNote: "do not render" }],
    ["local_caveat", { warning: "Road floods after rain", rawOperatorNote: "do not render" }],
  ])("shows decisive governed %s values without rendering unknown fields", (kind, value) => {
    const html = renderToStaticMarkup(
      <RecordSummary
        record={{
          kind: "fieldObservation",
          value: {
            ...structuredClone(exampleObservation),
            observationKind: kind,
            value,
          },
        }}
      />,
    );

    expect(html).toContain(String(Object.values(value)[0]));
    expect(html).not.toContain("rawOperatorNote");
    expect(html).not.toContain("do not render");
  });

  test("shows asset governance and source provenance without rendering opaque values", () => {
    const assetHtml = renderToStaticMarkup(
      <RecordSummary
        record={{
          kind: "evidenceAsset",
          value: structuredClone(examples.evidenceAsset) as unknown as EvidenceAsset,
        }}
      />,
    );
    const sourceHtml = renderToStaticMarkup(
      <RecordSummary
        record={{
          kind: "sourceStatement",
          value: structuredClone(examples.sourceStatement) as unknown as SourceStatement,
        }}
      />,
    );

    expect(assetHtml).toContain("Asset bytes");
    expect(assetHtml).toContain("Asset hash");
    expect(assetHtml).toContain("Asset purpose");
    expect(assetHtml).toContain("Redaction");
    expect(assetHtml).toContain("Retention");
    expect(sourceHtml).toContain("Source language");
    expect(sourceHtml).toContain("Question asked");
    expect(sourceHtml).toContain("Protected source statement");
    expect(sourceHtml).toContain("Participation consent");
    expect(sourceHtml).toContain("Public-use consent");
    expect(sourceHtml).toContain("Attribution");
    expect(sourceHtml).toContain(examples.sourceStatement.originalStatement);
  });

  test("shows current visit, route, and translation fields before typed correction", () => {
    const visitHtml = renderToStaticMarkup(
      <RecordSummary
        record={{
          kind: "fieldVisit",
          value: { ...structuredClone(exampleVisit), privateContextNote: "Original visit context" },
        }}
      />,
    );
    const routeHtml = renderToStaticMarkup(
      <RecordSummary
        record={{
          kind: "routeRun",
          value: structuredClone(examples.routeRun) as unknown as RouteRun,
        }}
      />,
    );
    const translationHtml = renderToStaticMarkup(
      <RecordSummary
        record={{
          kind: "statementTranslation",
          value: structuredClone(examples.statementTranslation) as unknown as StatementTranslation,
        }}
      />,
    );

    expect(visitHtml).toContain("Private visit context");
    expect(visitHtml).toContain("Original visit context");
    expect(routeHtml).toContain("Party context");
    expect(routeHtml).toContain(examples.routeRun.partyContext);
    expect(translationHtml).toContain("Translated text");
    expect(translationHtml).toContain(examples.statementTranslation.translatedText);
  });

  test("offers typed correction for every record kind and restricts unsupported follow-ups", () => {
    for (const kind of [
      "fieldVisit",
      "fieldObservation",
      "routeRun",
      "sourceStatement",
      "statementTranslation",
      "evidenceAsset",
      "captureException",
      "schemaGap",
    ] as const) {
      expect(availableFieldDeskDecisions(kind).map(([value]) => value)).toContain(
        "correct_by_supersession",
      );
    }
    expect(availableFieldDeskDecisions("fieldObservation").map(([value]) => value)).toContain(
      "needs_more_evidence",
    );
    expect(availableFieldDeskDecisions("captureException").map(([value]) => value)).not.toContain(
      "needs_more_evidence",
    );
    expect(normalizeFieldDeskDecision("schemaGap", "needs_more_evidence")).toBe("include");
    expect(normalizeFieldDeskDecision("fieldObservation", "correct_by_supersession")).toBe(
      "correct_by_supersession",
    );
  });

  test("renders identity-equivalent duplicate proposals as non-destructive review context", () => {
    const html = renderToStaticMarkup(
      <RecordSummary
        duplicateProposal={{
          candidateRecordId: exampleObservation.id,
          existingRecordId: "0192f060-4f41-7aa1-b322-4aa9fc9f1599",
          reason: "identity_equivalent",
        }}
        record={{ kind: "fieldObservation", value: structuredClone(exampleObservation) }}
      />,
    );

    expect(html).toContain("Duplicate proposal");
    expect(html).toContain("Identity-equivalent to 0192f060-4f41-7aa1-b322-4aa9fc9f1599");
    expect(html).toContain("retain both records until a reviewer records Include or Exclude");
  });

  test("shows capture exception and schema-gap blockers", () => {
    const exceptionHtml = renderToStaticMarkup(
      <RecordSummary
        record={{
          kind: "captureException",
          value: structuredClone(examples.captureException) as CaptureException,
        }}
      />,
    );
    const gapHtml = renderToStaticMarkup(
      <RecordSummary
        record={{ kind: "schemaGap", value: structuredClone(examples.schemaGap) as SchemaGap }}
      />,
    );

    expect(exceptionHtml).toContain("Exception reason");
    expect(exceptionHtml).toContain("Exception details");
    expect(gapHtml).toContain("Schema gap");
    expect(gapHtml).toContain("Schema gap resolution");
    expect(gapHtml).toContain("Schema gap location");
  });
});

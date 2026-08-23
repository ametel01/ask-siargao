import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { baselineFieldProtocolPackage } from "@/features/field-protocol/field-protocol";
import type {
  CaptureException,
  EvidenceAsset,
  SchemaGap,
  SourceStatement,
} from "@/features/field-protocol/generated";
import { exampleObservation, exampleVisit } from "@/features/field-recorder/test-fixtures";
import { RecordSummary } from "./FieldDesk";
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
    expect(sourceHtml).toContain("Participation consent");
    expect(sourceHtml).toContain("Public-use consent");
    expect(sourceHtml).toContain("Attribution");
    expect(sourceHtml).not.toContain(examples.sourceStatement.originalStatement);
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

import { describe, expect, test } from "bun:test";

import { createEvidenceBundle } from "@/server/audit/evidence-bundles";
import { validateReportForPublication } from "@/server/audit/report-validation";
import { sampleReport } from "@/server/audit/sample-report";
import type { IntakeInput } from "@/server/audit/schemas";
import type { GovernedEvidence, GovernedFact } from "@/server/facts/types";
import { type ResponsesClient, generateAuditReport } from "@/server/llm/openai-adapter";
import {
  callAuditRetrievalTool,
  permittedFacts,
  runControlledRetrievalPlan,
} from "@/server/llm/retrieval-tools";
import { reviewAuditReport, reviewerAllowsPublication } from "@/server/llm/reviewer";

const now = new Date("2026-06-23T08:00:00.000Z");

const intake: IntakeInput = {
  travelMonth: "2026-08",
  arrivalOrigin: "Manila",
  accommodationName: "Example Surf Stay",
  stayAreaSlug: "general-luna",
  topConstraint: "quiet sleep",
  optionalModules: [],
  travelerContext: { riskTolerance: "low_risk" },
};

const facts: GovernedFact[] = [
  {
    id: "fact_route",
    entityId: "route_surigao_to_dapa",
    claim: "Last ferry departs at 15:30.",
    factType: "route_schedule",
    fetchedAt: "2026-06-23T00:00:00.000Z",
    expiresAt: "2026-06-24T00:00:00.000Z",
    sourceProfileId: "source_official_transport",
    sourceRecordId: "record_official_transport",
    sourceType: "official",
    allowedUse: "citation_only",
    confidenceLabel: "high",
    sourceAuthority: 5,
    publicRepublishAllowed: false,
    auditUseAllowed: true,
    rawEvidenceAllowed: false,
  },
  {
    id: "fact_accommodation",
    entityId: "accommodation_example_surf_stay",
    claim: "Example Surf Stay is in General Luna.",
    factType: "area",
    fetchedAt: "2026-06-23T00:00:00.000Z",
    expiresAt: "2026-06-24T00:00:00.000Z",
    sourceProfileId: "source_user_submitted",
    sourceRecordId: "record_accommodation",
    sourceType: "user_submitted",
    allowedUse: "audit_only",
    confidenceLabel: "medium",
    sourceAuthority: 2,
    publicRepublishAllowed: false,
    auditUseAllowed: true,
    rawEvidenceAllowed: false,
  },
  {
    id: "fact_disallowed",
    claim: "Private listing review claims a perfect stay.",
    factType: "review_theme",
    fetchedAt: "2026-06-23T00:00:00.000Z",
    sourceProfileId: "source_private_scrape",
    sourceRecordId: "record_private_review",
    sourceType: "permitted_public_web",
    allowedUse: "disallowed",
    confidenceLabel: "low",
    sourceAuthority: 1,
    publicRepublishAllowed: false,
    auditUseAllowed: false,
    rawEvidenceAllowed: false,
  },
];

const evidence: GovernedEvidence[] = [
  {
    id: "ev_route",
    factId: "fact_route",
    sourceRecordId: "Official transport source",
    label: "Official ferry schedule",
    allowedUse: "citation_only",
    publicRepublishAllowed: false,
  },
  {
    id: "ev_accommodation",
    factId: "fact_accommodation",
    sourceRecordId: "User submitted accommodation evidence",
    label: "Accommodation area evidence",
    allowedUse: "audit_only",
    publicRepublishAllowed: false,
  },
];

const evidenceBundle = createEvidenceBundle({
  id: "bundle_private_report",
  visibility: "private_report",
  facts,
  evidence,
});

describe("controlled LLM retrieval tools", () => {
  test("filters unsupported provider data before model context", () => {
    expect(
      permittedFacts({ input: intake, facts, evidenceBundle, maxToolCalls: 4 }).map(
        (fact) => fact.id,
      ),
    ).toEqual(["fact_route", "fact_accommodation"]);

    const result = callAuditRetrievalTool({
      context: { input: intake, facts, evidenceBundle, maxToolCalls: 4 },
      toolName: "reviews",
    });

    expect(JSON.stringify(result.resultJson)).not.toContain("Private listing");
  });

  test("rejects unsupported tools and over-budget retrieval plans", () => {
    expect(() =>
      callAuditRetrievalTool({
        context: { input: intake, facts, evidenceBundle, maxToolCalls: 4 },
        toolName: "scrape_private_listing",
      }),
    ).toThrow("Unsupported audit retrieval tool");

    expect(() =>
      runControlledRetrievalPlan({
        context: { input: intake, facts, evidenceBundle, maxToolCalls: 1 },
        requestedTools: ["user_constraints", "route_risks"],
      }),
    ).toThrow("tool budget exceeded");
  });

  test("scopes returned evidence IDs to the facts selected by each tool", () => {
    const context = { input: intake, facts, evidenceBundle, maxToolCalls: 4 };
    const routeRisks = callAuditRetrievalTool({
      context,
      toolName: "route_risks",
    });
    const accommodationFacts = callAuditRetrievalTool({
      context,
      toolName: "accommodation_facts",
    });

    expect(routeRisks.evidenceIds).toEqual(["ev_route"]);
    expect(accommodationFacts.evidenceIds).toEqual(["ev_accommodation"]);
    expect(routeRisks.evidenceIds).not.toContain("ev_accommodation");
    expect(accommodationFacts.evidenceIds).not.toContain("ev_route");
  });
});

describe("OpenAI report generation and reviewer pass", () => {
  test("generates a structured report from mocked Responses output", async () => {
    let request: Record<string, unknown> | undefined;
    const client: ResponsesClient = {
      responses: {
        create: async (params) => {
          request = params;
          return { output_text: JSON.stringify(sampleReport) };
        },
      },
    };

    const result = await generateAuditReport({
      auditRequestId: "audit_123",
      intake,
      facts,
      evidenceBundle,
      client,
      now,
    });

    expect(result.report.overallRisk).toBe("yellow");
    expect(result.llmRun.toolCalls.map((call) => call.toolName)).toContain("route_risks");
    expect(JSON.stringify(request)).toContain("json_schema");
    expect(JSON.stringify(request)).toContain(
      "Use only claims returned by the controlled tool calls.",
    );
  });

  test("blocks generation when deterministic validators reject the mocked report", async () => {
    const client: ResponsesClient = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            ...sampleReport,
            evidence: [{ ...sampleReport.evidence[0], evidenceId: "missing_evidence" }],
          }),
        }),
      },
    };

    await expect(
      generateAuditReport({
        auditRequestId: "audit_123",
        intake,
        facts,
        evidenceBundle,
        client,
        now,
      }),
    ).rejects.toThrow("deterministic validation");
  });

  test("reviewer can approve, force revision, or block invalid reports", async () => {
    const validation = validateReportForPublication({
      report: sampleReport,
      evidenceBundle,
      facts,
      paymentState: "paid",
      accommodationName: "Example Surf Stay",
      now,
    });
    const revisionClient: ResponsesClient = {
      responses: {
        create: async () => ({
          output_text: JSON.stringify({
            verdict: "needs_revision",
            corrections: ["Clarify stale weather caveat."],
            blockedReasons: [],
            checks: {
              citationSupport: true,
              overclaims: true,
              staleCaveats: false,
              travelerRelevance: true,
              missingCriticalRisks: true,
              toneClarity: true,
              ratingRationale: true,
            },
          }),
        }),
      },
    };

    const revision = await reviewAuditReport({
      report: sampleReport,
      evidenceBundle,
      facts,
      deterministicValidation: validation,
      client: revisionClient,
    });
    const blocked = await reviewAuditReport({
      report: sampleReport,
      evidenceBundle,
      facts,
      deterministicValidation: { valid: false, errors: ["evidence:missing"], report: sampleReport },
    });

    expect(revision.verdict).toBe("needs_revision");
    expect(reviewerAllowsPublication(revision)).toBe(false);
    expect(blocked.verdict).toBe("blocked");
    expect(blocked.blockedReasons).toContain("deterministic_validator_failed");
  });
});

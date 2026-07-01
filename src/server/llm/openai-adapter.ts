import OpenAI from "openai";

import type { EvidenceBundle } from "@/server/audit/evidence-bundles";
import { validateReportForPublication } from "@/server/audit/report-validation";
import { type IntakeInput, type ReportOutput, reportOutputSchema } from "@/server/audit/schemas";
import type { GovernedFact } from "@/server/facts/types";
import {
  type AuditRetrievalToolName,
  type AuditToolCallRecord,
  runControlledRetrievalPlan,
} from "@/server/llm/retrieval-tools";

export type ResponsesClient = {
  responses: {
    create: (params: Record<string, unknown>) => Promise<{ output_text?: string }>;
  };
};

export type GeneratedAuditReport = {
  report: ReportOutput;
  llmRun: {
    id: string;
    model: string;
    status: "completed";
    toolCalls: AuditToolCallRecord[];
  };
};

export function createOpenAIResponsesClient(apiKey = process.env.OPENAI_API_KEY): ResponsesClient {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for OpenAI report generation.");
  }

  return new OpenAI({ apiKey }) as ResponsesClient;
}

export async function generateAuditReport(input: {
  auditRequestId: string;
  intake: IntakeInput;
  facts: readonly GovernedFact[];
  evidenceBundle: EvidenceBundle;
  requestedTools?: readonly AuditRetrievalToolName[];
  model?: string;
  client?: ResponsesClient;
  now?: Date;
}): Promise<GeneratedAuditReport> {
  const model = input.model ?? process.env.OPENAI_MODEL ?? "gpt-5.4-mini";
  const toolCalls = runControlledRetrievalPlan({
    context: {
      input: input.intake,
      facts: input.facts,
      evidenceBundle: input.evidenceBundle,
      maxToolCalls: 8,
    },
    requestedTools: input.requestedTools ?? [
      "user_constraints",
      "route_risks",
      "weather",
      "accommodation_facts",
      "policy_facts",
      "source_credibility",
    ],
  });
  const client = input.client ?? createOpenAIResponsesClient();
  const response = await client.responses.create({
    model,
    store: false,
    max_output_tokens: 4_000,
    instructions: generatorInstructions,
    input: JSON.stringify({
      auditRequestId: input.auditRequestId,
      intake: input.intake,
      evidence: input.evidenceBundle.evidence,
      toolCalls,
      constraints: [
        "Use only claims returned by the controlled tool calls.",
        "Every important factual claim must cite evidence IDs already in the evidence bundle.",
        "Write uncertainty and limitations plainly. Do not add generic itinerary filler.",
      ],
    }),
    text: {
      format: {
        type: "json_schema",
        name: "siargao_trip_risk_audit_report",
        schema: reportJsonSchema,
        strict: false,
      },
    },
  });
  const report = parseReportOutput(response.output_text);
  const validation = validateReportForPublication({
    report,
    evidenceBundle: input.evidenceBundle,
    facts: input.facts,
    paymentState: "paid",
    accommodationName: input.intake.accommodationName,
    now: input.now ?? new Date(),
  });

  if (!validation.valid || !validation.report) {
    throw new Error(
      `Generated report failed deterministic validation: ${validation.errors.join("; ")}`,
    );
  }

  return {
    report: validation.report,
    llmRun: {
      id: `llm_run_${input.auditRequestId}`,
      model,
      status: "completed",
      toolCalls,
    },
  };
}

function parseReportOutput(outputText: string | undefined) {
  if (!outputText) {
    throw new Error("OpenAI response did not include output_text.");
  }

  return reportOutputSchema.parse(JSON.parse(outputText));
}

const generatorInstructions = [
  "Generate a paid Siargao trip risk audit as structured JSON.",
  "Do not use unsupported provider data, uncited facts, scraped private listings, or raw restricted evidence.",
  "Prefer evidence-backed specificity over broad travel advice.",
  "Expose uncertainty, freshness gaps, and user follow-up questions.",
].join("\n");

const reportJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "overallRisk",
    "confidenceSummary",
    "sourceQualitySummary",
    "topRisks",
    "fullRiskTable",
    "accommodationAssessment",
    "areaFitAssessment",
    "logisticsNotes",
    "weatherSeasonalityNotes",
    "internetPowerAssessment",
    "transportNotes",
    "cashSimServiceNotes",
    "healthSafetyAdminNotes",
    "officialAccreditationNotes",
    "eventClosureFeeNotes",
    "recommendedFixes",
    "hostQuestions",
    "evidence",
    "evidenceFreshnessNotes",
    "limitations",
  ],
  properties: {
    overallRisk: { enum: ["green", "yellow", "red"] },
    confidenceSummary: { type: "string" },
    sourceQualitySummary: { type: "string" },
    topRisks: { type: "array" },
    fullRiskTable: { type: "array" },
    accommodationAssessment: { type: "string" },
    areaFitAssessment: { type: "string" },
    logisticsNotes: { type: "string" },
    weatherSeasonalityNotes: { type: "string" },
    internetPowerAssessment: { type: "string" },
    transportNotes: { type: "string" },
    cashSimServiceNotes: { type: "string" },
    healthSafetyAdminNotes: { type: "string" },
    officialAccreditationNotes: { type: "string" },
    eventClosureFeeNotes: { type: "string" },
    recommendedFixes: { type: "array", items: { type: "string" } },
    hostQuestions: { type: "array", items: { type: "string" } },
    evidence: { type: "array" },
    evidenceFreshnessNotes: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
  },
};

import { z } from "zod";

import type { EvidenceBundle } from "@/server/audit/evidence-bundles";
import type { ReportValidationResult } from "@/server/audit/report-validation";
import type { ReportOutput } from "@/server/audit/schemas";
import type { GovernedFact } from "@/server/facts/types";
import { createOpenAIResponsesClient, type ResponsesClient } from "@/server/llm/openai-adapter";

const reviewerResultSchema = z.object({
  verdict: z.enum(["approved", "needs_revision", "blocked"]),
  corrections: z.array(z.string()).default([]),
  blockedReasons: z.array(z.string()).default([]),
  checks: z.object({
    citationSupport: z.boolean(),
    overclaims: z.boolean(),
    staleCaveats: z.boolean(),
    travelerRelevance: z.boolean(),
    missingCriticalRisks: z.boolean(),
    toneClarity: z.boolean(),
    ratingRationale: z.boolean(),
  }),
});

export type ReviewerResult = z.infer<typeof reviewerResultSchema>;

export async function reviewAuditReport(input: {
  report: ReportOutput;
  evidenceBundle: EvidenceBundle;
  facts: readonly GovernedFact[];
  deterministicValidation: ReportValidationResult;
  client?: ResponsesClient;
  model?: string;
}): Promise<ReviewerResult> {
  if (!input.deterministicValidation.valid) {
    return {
      verdict: "blocked",
      corrections: input.deterministicValidation.errors,
      blockedReasons: ["deterministic_validator_failed"],
      checks: failedChecks(),
    };
  }

  const client = input.client ?? createOpenAIResponsesClient();
  const response = await client.responses.create({
    model: input.model ?? process.env.OPENAI_REVIEWER_MODEL ?? "gpt-5.4-mini",
    store: false,
    max_output_tokens: 1_500,
    instructions: reviewerInstructions,
    input: JSON.stringify({
      report: input.report,
      evidence: input.evidenceBundle.evidence,
      factIds: input.facts.map((fact) => fact.id),
      requiredChecks: Object.keys(failedChecks()),
    }),
    text: {
      format: {
        type: "json_schema",
        name: "siargao_trip_risk_audit_reviewer_result",
        schema: reviewerJsonSchema,
        strict: false,
      },
    },
  });

  if (!response.output_text) {
    throw new Error("Reviewer response did not include output_text.");
  }

  return reviewerResultSchema.parse(JSON.parse(response.output_text));
}

export function reviewerAllowsPublication(result: ReviewerResult) {
  return result.verdict === "approved" && result.blockedReasons.length === 0;
}

function failedChecks() {
  return {
    citationSupport: false,
    overclaims: false,
    staleCaveats: false,
    travelerRelevance: false,
    missingCriticalRisks: false,
    toneClarity: false,
    ratingRationale: false,
  };
}

const reviewerInstructions = [
  "Review the generated Siargao trip risk audit.",
  "Block reports with uncited factual claims, overclaims, stale critical facts without caveats, missing critical risks, unclear uncertainty, or weak rating rationale.",
  "Return only structured JSON.",
].join("\n");

const reviewerJsonSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "corrections", "blockedReasons", "checks"],
  properties: {
    verdict: { enum: ["approved", "needs_revision", "blocked"] },
    corrections: { type: "array", items: { type: "string" } },
    blockedReasons: { type: "array", items: { type: "string" } },
    checks: {
      type: "object",
      additionalProperties: false,
      required: [
        "citationSupport",
        "overclaims",
        "staleCaveats",
        "travelerRelevance",
        "missingCriticalRisks",
        "toneClarity",
        "ratingRationale",
      ],
      properties: {
        citationSupport: { type: "boolean" },
        overclaims: { type: "boolean" },
        staleCaveats: { type: "boolean" },
        travelerRelevance: { type: "boolean" },
        missingCriticalRisks: { type: "boolean" },
        toneClarity: { type: "boolean" },
        ratingRationale: { type: "boolean" },
      },
    },
  },
};

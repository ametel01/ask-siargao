import type { EvidenceBundle } from "@/server/audit/evidence-bundles";
import {
  classifyFactFreshnessForReport,
  isLowConfidenceConsequentialRisk,
  missingMandatoryRiskCategories,
  reportHasStaleNonCriticalCaveat,
} from "@/server/audit/risk-policy";
import { type ReportOutput, type RiskItem, reportOutputSchema } from "@/server/audit/schemas";
import type { GovernedFact } from "@/server/facts/types";

export type ReportPaymentState = "unpaid" | "paid" | "refunded";

export type ReportValidationInput = {
  report: unknown;
  evidenceBundle: EvidenceBundle;
  facts: readonly GovernedFact[];
  paymentState: ReportPaymentState;
  accommodationName?: string;
  now: Date;
};

export type ReportValidationResult = {
  valid: boolean;
  errors: string[];
  report?: ReportOutput;
};

export function validateReportForPublication(input: ReportValidationInput): ReportValidationResult {
  const errors: string[] = [];
  const parsed = reportOutputSchema.safeParse(input.report);

  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `schema:${issue.path.join(".")}:${issue.message}`),
    };
  }

  if (input.paymentState !== "paid") {
    errors.push("payment:report cannot unlock before verified payment.");
  }

  const report = parsed.data;
  const bundleEvidenceIds = new Set(
    input.evidenceBundle.evidence.map((evidence) => evidence.evidenceId),
  );
  const factIds = new Set(input.facts.map((fact) => fact.id));
  for (const category of missingMandatoryRiskCategories(report.fullRiskTable)) {
    errors.push(`category:${category}:missing mandatory report category.`);
  }

  for (const risk of report.fullRiskTable) {
    validateRisk(risk, bundleEvidenceIds, errors);
  }
  for (const risk of report.topRisks) {
    validateRisk(risk, bundleEvidenceIds, errors);
  }
  for (const evidence of report.evidence) {
    if (!bundleEvidenceIds.has(evidence.evidenceId)) {
      errors.push(`evidence:${evidence.evidenceId}:not in bundle.`);
    }
  }

  for (const fact of input.facts) {
    const freshness = classifyFactFreshnessForReport(fact, input.now);
    if (freshness === "stale_critical") {
      errors.push(`freshness:${fact.id}:critical fact is stale.`);
    } else if (freshness === "stale_non_critical") {
      if (!reportHasStaleNonCriticalCaveat(report)) {
        errors.push(`freshness:${fact.id}:stale non-critical fact needs a caveat.`);
      }
    }
    if (!factIds.has(fact.id)) {
      errors.push(`fact:${fact.id}:missing from fact set.`);
    }
  }

  if (
    input.accommodationName &&
    report.accommodationAssessment.toLowerCase().includes(input.accommodationName.toLowerCase()) &&
    !report.evidence.some((evidence) => evidence.label.toLowerCase().includes("accommodation"))
  ) {
    errors.push("citation:accommodation assessment names the stay without accommodation evidence.");
  }

  for (const risk of [...report.topRisks, ...report.fullRiskTable]) {
    if (isLowConfidenceConsequentialRisk(risk)) {
      errors.push(`confidence:${risk.id}:low-confidence source supports consequential claim.`);
    }
  }

  if (
    input.evidenceBundle.visibility === "public" &&
    input.evidenceBundle.restrictedEvidenceIds.length > 0
  ) {
    errors.push("visibility:public bundle contains restricted evidence.");
  }

  return { valid: errors.length === 0, errors, report };
}

function validateRisk(risk: RiskItem, evidenceIds: ReadonlySet<string>, errors: string[]) {
  if (!risk.whatMightBreak || !risk.whyItMatters || !risk.recommendedFix) {
    errors.push(`risk:${risk.id}:missing required risk explanation fields.`);
  }
  for (const evidence of risk.evidence) {
    if (!evidenceIds.has(evidence.evidenceId)) {
      errors.push(`risk:${risk.id}:invalid evidence ${evidence.evidenceId}.`);
    }
  }
}

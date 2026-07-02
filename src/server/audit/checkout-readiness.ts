import {
  type AccommodationResolution,
  resolveAccommodation,
} from "@/server/audit/accommodation-resolution";
import {
  type CompletenessGateResult,
  evaluateCompleteness,
} from "@/server/audit/completeness-gate";
import type { OptionalRiskModule } from "@/server/audit/enums";
import type { EvidenceReference, IntakeInput, RiskItem } from "@/server/audit/schemas";

export type AuditCheckoutReadinessDecision = {
  status: "ready_for_payment" | "needs_user_input";
  checkoutEligible: boolean;
  blockingReasons: string[];
  requiredUserFollowups: string[];
  previewRisk?: RiskItem;
  evidenceSummary: EvidenceReference[];
  activatedModules: OptionalRiskModule[];
  targetedRefreshHooks: string[];
  diagnostics: {
    accommodation: {
      status: AccommodationResolution["status"];
      sourceProfileId?: string;
      sourceConfidence?: AccommodationResolution["sourceConfidence"];
      factIds: string[];
    };
    blockingReasonCount: number;
    completenessPassed: boolean;
  };
};

export function decideAuditCheckoutReadiness(input: IntakeInput): AuditCheckoutReadinessDecision {
  const accommodation = resolveAccommodation(input);
  const completeness = evaluateCompleteness(input, accommodation);

  return buildCheckoutReadinessDecision(accommodation, completeness);
}

function buildCheckoutReadinessDecision(
  accommodation: AccommodationResolution,
  completeness: CompletenessGateResult,
): AuditCheckoutReadinessDecision {
  return {
    status: completeness.checkoutEligible ? "ready_for_payment" : "needs_user_input",
    checkoutEligible: completeness.checkoutEligible,
    blockingReasons: completeness.blockingReasons,
    requiredUserFollowups: completeness.requiredUserFollowups,
    ...(completeness.previewRisk ? { previewRisk: completeness.previewRisk } : {}),
    evidenceSummary: completeness.evidenceSummary,
    activatedModules: completeness.activatedModules,
    targetedRefreshHooks: completeness.targetedRefreshHooks,
    diagnostics: {
      accommodation: {
        status: accommodation.status,
        sourceProfileId: accommodation.sourceProfileId,
        sourceConfidence: accommodation.sourceConfidence,
        factIds: accommodation.factIds,
      },
      blockingReasonCount: completeness.blockingReasons.length,
      completenessPassed: completeness.canComplete,
    },
  };
}

import { randomUUID } from "node:crypto";

import {
  type AccommodationResolution,
  resolveAccommodation,
} from "@/server/audit/accommodation-resolution";
import {
  type CompletenessGateResult,
  evaluateCompleteness,
} from "@/server/audit/completeness-gate";
import { type IntakeInput, intakeInputSchema } from "@/server/audit/schemas";

export type AuditIntakeResult = {
  auditRequest: {
    id: string;
    status: "complete_for_payment" | "needs_user_input";
    priceUsd: 9.99;
  };
  auditInput: IntakeInput & {
    id: string;
    auditRequestId: string;
  };
  accommodationResolution: AccommodationResolution;
  completeness: CompletenessGateResult;
};

export function createAuditIntake(rawInput: unknown): AuditIntakeResult {
  const input = intakeInputSchema.parse(rawInput);
  const accommodationResolution = resolveAccommodation(input);
  const completeness = evaluateCompleteness(input, accommodationResolution);
  const auditRequestId = `audit_${randomUUID()}`;

  return {
    auditRequest: {
      id: auditRequestId,
      status: completeness.checkoutEligible ? "complete_for_payment" : "needs_user_input",
      priceUsd: 9.99,
    },
    auditInput: {
      ...input,
      id: `input_${randomUUID()}`,
      auditRequestId,
    },
    accommodationResolution,
    completeness,
  };
}

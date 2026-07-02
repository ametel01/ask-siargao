import { randomUUID } from "node:crypto";

import {
  type AuditCheckoutReadinessDecision,
  decideAuditCheckoutReadiness,
} from "@/server/audit/checkout-readiness";
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
  checkoutReadiness: AuditCheckoutReadinessDecision;
};

export function createAuditIntake(rawInput: unknown): AuditIntakeResult {
  const input = intakeInputSchema.parse(rawInput);
  const checkoutReadiness = decideAuditCheckoutReadiness(input);
  const auditRequestId = `audit_${randomUUID()}`;

  return {
    auditRequest: {
      id: auditRequestId,
      status: checkoutReadiness.checkoutEligible ? "complete_for_payment" : "needs_user_input",
      priceUsd: 9.99,
    },
    auditInput: {
      ...input,
      id: `input_${randomUUID()}`,
      auditRequestId,
    },
    checkoutReadiness,
  };
}

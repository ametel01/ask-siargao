import type { EvidenceBundle } from "@/server/audit/evidence-bundles";
import type { IntakeInput } from "@/server/audit/schemas";
import type { GovernedFact } from "@/server/facts/types";

export const auditRetrievalToolNames = [
  "accommodation_lookup",
  "accommodation_facts",
  "reviews",
  "weather",
  "route_risks",
  "area_profile",
  "service_facts",
  "policy_facts",
  "user_constraints",
  "source_credibility",
  "official_source_checks",
  "event_closure_signals",
  "environmental_local_fees",
  "operator_trust_signals",
] as const;

export type AuditRetrievalToolName = (typeof auditRetrievalToolNames)[number];

export type AuditToolCallRecord = {
  toolName: AuditRetrievalToolName;
  argumentsJson: Record<string, unknown>;
  resultJson: Record<string, unknown>;
  evidenceIds: string[];
};

export type RetrievalContext = {
  input: IntakeInput;
  facts: readonly GovernedFact[];
  evidenceBundle: EvidenceBundle;
  maxToolCalls: number;
};

const factTypeByTool: Partial<Record<AuditRetrievalToolName, readonly string[]>> = {
  accommodation_lookup: ["area", "location", "operator_trust"],
  accommodation_facts: ["area", "location", "internet_power"],
  reviews: ["review_theme"],
  weather: ["weather", "seasonality"],
  route_risks: ["route_schedule", "transfer_window"],
  area_profile: ["area", "location", "service_access"],
  service_facts: ["service_access", "internet_power", "local_transport"],
  policy_facts: ["policy", "health_access"],
  official_source_checks: ["route_schedule", "policy", "health_access"],
  event_closure_signals: ["event", "closure"],
  environmental_local_fees: ["environmental_fee", "local_fee", "policy"],
  operator_trust_signals: ["operator_trust", "accreditation"],
};

export function runControlledRetrievalPlan(input: {
  context: RetrievalContext;
  requestedTools: readonly AuditRetrievalToolName[];
}): AuditToolCallRecord[] {
  if (input.requestedTools.length > input.context.maxToolCalls) {
    throw new Error("LLM retrieval tool budget exceeded.");
  }

  return input.requestedTools.map((toolName) =>
    callAuditRetrievalTool({ context: input.context, toolName, argumentsJson: {} }),
  );
}

export function callAuditRetrievalTool(input: {
  context: RetrievalContext;
  toolName: string;
  argumentsJson?: Record<string, unknown>;
}): AuditToolCallRecord {
  if (!isAuditRetrievalToolName(input.toolName)) {
    throw new Error(`Unsupported audit retrieval tool: ${input.toolName}.`);
  }

  if (input.toolName === "user_constraints") {
    return {
      toolName: input.toolName,
      argumentsJson: input.argumentsJson ?? {},
      resultJson: {
        topConstraint: input.context.input.topConstraint,
        optionalModules: input.context.input.optionalModules,
        travelerContext: input.context.input.travelerContext,
      },
      evidenceIds: [],
    };
  }

  if (input.toolName === "source_credibility") {
    return {
      toolName: input.toolName,
      argumentsJson: input.argumentsJson ?? {},
      resultJson: {
        sourceProfiles: permittedFacts(input.context).map((fact) => ({
          factId: fact.id,
          sourceProfileId: fact.sourceProfileId,
          sourceType: fact.sourceType,
          confidence: fact.confidenceLabel,
          sourceAuthority: fact.sourceAuthority,
        })),
      },
      evidenceIds: input.context.evidenceBundle.evidence.map((item) => item.evidenceId),
    };
  }

  const allowedTypes = factTypeByTool[input.toolName] ?? [];
  const facts = permittedFacts(input.context).filter((fact) =>
    allowedTypes.includes(fact.factType),
  );

  return {
    toolName: input.toolName,
    argumentsJson: input.argumentsJson ?? {},
    resultJson: {
      facts: facts.map((fact) => ({
        factId: fact.id,
        claim: fact.claim,
        factType: fact.factType,
        confidence: fact.confidenceLabel,
        fetchedAt: fact.fetchedAt,
        expiresAt: fact.expiresAt,
      })),
    },
    evidenceIds: evidenceIdsForFacts(input.context, facts),
  };
}

export function permittedFacts(context: RetrievalContext) {
  const citedFactIds = new Set(context.evidenceBundle.factIds);

  return context.facts.filter(
    (fact) =>
      fact.auditUseAllowed &&
      fact.allowedUse !== "disallowed" &&
      fact.allowedUse !== "internal_only" &&
      citedFactIds.has(fact.id),
  );
}

function evidenceIdsForFacts(context: RetrievalContext, facts: readonly GovernedFact[]) {
  const factIds = new Set(facts.map((fact) => fact.id));
  const evidenceIds: string[] = [];

  for (const evidence of context.evidenceBundle.evidence) {
    if (factIds.has(context.evidenceBundle.evidenceFactIds[evidence.evidenceId])) {
      evidenceIds.push(evidence.evidenceId);
    }
  }

  return evidenceIds;
}

function isAuditRetrievalToolName(value: string): value is AuditRetrievalToolName {
  return auditRetrievalToolNames.includes(value as AuditRetrievalToolName);
}

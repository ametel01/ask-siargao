export const auditJobStates = [
  "created",
  "resolving",
  "needs_user_input",
  "complete_for_payment",
  "awaiting_payment",
  "paid",
  "generating",
  "reviewing",
  "published",
  "blocked",
  "failed",
] as const;

export type AuditJobState = (typeof auditJobStates)[number];

const auditJobStateTransitions: Record<AuditJobState, readonly AuditJobState[]> = {
  created: ["resolving", "needs_user_input", "blocked", "failed"],
  resolving: ["needs_user_input", "complete_for_payment", "blocked", "failed"],
  needs_user_input: ["resolving", "blocked"],
  complete_for_payment: ["awaiting_payment", "blocked"],
  awaiting_payment: ["paid", "blocked", "failed"],
  paid: ["generating", "failed"],
  generating: ["reviewing", "blocked", "failed"],
  reviewing: ["published", "generating", "blocked", "failed"],
  published: [],
  blocked: ["needs_user_input", "resolving"],
  failed: [],
};

export function canTransitionAuditJob(from: AuditJobState, to: AuditJobState) {
  return auditJobStateTransitions[from].includes(to);
}

export const riskLevels = ["green", "yellow", "red"] as const;
export type RiskLevel = (typeof riskLevels)[number];

const sourceTypes = [
  "official",
  "partner_api",
  "licensed_api",
  "permitted_public_web",
  "user_submitted",
  "host_submitted",
  "local_verified",
] as const;
export type SourceType = (typeof sourceTypes)[number];

const allowedUseStates = [
  "internal_only",
  "audit_only",
  "citation_only",
  "public_republish",
  "disallowed",
] as const;
export type AllowedUseState = (typeof allowedUseStates)[number];

const matchStates = ["confident", "probable", "ambiguous", "rejected"] as const;
export type MatchState = (typeof matchStates)[number];

const publicVisibilityStates = ["internal", "eligible", "published", "noindex", "blocked"] as const;
export type PublicVisibilityState = (typeof publicVisibilityStates)[number];

export const confidenceLabels = ["low", "medium", "high"] as const;
export type ConfidenceLabel = (typeof confidenceLabels)[number];

export const riskCategories = [
  "arrival_departure_logistics",
  "weather_seasonality",
  "area_fit",
  "internet_power",
  "on_island_transport",
  "cash_sim_basic_services",
  "health_safety_admin",
] as const;
export type RiskCategory = (typeof riskCategories)[number];

export const optionalRiskModules = [
  "remote_work",
  "family_kids",
  "surfing",
  "quiet_sleep",
  "budget_sensitivity",
  "arrival_timing",
  "transport_comfort",
  "medical_access",
  "accessibility",
  "nightlife",
  "food_restrictions",
  "sustainability",
  "local_fees",
  "live_events",
  "closures",
  "operator_trust_signals",
] as const;
export type OptionalRiskModule = (typeof optionalRiskModules)[number];

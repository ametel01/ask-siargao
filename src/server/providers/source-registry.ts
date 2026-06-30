import type { AllowedUseState, ConfidenceLabel, SourceType } from "@/server/audit/enums";

const accessMethods = [
  "api",
  "sitemap",
  "rss",
  "crawl",
  "user_submitted",
  "partner",
  "official_page",
] as const;

export type AccessMethod = (typeof accessMethods)[number];
export type RiskSignal = "low" | "medium" | "high";

export type SourceProfile = {
  id: string;
  sourceName: string;
  sourceType: SourceType;
  accessMethod: AccessMethod;
  allowedUse: AllowedUseState;
  robotsPolicy?: string;
  termsUrl?: string;
  rateLimit: string;
  freshnessWindowDays: number;
  authorityLevel: 1 | 2 | 3 | 4 | 5;
  storesRawAllowed: boolean;
  publishesRawAllowed: boolean;
  requiresPartnerApproval: boolean;
  knownStaleRisk: RiskSignal;
  knownAiOrSeoContentRisk: RiskSignal;
  notes?: string;
};

export type SourcePermissionDecision = {
  canFetch: boolean;
  canStoreRaw: boolean;
  canExtractFacts: boolean;
  canUseInPaidAudit: boolean;
  canCitePublicly: boolean;
  canExposeToAgents: boolean;
  publicRepublishAllowed: boolean;
  confidenceFloor: ConfidenceLabel;
};

export class SourcePolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourcePolicyError";
  }
}

export class SourceRegistry {
  readonly #profiles = new Map<string, SourceProfile>();

  constructor(profiles: readonly SourceProfile[] = []) {
    for (const profile of profiles) {
      this.register(profile);
    }
  }

  register(profile: SourceProfile) {
    if (!Number.isFinite(profile.freshnessWindowDays) || profile.freshnessWindowDays < 0) {
      throw new SourcePolicyError(`Source profile ${profile.id} has an invalid freshness window.`);
    }
    this.#profiles.set(profile.id, copySourceProfile(profile));
  }

  get(sourceId: string) {
    const profile = this.#profiles.get(sourceId);
    return profile ? copySourceProfile(profile) : undefined;
  }

  require(sourceId: string) {
    const profile = this.get(sourceId);
    if (!profile) {
      throw new SourcePolicyError(`No explicit source profile is registered for ${sourceId}.`);
    }
    return profile;
  }

  decide(sourceId: string): SourcePermissionDecision {
    const profile = this.require(sourceId);
    return decideSourcePermissions(profile);
  }

  assertCanEnterFactGraph(sourceId: string) {
    const decision = this.decide(sourceId);
    if (!decision.canExtractFacts || !decision.canUseInPaidAudit) {
      throw new SourcePolicyError(
        `Source ${sourceId} is not allowed to enter the audit fact graph.`,
      );
    }
    return decision;
  }

  list() {
    return [...this.#profiles.values()].map(copySourceProfile);
  }
}

function copySourceProfile(profile: SourceProfile): SourceProfile {
  return { ...profile };
}

function decideSourcePermissions(profile: SourceProfile): SourcePermissionDecision {
  if (profile.allowedUse === "disallowed") {
    return {
      canFetch: false,
      canStoreRaw: false,
      canExtractFacts: false,
      canUseInPaidAudit: false,
      canCitePublicly: false,
      canExposeToAgents: false,
      publicRepublishAllowed: false,
      confidenceFloor: "low",
    };
  }

  const publicRepublishAllowed = profile.allowedUse === "public_republish";
  const citationAllowed =
    publicRepublishAllowed ||
    profile.allowedUse === "citation_only" ||
    profile.sourceType === "official";
  const auditAllowed =
    profile.allowedUse === "audit_only" ||
    profile.allowedUse === "citation_only" ||
    profile.allowedUse === "public_republish" ||
    profile.allowedUse === "internal_only";

  return {
    canFetch: true,
    canStoreRaw: profile.storesRawAllowed,
    canExtractFacts: auditAllowed,
    canUseInPaidAudit: auditAllowed && profile.allowedUse !== "internal_only",
    canCitePublicly: citationAllowed,
    canExposeToAgents: publicRepublishAllowed && profile.publishesRawAllowed,
    publicRepublishAllowed,
    confidenceFloor: profile.authorityLevel >= 4 ? "medium" : "low",
  };
}

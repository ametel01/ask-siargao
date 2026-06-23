import { describe, expect, test } from "bun:test";

import { riskCategories } from "@/server/audit/enums";
import { createEvidenceBundle } from "@/server/audit/evidence-bundles";
import { validateReportForPublication } from "@/server/audit/report-validation";
import { buildMandatoryRiskSkeletons, rankRisks, riskRankScore } from "@/server/audit/risk-engine";
import type { EvidenceReference, ReportOutput, RiskItem } from "@/server/audit/schemas";
import type { GovernedEvidence, GovernedFact } from "@/server/facts/types";

const now = new Date("2026-06-23T00:00:00.000Z");

const baseFact: GovernedFact = {
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
};

const accommodationFact: GovernedFact = {
  ...baseFact,
  id: "fact_accommodation",
  claim: "Example Surf Stay is in General Luna.",
  factType: "area",
  sourceRecordId: "record_accommodation",
  confidenceLabel: "medium",
};

const evidence: GovernedEvidence[] = [
  {
    id: "ev_route",
    factId: "fact_route",
    sourceRecordId: "Official transport source",
    label: "Official route evidence",
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

const bundle = createEvidenceBundle({
  id: "bundle_private_report",
  visibility: "private_report",
  facts: [baseFact, accommodationFact],
  evidence,
});

const evidenceReferences = bundle.evidence;
const routeEvidenceReference = evidenceReferences.find((item) => item.evidenceId === "ev_route");

if (!routeEvidenceReference) {
  throw new Error("Expected route evidence fixture to exist.");
}

function risk(overrides: Partial<RiskItem> = {}): RiskItem {
  return {
    id: "risk_route",
    category: "arrival_departure_logistics",
    level: "yellow",
    title: "Late route risk",
    whatMightBreak: "The ferry leg can arrive too late for normal transfers.",
    whyItMatters: "The traveler may need an expensive backup.",
    recommendedFix: "Confirm the last transfer before payment.",
    impact: 4,
    likelihood: 3,
    fixability: 4,
    travelerRelevance: 5,
    confidence: "high",
    evidence: evidenceReferences,
    ...overrides,
  };
}

function validReport(overrides: Partial<ReportOutput> = {}): ReportOutput {
  const fullRiskTable = riskCategories.map((category) =>
    risk({
      id: `risk_${category}`,
      category,
      title: `${category.replaceAll("_", " ")} check`,
    }),
  );
  return {
    overallRisk: "yellow",
    confidenceSummary: "Route facts are high confidence; accommodation area is medium confidence.",
    sourceQualitySummary:
      "Official transport evidence is authoritative; accommodation evidence is private.",
    topRisks: [fullRiskTable[0] as RiskItem],
    fullRiskTable,
    accommodationAssessment: "Example Surf Stay appears to be in General Luna.",
    areaFitAssessment: "General Luna fits the stated constraint.",
    logisticsNotes: "Arrival logistics need a verified transfer window.",
    weatherSeasonalityNotes: "Weather should be refreshed before final publication.",
    internetPowerAssessment: "Ask the host for a recent speed test.",
    transportNotes: "Avoid assuming scooter-only backups.",
    cashSimServiceNotes: "Bring cash buffer and confirm SIM access.",
    healthSafetyAdminNotes: "Know the nearest clinic route.",
    officialAccreditationNotes: "No official accreditation claim is made without evidence.",
    eventClosureFeeNotes: "No event, closure, or fee claim is made without evidence.",
    recommendedFixes: ["Confirm transfer window."],
    hostQuestions: ["Can you confirm exact area and pickup window?"],
    evidence: evidenceReferences,
    evidenceFreshnessNotes: ["Route evidence is fresh."],
    limitations: ["Exact room noise level is not verified."],
    ...overrides,
  };
}

describe("risk engine", () => {
  test("builds mandatory reportable risks and ranks them deterministically", () => {
    const references: EvidenceReference[] = [
      {
        evidenceId: "ev_route",
        label: "Official route evidence",
        sourceName: "Official transport source",
        fetchedAt: "2026-06-23T00:00:00.000Z",
        confidence: "high",
        freshness: "fresh",
      },
    ];
    const risks = buildMandatoryRiskSkeletons(
      {
        travelMonth: "2026-08",
        arrivalOrigin: "Manila",
        stayAreaSlug: "general-luna",
        topConstraint: "quiet sleep",
        optionalModules: [],
        travelerContext: { riskTolerance: "low_risk" },
      },
      references,
    );

    expect(risks).toHaveLength(7);
    expect(rankRisks(risks)[0]?.category).toBe("arrival_departure_logistics");
    expect(riskRankScore(risks[0] as RiskItem)).toBeGreaterThan(0);
  });
});

describe("evidence bundle freshness", () => {
  test("labels evidence freshness from fact expiry against a deterministic clock", () => {
    const staleFact = { ...baseFact, id: "fact_stale", expiresAt: "2026-06-22T00:00:00.000Z" };
    const unknownFact = { ...baseFact, id: "fact_unknown", expiresAt: undefined };
    const freshnessBundle = createEvidenceBundle({
      id: "bundle_freshness",
      visibility: "private_report",
      facts: [baseFact, staleFact, unknownFact],
      evidence: [
        { ...evidence[0], id: "ev_fresh", factId: baseFact.id },
        { ...evidence[0], id: "ev_stale", factId: staleFact.id },
        { ...evidence[0], id: "ev_unknown", factId: unknownFact.id },
      ],
      now,
    });

    expect(freshnessBundle.evidence.map((item) => [item.evidenceId, item.freshness])).toEqual([
      ["ev_fresh", "fresh"],
      ["ev_stale", "stale"],
      ["ev_unknown", "unknown"],
    ]);
    expect(freshnessBundle.evidenceFactIds).toMatchObject({
      ev_fresh: "fact_route",
      ev_stale: "fact_stale",
      ev_unknown: "fact_unknown",
    });
  });

  test("does not label invalid expiry values as fresh", () => {
    const invalidExpiryFact = { ...baseFact, id: "fact_invalid_expiry", expiresAt: "not-a-date" };
    const freshnessBundle = createEvidenceBundle({
      id: "bundle_invalid_expiry",
      visibility: "private_report",
      facts: [invalidExpiryFact],
      evidence: [{ ...evidence[0], id: "ev_invalid_expiry", factId: invalidExpiryFact.id }],
      now,
    });

    expect(freshnessBundle.evidence[0]?.freshness).toBe("unknown");
  });
});

describe("report validation", () => {
  test("accepts a paid report with valid evidence", () => {
    const result = validateReportForPublication({
      report: validReport(),
      evidenceBundle: bundle,
      facts: [baseFact, accommodationFact],
      paymentState: "paid",
      accommodationName: "Example Surf Stay",
      now,
    });

    expect(result.valid).toBe(true);
    expect(new Set(result.report?.fullRiskTable.map((item) => item.category))).toEqual(
      new Set(riskCategories),
    );
    expect(result.report?.topRisks).toHaveLength(1);
  });

  test("fails when mandatory report categories are omitted from the full risk table", () => {
    const result = validateReportForPublication({
      report: validReport({
        fullRiskTable: [risk()],
      }),
      evidenceBundle: bundle,
      facts: [baseFact, accommodationFact],
      paymentState: "paid",
      now,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "category:weather_seasonality:missing mandatory report category.",
    );
    expect(result.errors).toContain("category:area_fit:missing mandatory report category.");
    expect(result.errors).toContain("category:internet_power:missing mandatory report category.");
    expect(result.errors).toContain(
      "category:on_island_transport:missing mandatory report category.",
    );
    expect(result.errors).toContain(
      "category:cash_sim_basic_services:missing mandatory report category.",
    );
    expect(result.errors).toContain(
      "category:health_safety_admin:missing mandatory report category.",
    );
  });

  test("fails on missing required sections", () => {
    const { sourceQualitySummary: _sourceQualitySummary, ...report } = validReport();

    const result = validateReportForPublication({
      report,
      evidenceBundle: bundle,
      facts: [baseFact, accommodationFact],
      paymentState: "paid",
      now,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.startsWith("schema:sourceQualitySummary"))).toBe(
      true,
    );
  });

  test("fails on invalid evidence IDs", () => {
    const result = validateReportForPublication({
      report: validReport({
        evidence: [
          {
            ...routeEvidenceReference,
            evidenceId: "missing_evidence",
          },
        ],
      }),
      evidenceBundle: bundle,
      facts: [baseFact, accommodationFact],
      paymentState: "paid",
      now,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("evidence:missing_evidence:not in bundle.");
  });

  test("fails on uncited accommodation claims", () => {
    const result = validateReportForPublication({
      report: validReport({
        evidence: [routeEvidenceReference],
        topRisks: [risk({ evidence: [routeEvidenceReference] })],
        fullRiskTable: [risk({ evidence: [routeEvidenceReference] })],
      }),
      evidenceBundle: bundle,
      facts: [baseFact, accommodationFact],
      paymentState: "paid",
      accommodationName: "Example Surf Stay",
      now,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "citation:accommodation assessment names the stay without accommodation evidence.",
    );
  });

  test("fails on stale critical facts", () => {
    const staleFact = { ...baseFact, expiresAt: "2026-06-20T00:00:00.000Z" };
    const result = validateReportForPublication({
      report: validReport(),
      evidenceBundle: bundle,
      facts: [staleFact, accommodationFact],
      paymentState: "paid",
      now,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("freshness:fact_route:critical fact is stale.");
  });

  test("requires stale non-critical caveats", () => {
    const staleArea = { ...accommodationFact, expiresAt: "2026-06-20T00:00:00.000Z" };
    const result = validateReportForPublication({
      report: validReport({ limitations: ["Exact room noise level is not verified."] }),
      evidenceBundle: bundle,
      facts: [baseFact, staleArea],
      paymentState: "paid",
      now,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "freshness:fact_accommodation:stale non-critical fact needs a caveat.",
    );
  });

  test("fails on payment-state violations and low-confidence consequential claims", () => {
    const result = validateReportForPublication({
      report: validReport({
        topRisks: [risk({ confidence: "low" })],
        fullRiskTable: [risk({ confidence: "low" })],
      }),
      evidenceBundle: bundle,
      facts: [baseFact, accommodationFact],
      paymentState: "unpaid",
      now,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("payment:report cannot unlock before verified payment.");
    expect(result.errors).toContain(
      "confidence:risk_route:low-confidence source supports consequential claim.",
    );
  });
});

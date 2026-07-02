import { describe, expect, test } from "bun:test";

import { riskCategories } from "@/server/audit/enums";
import { buildMandatoryRiskSkeletons, rankRisks } from "@/server/audit/risk-engine";
import {
  classifyFactFreshnessForReport,
  getMandatoryRiskCategories,
  getMandatoryRiskContract,
  isLowConfidenceConsequentialRisk,
  missingMandatoryRiskCategories,
  reportHasStaleNonCriticalCaveat,
  scoreRiskForRanking,
} from "@/server/audit/risk-policy";
import type { EvidenceReference, RiskItem } from "@/server/audit/schemas";
import type { GovernedFact } from "@/server/facts/types";

const now = new Date("2026-06-23T00:00:00.000Z");

const baseRisk: RiskItem = {
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
  evidence: [
    {
      evidenceId: "ev_route",
      label: "Official route evidence",
      sourceName: "Official transport source",
      fetchedAt: "2026-06-23T00:00:00.000Z",
      confidence: "high",
      freshness: "fresh",
    },
  ],
};

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

describe("audit risk policy", () => {
  test("owns mandatory category coverage and vocabulary", () => {
    expect(getMandatoryRiskCategories()).toEqual(riskCategories);
    expect(
      missingMandatoryRiskCategories([
        { category: "arrival_departure_logistics" },
        { category: "weather_seasonality" },
      ]),
    ).toEqual([
      "area_fit",
      "internet_power",
      "on_island_transport",
      "cash_sim_basic_services",
      "health_safety_admin",
    ]);

    expect(getMandatoryRiskContract("health_safety_admin")).toMatchObject({
      label: "Health, safety, and admin",
      requiredEvidenceTypes: ["health_access", "policy"],
      evaluatorScope: "mandatory",
      defaultLevel: "green",
    });
  });

  test("identifies low-confidence consequential claims", () => {
    expect(
      isLowConfidenceConsequentialRisk({
        category: "arrival_departure_logistics",
        confidence: "low",
      }),
    ).toBe(true);
    expect(
      isLowConfidenceConsequentialRisk({
        category: "health_safety_admin",
        confidence: "low",
      }),
    ).toBe(true);
    expect(
      isLowConfidenceConsequentialRisk({
        category: "area_fit",
        confidence: "low",
      }),
    ).toBe(false);
    expect(
      isLowConfidenceConsequentialRisk({
        category: "arrival_departure_logistics",
        confidence: "medium",
      }),
    ).toBe(false);
  });

  test("classifies stale critical facts separately from stale non-critical facts", () => {
    expect(
      classifyFactFreshnessForReport({ ...baseFact, expiresAt: "2026-06-22T00:00:00.000Z" }, now),
    ).toBe("stale_critical");
    expect(
      classifyFactFreshnessForReport(
        {
          ...baseFact,
          factType: "area",
          expiresAt: "2026-06-22T00:00:00.000Z",
        },
        now,
      ),
    ).toBe("stale_non_critical");
    expect(classifyFactFreshnessForReport(baseFact, now)).toBe("current");
  });

  test("requires stale non-critical caveats through limitation policy", () => {
    expect(reportHasStaleNonCriticalCaveat({ limitations: ["Exact room noise is unknown."] })).toBe(
      false,
    );
    expect(
      reportHasStaleNonCriticalCaveat({
        limitations: ["Some non-critical area facts may be stale."],
      }),
    ).toBe(true);
  });

  test("scores and ranks risks with shared weights", () => {
    const lowerRelevance = { ...baseRisk, id: "risk_lower", travelerRelevance: 4 };
    const higherImpact = { ...baseRisk, id: "risk_higher", impact: 5 };

    expect(scoreRiskForRanking(baseRisk)).toBe(30);
    expect(rankRisks([lowerRelevance, higherImpact, baseRisk]).map((risk) => risk.id)).toEqual([
      "risk_higher",
      "risk_route",
      "risk_lower",
    ]);
  });

  test("reuses policy vocabulary when building mandatory skeletons", () => {
    const evidence: EvidenceReference[] = [
      {
        evidenceId: "ev_route",
        label: "Official route evidence",
        sourceName: "Official transport source",
        fetchedAt: "2026-06-23T00:00:00.000Z",
        confidence: "high",
        freshness: "fresh",
      },
    ];
    const skeletons = buildMandatoryRiskSkeletons(
      {
        travelMonth: "2026-08",
        arrivalOrigin: "Manila",
        topConstraint: "quiet sleep",
        optionalModules: [],
        travelerContext: { riskTolerance: "low_risk" },
      },
      evidence,
    );

    expect(skeletons.map((risk) => risk.category)).toEqual([...getMandatoryRiskCategories()]);
    for (const skeleton of skeletons) {
      const policy = getMandatoryRiskContract(skeleton.category);

      expect(skeleton.title).toBe(policy.label);
      expect(skeleton.level).toBe(policy.defaultLevel);
      expect(skeleton.evidence).toEqual(evidence);
    }
  });
});

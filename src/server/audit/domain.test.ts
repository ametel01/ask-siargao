import { describe, expect, test } from "bun:test";

import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import { canTransitionAuditJob, optionalRiskModules, riskCategories } from "@/server/audit/enums";
import {
  completenessCheckResultSchema,
  intakeInputSchema,
  reportOutputSchema,
} from "@/server/audit/schemas";

const evidence = {
  evidenceId: "ev_route_1",
  label: "Official ferry schedule",
  sourceName: "Official transport source",
  fetchedAt: "2026-06-23T00:00:00.000Z",
  confidence: "high",
  freshness: "fresh",
} as const;

const risk = {
  id: "risk_route_delay",
  category: "arrival_departure_logistics",
  level: "yellow",
  title: "Late ferry can compress arrival",
  whatMightBreak: "A delayed ferry can make the planned transfer unavailable.",
  whyItMatters: "The traveler arrives with limited backup options.",
  recommendedFix: "Confirm the last transfer window before booking.",
  impact: 4,
  likelihood: 3,
  fixability: 4,
  travelerRelevance: 5,
  confidence: "high",
  evidence: [evidence],
} as const;

describe("audit domain enums", () => {
  test("allow only explicit job transitions", () => {
    expect(canTransitionAuditJob("created", "resolving")).toBe(true);
    expect(canTransitionAuditJob("created", "published")).toBe(false);
    expect(canTransitionAuditJob("published", "generating")).toBe(false);
  });

  test("seed taxonomy covers mandatory and optional risk modules", () => {
    expect(siargaoTaxonomy.riskCategories.map((item) => item.slug).sort()).toEqual(
      [...riskCategories].sort(),
    );
    expect(siargaoTaxonomy.optionalModules.map((item) => item.slug).sort()).toEqual(
      [...optionalRiskModules].sort(),
    );
    expect(siargaoTaxonomy.areas.length).toBeGreaterThanOrEqual(5);
    expect(siargaoTaxonomy.routes.length).toBeGreaterThanOrEqual(3);
  });
});

describe("audit validation schemas", () => {
  test("accept a valid intake with a travel month", () => {
    const parsed = intakeInputSchema.parse({
      travelMonth: "2026-08",
      arrivalOrigin: "Manila",
      accommodationName: "Example Surf Stay",
      topConstraint: "quiet sleep",
      optionalModules: ["quiet_sleep", "remote_work"],
    });

    expect(parsed.travelerContext.riskTolerance).toBe("balanced");
  });

  test("requires dates or travel month before completeness", () => {
    expect(() =>
      intakeInputSchema.parse({
        arrivalOrigin: "Manila",
        topConstraint: "remote work",
      }),
    ).toThrow();
  });

  test("validates completeness and report outputs with cited evidence", () => {
    expect(
      completenessCheckResultSchema.parse({
        canComplete: true,
        blockingReasons: [],
        previewRisk: risk,
        requiredUserFollowups: [],
        evidenceSummary: [evidence],
      }).canComplete,
    ).toBe(true);

    expect(
      reportOutputSchema.parse({
        overallRisk: "yellow",
        confidenceSummary: "High confidence for route timing, medium for accommodation noise.",
        sourceQualitySummary:
          "Official route sources are high authority; host details need confirmation.",
        topRisks: [risk],
        fullRiskTable: [risk],
        accommodationAssessment: "Accommodation is plausible but needs host confirmation.",
        areaFitAssessment: "General Luna fits the stated constraints.",
        logisticsNotes: "Arrival route is workable with an early transfer.",
        weatherSeasonalityNotes: "Weather risk should be refreshed before payment.",
        internetPowerAssessment: "Ask for a recent speed test and generator details.",
        transportNotes: "Avoid assuming scooter use at night.",
        cashSimServiceNotes: "Bring cash buffer and confirm SIM plan.",
        healthSafetyAdminNotes: "Know the nearest clinic and emergency route.",
        officialAccreditationNotes: "No accreditation claim is made without official evidence.",
        eventClosureFeeNotes: "No event, closure, or local-fee claim is made without evidence.",
        recommendedFixes: ["Book a transfer before arrival."],
        hostQuestions: ["Do you have generator backup?"],
        evidence: [evidence],
        evidenceFreshnessNotes: ["Route evidence is fresh."],
        limitations: ["Exact room noise level could not be verified."],
      }).overallRisk,
    ).toBe("yellow");
  });
});

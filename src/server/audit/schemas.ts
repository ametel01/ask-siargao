import { z } from "zod";

import {
  confidenceLabels,
  optionalRiskModules,
  riskCategories,
  riskLevels,
} from "@/server/audit/enums";

const optionalString = (minimumLength: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(minimumLength).optional(),
  );

export const evidenceReferenceSchema = z.object({
  evidenceId: z.string().min(1),
  label: z.string().min(1),
  sourceName: z.string().min(1),
  url: z.url().optional(),
  fetchedAt: z.iso.datetime(),
  confidence: z.enum(confidenceLabels),
  freshness: z.enum(["fresh", "stale", "unknown"]),
});

export const intakeInputSchema = z
  .object({
    travelMonth: z.string().min(4).optional(),
    startDate: z.iso.date().optional(),
    endDate: z.iso.date().optional(),
    arrivalOrigin: optionalString(2),
    arrivalRouteSlug: optionalString(1),
    accommodationName: z.string().min(2).optional(),
    accommodationPlatformUrl: z.url().optional(),
    stayAreaSlug: z.string().min(1).optional(),
    topConstraint: z.string().min(3),
    optionalModules: z.array(z.enum(optionalRiskModules)).default([]),
    travelerContext: z
      .object({
        travelerType: z.string().optional(),
        groupSize: z.number().int().positive().optional(),
        hasChildren: z.boolean().optional(),
        riskTolerance: z.enum(["relaxed", "balanced", "low_risk"]).default("balanced"),
      })
      .default({ riskTolerance: "balanced" }),
  })
  .refine((value) => value.travelMonth || (value.startDate && value.endDate), {
    message: "Provide either a travel month or concrete start/end dates.",
    path: ["travelMonth"],
  })
  .refine((value) => value.arrivalOrigin || value.arrivalRouteSlug, {
    message: "Provide either an arrival origin or arrival route.",
    path: ["arrivalOrigin"],
  });

export const riskItemSchema = z.object({
  id: z.string().min(1),
  category: z.enum(riskCategories),
  level: z.enum(riskLevels),
  title: z.string().min(1),
  whatMightBreak: z.string().min(1),
  whyItMatters: z.string().min(1),
  recommendedFix: z.string().min(1),
  impact: z.number().min(1).max(5),
  likelihood: z.number().min(1).max(5),
  fixability: z.number().min(1).max(5),
  travelerRelevance: z.number().min(1).max(5),
  confidence: z.enum(confidenceLabels),
  evidence: z.array(evidenceReferenceSchema).min(1),
});

export const completenessCheckResultSchema = z.object({
  canComplete: z.boolean(),
  blockingReasons: z.array(z.string()),
  previewRisk: riskItemSchema.optional(),
  requiredUserFollowups: z.array(z.string()),
  evidenceSummary: z.array(evidenceReferenceSchema),
});

export const reportOutputSchema = z.object({
  overallRisk: z.enum(riskLevels),
  confidenceSummary: z.string().min(1),
  sourceQualitySummary: z.string().min(1),
  topRisks: z.array(riskItemSchema).min(1).max(3),
  fullRiskTable: z.array(riskItemSchema).min(1),
  accommodationAssessment: z.string().min(1),
  areaFitAssessment: z.string().min(1),
  logisticsNotes: z.string().min(1),
  weatherSeasonalityNotes: z.string().min(1),
  internetPowerAssessment: z.string().min(1),
  transportNotes: z.string().min(1),
  cashSimServiceNotes: z.string().min(1),
  healthSafetyAdminNotes: z.string().min(1),
  officialAccreditationNotes: z.string().min(1),
  eventClosureFeeNotes: z.string().min(1),
  recommendedFixes: z.array(z.string()).min(1),
  hostQuestions: z.array(z.string()).min(1),
  evidence: z.array(evidenceReferenceSchema).min(1),
  evidenceFreshnessNotes: z.array(z.string()).min(1),
  limitations: z.array(z.string()),
});

export type IntakeInput = z.infer<typeof intakeInputSchema>;
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;
export type RiskItem = z.infer<typeof riskItemSchema>;
export type CompletenessCheckResult = z.infer<typeof completenessCheckResultSchema>;
export type ReportOutput = z.infer<typeof reportOutputSchema>;

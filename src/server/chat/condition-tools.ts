import { z } from "zod";

import type { AnswerTrustLabel } from "@/server/chat/answer-source-summary";

export const conditionSignalKinds = ["weather", "tide", "surf", "road", "manual_caveat"] as const;
export const conditionSignalStatuses = ["checked", "not_checked", "unavailable"] as const;
export const conditionRiskLevels = ["low", "medium", "high"] as const;
export const conditionActivities = [
  "swimming",
  "surfing",
  "scooter",
  "rain_plan",
  "sunset",
  "boat_trip",
] as const;
export const conditionRecommendations = [
  "good",
  "flexible",
  "avoid",
  "needs_local_confirmation",
] as const;

const answerTrustLabels = [
  "live_checked",
  "fresh_cache",
  "curated_local_guide",
  "weather_checked",
  "not_verified",
  "provider_unavailable",
] as const satisfies readonly AnswerTrustLabel[];

export const conditionSourceSummarySchema = z
  .object({
    label: z.enum(answerTrustLabels),
    sourceName: z.string().min(1),
    sourceProfileId: z.string().min(1).optional(),
    fetchedAt: z.string().min(1).optional(),
    confidence: z.enum(["high", "medium", "low"]).optional(),
    checked: z.array(z.string().min(1)),
    notChecked: z.array(z.string().min(1)),
  })
  .strict();

export const conditionSignalSchema = z
  .object({
    kind: z.enum(conditionSignalKinds),
    status: z.enum(conditionSignalStatuses),
    level: z.enum(conditionRiskLevels),
    label: z.string().min(1),
    summary: z.string().min(1),
    checked: z.array(z.string().min(1)),
    notChecked: z.array(z.string().min(1)),
    evidenceIds: z.array(z.string().min(1)),
    source: conditionSourceSummarySchema,
  })
  .strict();

export const conditionJudgmentSchema = z
  .object({
    activity: z.enum(conditionActivities),
    locationName: z.string().min(1),
    dateLabel: z.string().min(1),
    recommendation: z.enum(conditionRecommendations),
    level: z.enum(conditionRiskLevels),
    reasons: z.array(z.string().min(1)).min(1),
    alternatives: z.array(z.string().min(1)).min(1),
    caveats: z.array(z.string().min(1)),
    signals: z.array(conditionSignalSchema).min(1),
    sources: z.array(conditionSourceSummarySchema).min(1),
  })
  .strict();

export const conditionJudgmentRequestSchema = z
  .object({
    activity: z.enum(conditionActivities),
    location: z.enum(["Siargao Island", "Cloud 9", "General Luna", "Del Carmen"]),
    date_range: z.enum(["today", "next_7_days"]),
    beach_name: z.string().min(1).nullable(),
    include_local_caveats: z.boolean().nullable(),
    constraints: z.array(z.string().min(1)).nullable(),
  })
  .strict();

export type ConditionSignal = z.infer<typeof conditionSignalSchema>;
export type ConditionJudgment = z.infer<typeof conditionJudgmentSchema>;
export type ConditionJudgmentRequest = z.infer<typeof conditionJudgmentRequestSchema>;

export const conditionJudgmentToolParameters = {
  type: "object",
  properties: {
    activity: {
      type: "string",
      enum: conditionActivities,
      description: "Activity or decision the traveler is asking about.",
    },
    location: {
      type: "string",
      enum: ["Siargao Island", "Cloud 9", "General Luna", "Del Carmen"],
      description: "Known Siargao forecast location to use for the condition judgment.",
    },
    date_range: {
      type: "string",
      enum: ["today", "next_7_days"],
      description: "Forecast range to judge.",
    },
    beach_name: {
      type: ["string", "null"],
      description: "Optional beach or coastal spot when the question names one.",
    },
    include_local_caveats: {
      type: ["boolean", "null"],
      description: "Whether curated local caveats should be included when relevant.",
    },
    constraints: {
      type: ["array", "null"],
      items: { type: "string" },
      description: "Optional traveler constraints to preserve as caveats.",
    },
  },
  required: [
    "activity",
    "location",
    "date_range",
    "beach_name",
    "include_local_caveats",
    "constraints",
  ],
  additionalProperties: false,
} as const;

import { z } from "zod";

import type { AgentToolDependencies } from "@/server/chat/agent-tool-catalogue";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";

export const optionalNullable = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

export function currentIso(dependencies: AgentToolDependencies) {
  return (dependencies.now?.() ?? new Date()).toISOString();
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function safeProviderUnavailableText(subject: string, verb: "is" | "are" = "is") {
  return `${subject} ${verb} temporarily unavailable.`;
}

export function slugPart(value: string) {
  return value
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function cardSourceLabel(summary: AnswerSourceSummary) {
  return `${summary.sourceName} - ${summary.label.replaceAll("_", " ")}`;
}

export function formatNullableNumber(value: number | null, unit: string) {
  return value === null ? "unavailable" : `${value}${unit}`;
}

export function uniqueText(values: readonly (string | null | undefined)[]) {
  const uniqueValues = new Set<string>();
  for (const value of values) {
    const normalizedValue = value?.trim() ?? "";
    if (normalizedValue.length > 0) {
      uniqueValues.add(normalizedValue);
    }
  }
  return [...uniqueValues];
}

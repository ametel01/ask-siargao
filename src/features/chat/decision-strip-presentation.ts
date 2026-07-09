import type { ChatSourceArtifact } from "@/features/chat/saved-trip-client";

export type DecisionStripSummary = {
  id: string;
  bestAction: string;
  basis: string;
  fallback?: string;
  avoid?: string;
  timing?: string;
  area?: string;
  sources: readonly ChatSourceArtifact[];
};

export type DecisionStripPresentation = {
  summary: DecisionStripSummary;
  context: Array<{
    label: "Where" | "When";
    value: string;
  }>;
  guidance: Array<{
    label: "Backup" | "Avoid";
    value: string;
  }>;
  sourceStatus?: {
    label: "Checked" | "Not verified" | "Source unavailable";
    value: string;
  };
};

export function projectDecisionStrip(
  summaries: readonly DecisionStripSummary[] | undefined,
): DecisionStripPresentation | undefined {
  const summary = summaries?.[0];
  if (!summary) {
    return undefined;
  }
  const sourceStatus = projectSourceStatus(summary.sources);

  return {
    summary,
    context: [
      ...(summary.area ? [{ label: "Where" as const, value: summary.area }] : []),
      ...(summary.timing ? [{ label: "When" as const, value: summary.timing }] : []),
    ],
    guidance: [
      ...(summary.fallback ? [{ label: "Backup" as const, value: summary.fallback }] : []),
      ...(summary.avoid ? [{ label: "Avoid" as const, value: summary.avoid }] : []),
    ],
    ...(sourceStatus ? { sourceStatus } : {}),
  };
}

function projectSourceStatus(
  sources: readonly ChatSourceArtifact[],
): DecisionStripPresentation["sourceStatus"] {
  const checkedSources = sources.filter(
    (source) =>
      source.checked.length > 0 &&
      source.label !== "not_verified" &&
      source.label !== "provider_unavailable",
  );
  if (checkedSources.length > 0) {
    return {
      label: "Checked",
      value: checkedSources
        .map((source) => `${source.sourceName}: ${source.checked.join(", ")}`)
        .join(" · "),
    };
  }

  const sourceNames = sources.map((source) => source.sourceName).filter(Boolean);
  if (sourceNames.length === 0) {
    return undefined;
  }

  return sources.some((source) => source.label === "provider_unavailable")
    ? { label: "Source unavailable", value: sourceNames.join(", ") }
    : { label: "Not verified", value: sourceNames.join(", ") };
}

import {
  evidenceStateCopy,
  projectSourceEvidencePresentation,
} from "@/features/chat/evidence-presentation-state";
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
    label: string;
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
  const presentations = sources.map(projectSourceEvidencePresentation);
  const checkedSources = presentations.filter((presentation) => presentation.state === "checked");
  if (checkedSources.length > 0) {
    return {
      label: evidenceStateCopy("checked").label,
      value: checkedSources
        .map(
          (presentation) => `${presentation.sourceName}: ${presentation.checkedScope.join(", ")}`,
        )
        .join(" · "),
    };
  }

  const sourceNames = presentations.map((presentation) => presentation.sourceName).filter(Boolean);
  if (sourceNames.length === 0) {
    return undefined;
  }

  return presentations.some((presentation) => presentation.state === "unavailable")
    ? {
        label: evidenceStateCopy("unavailable").label,
        value: sourceNames.join(", "),
      }
    : { label: evidenceStateCopy("not-verified").label, value: sourceNames.join(", ") };
}

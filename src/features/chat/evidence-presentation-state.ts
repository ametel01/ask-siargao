import type {
  ConditionDecisionState,
  LiveConditionDecision,
} from "@/features/chat/live-condition-decision";
import type { AnswerTrustLabel } from "@/server/chat/answer-source-summary";

export type EvidencePresentationState =
  | "capability"
  | "checking"
  | "checked"
  | "stale"
  | "unavailable"
  | "not-verified";

export type EvidencePresentation = {
  state: EvidencePresentationState;
  label: string;
  summary: string;
  checkedScope: readonly string[];
  notCheckedScope: readonly string[];
  sourceName?: string;
  sourceTime?: string;
  isPositiveClaim: boolean;
};

export type SourceEvidenceInput = {
  label: AnswerTrustLabel | string;
  sourceName: string;
  fetchedAt?: string;
  checked: readonly string[];
  notChecked: readonly string[];
};

const checkedSourceLabels = new Set<AnswerTrustLabel>([
  "live_checked",
  "fresh_cache",
  "event_checked",
  "venue_checked",
  "curated_local_guide",
  "weather_checked",
  "marine_checked",
  "tide_forecast_checked",
  "community_signal",
  "web_researched",
  "official_checked",
  "directory_checked",
]);

const unsupportedPositiveSourceLabels = new Set<AnswerTrustLabel>([
  "no_current_event_facts",
  "insufficient_web_evidence",
  "not_verified",
  "provider_unavailable",
]);

export function evidenceStateCopy(state: EvidencePresentationState) {
  switch (state) {
    case "capability":
      return { label: "Can check when asked", summary: "Available for a request." };
    case "checking":
      return { label: "Checking now", summary: "Current request is still running." };
    case "checked":
      return { label: "Checked", summary: "Current evidence supports this." };
    case "stale":
      return { label: "Prior evidence", summary: "Prior result needs a refresh." };
    case "unavailable":
      return {
        label: "Unavailable",
        summary: "The attempted check did not return usable evidence.",
      };
    case "not-verified":
      return { label: "Not verified", summary: "This was not checked or was insufficient." };
  }
}

export function projectCapabilityEvidencePresentation(summary: string): EvidencePresentation {
  return {
    state: "capability",
    label: evidenceStateCopy("capability").label,
    summary,
    checkedScope: [],
    notCheckedScope: [],
    isPositiveClaim: false,
  };
}

export function projectConditionEvidencePresentation(
  decision: Pick<
    LiveConditionDecision,
    "state" | "evidenceStatus" | "checked" | "notChecked" | "sourceTime"
  >,
): EvidencePresentation {
  const state = conditionStateToEvidenceState(decision.state);
  const base = evidenceStateCopy(state);
  const label = decision.state === "partial" ? "Partly checked signals" : base.label;

  return {
    state,
    label,
    summary: decision.evidenceStatus ?? base.summary,
    checkedScope: state === "checked" ? decision.checked : [],
    notCheckedScope: decision.notChecked,
    ...(decision.sourceTime ? { sourceTime: decision.sourceTime } : {}),
    isPositiveClaim: state === "checked" && decision.checked.length > 0,
  };
}

export function projectSourceEvidencePresentation(
  source: SourceEvidenceInput,
): EvidencePresentation {
  const checkedScope = normalizeItems(source.checked);
  const notCheckedScope = normalizeItems(source.notChecked);
  const sourceName = sourceEvidenceDisplayName(source);
  const knownLabel = isAnswerTrustLabel(source.label) ? source.label : "not_verified";

  if (knownLabel === "provider_unavailable") {
    return {
      state: "unavailable",
      label: "Could not check",
      summary: `${sourceName} was unavailable for this request.`,
      checkedScope: [],
      notCheckedScope: notCheckedScope.length ? notCheckedScope : ["Current provider result"],
      sourceName,
      ...(source.fetchedAt ? { sourceTime: source.fetchedAt } : {}),
      isPositiveClaim: false,
    };
  }

  if (unsupportedPositiveSourceLabels.has(knownLabel) || checkedScope.length === 0) {
    return {
      state: "not-verified",
      label: notVerifiedSourceLabel(knownLabel),
      summary: `${sourceName} did not verify a checked fact for this request.`,
      checkedScope: [],
      notCheckedScope,
      sourceName,
      ...(source.fetchedAt ? { sourceTime: source.fetchedAt } : {}),
      isPositiveClaim: false,
    };
  }

  if (!checkedSourceLabels.has(knownLabel)) {
    return {
      state: "not-verified",
      label: "Not verified",
      summary: `${sourceName} did not match a supported evidence type.`,
      checkedScope: [],
      notCheckedScope,
      sourceName,
      ...(source.fetchedAt ? { sourceTime: source.fetchedAt } : {}),
      isPositiveClaim: false,
    };
  }

  return {
    state: "checked",
    label: checkedSourceLabel(knownLabel),
    summary: `${sourceName} checked ${formatCompactList(checkedScope)}.`,
    checkedScope,
    notCheckedScope,
    sourceName,
    ...(source.fetchedAt ? { sourceTime: source.fetchedAt } : {}),
    isPositiveClaim: true,
  };
}

export function sourceEvidenceDisplayName(
  source: Pick<SourceEvidenceInput, "sourceName" | "label">,
) {
  const trimmedName = source.sourceName.trim();
  if (/^google places api$/i.test(trimmedName)) {
    return "Google Places";
  }
  if (/^open-meteo weather api$/i.test(trimmedName)) {
    return "Weather forecast";
  }
  if (/^open-meteo marine api$/i.test(trimmedName)) {
    return "Marine forecast";
  }
  if (/^tide-forecast dapa page$/i.test(trimmedName)) {
    return "Dapa tide forecast";
  }
  if (/^browser saved trip$/i.test(trimmedName)) {
    return "Saved browser plan";
  }
  if (/generic model reasoning/i.test(trimmedName)) {
    return "Ask Siargao estimate";
  }
  return trimmedName
    .replace(/\s+API(?:\s+profile)?$/i, "")
    .replace(/^Ask Siargao curated local /i, "Ask Siargao local ")
    .trim();
}

export function sourceEvidenceDetailLines(source: SourceEvidenceInput) {
  const presentation = projectSourceEvidencePresentation(source);
  return [
    ...(presentation.checkedScope.length > 0 && presentation.state === "checked"
      ? [`Checked details: ${formatCompactList(presentation.checkedScope)}`]
      : []),
    ...(presentation.notCheckedScope.length > 0
      ? [`Not checked: ${formatCompactList(presentation.notCheckedScope)}`]
      : []),
  ];
}

export function sourceEvidenceSummaryText(sources: readonly SourceEvidenceInput[]) {
  const presentations = sources.map(projectSourceEvidencePresentation);
  const checkedNames = presentations
    .filter((presentation) => presentation.state === "checked")
    .map((presentation) => presentation.sourceName ?? presentation.label);
  const unavailableNames = presentations
    .filter((presentation) => presentation.state === "unavailable")
    .map((presentation) => presentation.sourceName ?? presentation.label);
  const notVerifiedNames = presentations
    .filter((presentation) => presentation.state === "not-verified")
    .map((presentation) => presentation.sourceName ?? presentation.label);

  if (checkedNames.length > 0) {
    const suffix =
      unavailableNames.length + notVerifiedNames.length > 0
        ? `; ${unavailableNames.length + notVerifiedNames.length} caveated`
        : "";
    return `Checked: ${formatCompactList(checkedNames)}${suffix}`;
  }
  if (unavailableNames.length > 0) {
    return `Could not check: ${formatCompactList(unavailableNames)}`;
  }
  if (notVerifiedNames.length > 0) {
    return `Not verified: ${formatCompactList(notVerifiedNames)}`;
  }
  return "No source details available";
}

export function formatEvidenceSourceTime(value: string | undefined) {
  return value ? `fetched ${value}` : undefined;
}

function conditionStateToEvidenceState(state: ConditionDecisionState): EvidencePresentationState {
  switch (state) {
    case "loading":
      return "checking";
    case "live":
    case "partial":
      return "checked";
    case "stale":
      return "stale";
    case "unavailable":
      return "unavailable";
    case "not-verified":
      return "not-verified";
  }
}

function checkedSourceLabel(label: AnswerTrustLabel) {
  switch (label) {
    case "live_checked":
    case "venue_checked":
      return "Places checked";
    case "fresh_cache":
      return "Recently checked";
    case "event_checked":
      return "Event checked";
    case "curated_local_guide":
      return "Guide info checked";
    case "weather_checked":
      return "Weather checked";
    case "marine_checked":
      return "Marine forecast checked";
    case "tide_forecast_checked":
      return "Tide forecast checked";
    case "community_signal":
      return "Community signal";
    case "web_researched":
      return "Public web checked";
    case "official_checked":
      return "Official source checked";
    case "directory_checked":
      return "Directory checked";
    default:
      return "Checked";
  }
}

function notVerifiedSourceLabel(label: AnswerTrustLabel) {
  switch (label) {
    case "no_current_event_facts":
      return "No current event facts";
    case "insufficient_web_evidence":
      return "Web evidence insufficient";
    default:
      return "Not verified";
  }
}

function isAnswerTrustLabel(value: string): value is AnswerTrustLabel {
  return (
    checkedSourceLabels.has(value as AnswerTrustLabel) ||
    unsupportedPositiveSourceLabels.has(value as AnswerTrustLabel)
  );
}

function normalizeItems(items: readonly string[]) {
  return items.map((item) => item.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function formatCompactList(values: readonly string[]) {
  if (values.length <= 3) {
    return values.join(", ");
  }
  return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
}

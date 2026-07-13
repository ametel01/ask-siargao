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
  sourceProfileId?: string;
  fetchedAt?: string;
  confidence?: "high" | "medium" | "low";
  checked: readonly string[];
  notChecked: readonly string[];
};

export type SourceEvidenceReceiptItem = {
  source: SourceEvidenceInput;
  presentation: EvidencePresentation;
  fetchedAtValues: readonly string[];
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

const evidenceReceiptTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

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
  const presentations = sourceEvidenceReceiptItems(sources).map((item) => item.presentation);
  const checkedNames: string[] = [];
  const unavailableNames: string[] = [];
  const notVerifiedNames: string[] = [];
  for (const presentation of presentations) {
    const name = presentation.sourceName ?? presentation.label;
    if (presentation.state === "checked") {
      checkedNames.push(name);
    } else if (presentation.state === "unavailable") {
      unavailableNames.push(name);
    } else if (presentation.state === "not-verified") {
      notVerifiedNames.push(name);
    }
  }

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

export function sourceEvidenceReceiptItems(
  sources: readonly SourceEvidenceInput[],
): SourceEvidenceReceiptItem[] {
  const results: SourceEvidenceReceiptItem[] = [];
  const indexesByKey = new Map<string, number>();

  for (const source of sources) {
    const key = sourceEvidenceReceiptKey(source);
    const existingIndex = indexesByKey.get(key);
    if (existingIndex === undefined) {
      indexesByKey.set(key, results.length);
      results.push({
        source: {
          ...source,
          checked: normalizeItems(source.checked),
          notChecked: normalizeItems(source.notChecked),
        },
        presentation: projectSourceEvidencePresentation(source),
        fetchedAtValues: source.fetchedAt ? [source.fetchedAt] : [],
      });
      continue;
    }

    const existing = results[existingIndex];
    if (!existing) {
      continue;
    }
    const fetchedAtValues = uniqueNormalizedItems([
      ...existing.fetchedAtValues,
      ...(source.fetchedAt ? [source.fetchedAt] : []),
    ]);
    const mergedSource = {
      ...existing.source,
      ...(latestSourceEvidenceTime(fetchedAtValues)
        ? { fetchedAt: latestSourceEvidenceTime(fetchedAtValues) }
        : {}),
      checked: uniqueNormalizedItems([...existing.source.checked, ...source.checked]),
      notChecked: uniqueNormalizedItems([...existing.source.notChecked, ...source.notChecked]),
    };
    results[existingIndex] = {
      source: mergedSource,
      presentation: projectSourceEvidencePresentation(mergedSource),
      fetchedAtValues,
    };
  }

  return results;
}

export function sourceEvidenceReceiptSummaryText(sources: readonly SourceEvidenceInput[]) {
  const items = sourceEvidenceReceiptItems(sources);
  const checkedNames: string[] = [];
  const gapNames: string[] = [];
  for (const item of items) {
    const { label, sourceName, state } = item.presentation;
    const name = sourceName ?? label;
    if (state === "checked") {
      checkedNames.push(name);
    } else if (state === "unavailable" || state === "not-verified") {
      gapNames.push(name);
    }
  }
  const latestFetchedAt = latestSourceEvidenceTime(items.flatMap((item) => item.fetchedAtValues));
  const freshness = latestFetchedAt
    ? `Latest check ${formatEvidenceReceiptTime(latestFetchedAt)}`
    : "No check time shown";

  if (checkedNames.length > 0 && gapNames.length > 0) {
    return `${freshness}: ${formatCompactList(checkedNames)} checked; ${gapNames.length} verification ${
      gapNames.length === 1 ? "gap" : "gaps"
    }.`;
  }
  if (checkedNames.length > 0) {
    return `${freshness}: ${formatCompactList(checkedNames)} checked.`;
  }
  if (gapNames.length > 0) {
    return `${freshness}: ${formatCompactList(gapNames)} ${
      gapNames.length === 1 ? "was" : "were"
    } not verified.`;
  }
  return "No evidence receipt available.";
}

export function formatEvidenceSourceTime(value: string | undefined) {
  return value ? `fetched ${value}` : undefined;
}

export function formatEvidenceReceiptTime(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return evidenceReceiptTimeFormatter.format(timestamp).replace(" at ", ", ");
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
  return items.flatMap((item) => {
    const normalized = item.replace(/\s+/g, " ").trim();
    return normalized ? [normalized] : [];
  });
}

function uniqueNormalizedItems(items: readonly string[]) {
  return [...new Set(normalizeItems(items))];
}

function sourceEvidenceReceiptKey(source: SourceEvidenceInput) {
  return JSON.stringify({
    label: source.label,
    sourceName: sourceEvidenceDisplayName(source).toLocaleLowerCase(),
    sourceProfileId: "sourceProfileId" in source ? source.sourceProfileId : undefined,
    confidence: "confidence" in source ? source.confidence : undefined,
  });
}

function latestSourceEvidenceTime(values: readonly string[]) {
  let latestValue: string | undefined;
  let latestTimestamp = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    const timestamp = new Date(value).getTime();
    if (Number.isFinite(timestamp) && timestamp > latestTimestamp) {
      latestTimestamp = timestamp;
      latestValue = value;
    }
  }
  return latestValue;
}

function formatCompactList(values: readonly string[]) {
  if (values.length <= 3) {
    return values.join(", ");
  }
  return `${values.slice(0, 3).join(", ")} +${values.length - 3}`;
}

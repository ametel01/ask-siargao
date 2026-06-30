export type AnswerTrustLabel =
  | "live_checked"
  | "fresh_cache"
  | "event_checked"
  | "venue_checked"
  | "curated_local_guide"
  | "weather_checked"
  | "marine_checked"
  | "tide_forecast_checked"
  | "community_signal"
  | "no_current_event_facts"
  | "web_researched"
  | "official_checked"
  | "directory_checked"
  | "insufficient_web_evidence"
  | "not_verified"
  | "provider_unavailable";

export type AnswerSourceSummary = {
  label: AnswerTrustLabel;
  sourceName: string;
  sourceProfileId?: string;
  fetchedAt?: string;
  confidence?: "high" | "medium" | "low";
  checked: string[];
  notChecked: string[];
};

export type GooglePlacesSourceFreshness = "live" | "fresh_cache" | "stale_cache";

export type RenderAnswerSourceSummaryOptions = {
  weatherSignal?: string;
};

const verifyingLabels = new Set<AnswerTrustLabel>([
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

const trustLabelText: Record<AnswerTrustLabel, string> = {
  live_checked: "live checked",
  fresh_cache: "fresh cache",
  event_checked: "event checked",
  venue_checked: "venue checked",
  curated_local_guide: "curated local guide",
  weather_checked: "weather checked",
  marine_checked: "marine checked",
  tide_forecast_checked: "tide forecast checked",
  community_signal: "community signal",
  no_current_event_facts: "no current event facts",
  web_researched: "web researched",
  official_checked: "official checked",
  directory_checked: "directory checked",
  insufficient_web_evidence: "insufficient web evidence",
  not_verified: "not verified",
  provider_unavailable: "provider unavailable",
};

export function googlePlacesFreshnessToTrustLabel(
  freshness: GooglePlacesSourceFreshness,
): AnswerTrustLabel {
  if (freshness === "live") {
    return "live_checked";
  }
  if (freshness === "fresh_cache") {
    return "fresh_cache";
  }
  return "not_verified";
}

export function renderAnswerSourceSummaryMarkdown(
  summaries: readonly AnswerSourceSummary[],
  options: RenderAnswerSourceSummaryOptions = {},
) {
  return renderAnswerSourceLines(summaries, options).join("\n");
}

export function renderAnswerSourceLines(
  summaries: readonly AnswerSourceSummary[],
  options: RenderAnswerSourceSummaryOptions = {},
) {
  const checkedLines = summaries.flatMap((summary) => renderCheckedLine(summary));
  const notCheckedLines = summaries.flatMap((summary) => renderNotCheckedLine(summary));
  const weatherSignal = normalizeText(options.weatherSignal);
  return [
    ...checkedLines,
    ...(weatherSignal ? [`Weather signal: ${weatherSignal}.`] : []),
    ...notCheckedLines,
  ];
}

function renderCheckedLine(summary: AnswerSourceSummary) {
  if (!verifyingLabels.has(summary.label)) {
    return [];
  }
  const checked = normalizeItems(summary.checked);
  if (checked.length === 0) {
    return [];
  }
  return [`Checked: ${sourceDescriptor(summary)} - ${formatItems(checked)}.`];
}

function renderNotCheckedLine(summary: AnswerSourceSummary) {
  const notChecked = normalizeItems(summary.notChecked);
  if (notChecked.length === 0) {
    return [];
  }
  return [`Not checked: ${sourceDescriptor(summary)} - ${formatItems(notChecked)}.`];
}

function sourceDescriptor(summary: AnswerSourceSummary) {
  const metadata = [
    trustLabelText[summary.label],
    ...(summary.confidence ? [`${summary.confidence} confidence`] : []),
    ...(summary.sourceProfileId ? [`profile ${summary.sourceProfileId}`] : []),
    ...(summary.fetchedAt ? [`fetched ${summary.fetchedAt}`] : []),
  ];
  return `${summary.sourceName} (${metadata.join("; ")})`;
}

function normalizeItems(items: readonly string[]) {
  return items.flatMap((item) => {
    const normalizedItem = normalizeText(item);
    return normalizedItem.length > 0 ? [normalizedItem] : [];
  });
}

function normalizeText(value: string | undefined) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function formatItems(items: readonly string[]) {
  if (items.length === 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  const lastItem = items.at(-1);
  const leadingItems = items.slice(0, -1);
  return `${leadingItems.join(", ")}, and ${lastItem}`;
}

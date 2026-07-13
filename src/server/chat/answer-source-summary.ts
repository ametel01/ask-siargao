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

const sourceTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "Asia/Manila",
});

const trustLabelText: Record<AnswerTrustLabel, string> = {
  live_checked: "Places checked",
  fresh_cache: "Recently checked",
  event_checked: "Event checked",
  venue_checked: "Places checked",
  curated_local_guide: "Guide info checked",
  weather_checked: "Weather checked",
  marine_checked: "Marine forecast checked",
  tide_forecast_checked: "Tide forecast checked",
  community_signal: "Community signal",
  no_current_event_facts: "No current event facts",
  web_researched: "Public web checked",
  official_checked: "Official source checked",
  directory_checked: "Directory checked",
  insufficient_web_evidence: "Web evidence insufficient",
  not_verified: "Not verified",
  provider_unavailable: "Could not check",
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
    ...(summary.fetchedAt ? [`checked ${formatSourceTime(summary.fetchedAt)}`] : []),
  ];
  return `${sourceDisplayName(summary.sourceName)} (${metadata.join("; ")})`;
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

function sourceDisplayName(value: string) {
  const trimmed = value.trim();
  if (/^google places api$/i.test(trimmed)) {
    return "Google Places";
  }
  if (/^open-meteo weather api$/i.test(trimmed)) {
    return "Weather forecast";
  }
  if (/^open-meteo marine api$/i.test(trimmed)) {
    return "Marine forecast";
  }
  if (/^browser saved trip$/i.test(trimmed)) {
    return "Saved browser plan";
  }
  if (/generic model reasoning/i.test(trimmed)) {
    return "Ask Siargao estimate";
  }
  return trimmed
    .replace(/\s+API(?:\s+profile)?$/i, "")
    .replace(/^Ask Siargao curated local /i, "Ask Siargao local ")
    .trim();
}

function formatSourceTime(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return sourceTimeFormatter.format(timestamp).replace(" at ", ", ");
}

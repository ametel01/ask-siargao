import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import type { SavedTripItem } from "@/server/trips/shared-trip-types";

export const savedTripArtifactDecisionLabels = [
  "best_fit",
  "good_now",
  "fallback",
  "avoid_today",
  "needs_confirmation",
] as const;

export type SavedTripArtifactDecisionLabel = (typeof savedTripArtifactDecisionLabels)[number];

export type SavedTripArtifactDecisionMetadata = {
  label: SavedTripArtifactDecisionLabel;
  bestAction: string;
};

export type SavedTripSourceArtifact = {
  label: string;
  sourceName: string;
  sourceProfileId?: string;
  fetchedAt?: string;
  confidence?: "high" | "medium" | "low";
  checked: readonly string[];
  notChecked: readonly string[];
};

export type RecommendationCardSavedArtifact = {
  id: string;
  kind: "place" | "beach";
  title: string;
  subtitle?: string;
  mapsUrl?: string;
  distanceLabel?: string;
  openStatusLabel?: string;
  fitReasons: readonly string[];
  caveats: readonly string[];
  sourceLabel: string;
  decision?: SavedTripArtifactDecisionMetadata;
  sources?: readonly SavedTripSourceArtifact[];
};

export type ItineraryStopSavedArtifact = {
  title: string;
  kind: "place" | "beach" | "activity" | "meal" | "transfer";
  sequence: number;
  area?: string;
  travelTimeFromPreviousMinutes?: number;
  mapsUrl?: string;
  rationale: string;
  caveats: readonly string[];
};

export type ItineraryPlanSavedArtifact = {
  id?: string;
  title: string;
  durationLabel: string;
  decision?: SavedTripArtifactDecisionMetadata;
  stops: readonly ItineraryStopSavedArtifact[];
  fallbackStops: readonly ItineraryStopSavedArtifact[];
  skip: readonly string[];
  sources: readonly SavedTripSourceArtifact[];
};

const maxShortTextLength = 180;
const maxMediumTextLength = 500;
const allowedMapsLinkHosts = new Set(["maps.app.goo.gl", "maps.google.com", "maps.google.com.ph"]);
const allowedGoogleMapsPathHosts = new Set([
  "google.com",
  "www.google.com",
  "google.com.ph",
  "www.google.com.ph",
]);
const savedTripSourceLabels = new Set<SavedTripItem["sources"][number]["label"]>([
  "live_checked",
  "fresh_cache",
  "event_checked",
  "venue_checked",
  "curated_local_guide",
  "weather_checked",
  "marine_checked",
  "tide_forecast_checked",
  "community_signal",
  "no_current_event_facts",
  "web_researched",
  "official_checked",
  "directory_checked",
  "insufficient_web_evidence",
  "not_verified",
  "provider_unavailable",
]);

export function buildSavedTripItemFromRecommendationCardArtifact({
  card,
  id = savedTripItemIdForRecommendationCard(card),
  savedAt,
  sources = card.sources ?? [],
  tripId,
}: {
  card: RecommendationCardSavedArtifact;
  id?: string;
  sources?: readonly SavedTripSourceArtifact[];
  savedAt: string;
  tripId?: string;
}): SavedTripItem {
  const itemId = normalizeSavedTripIdentifier(id);
  const title = normalizeSavedTripText(card.title, maxShortTextLength);
  const caveats = normalizeSavedTripTextArray(card.caveats, 16);
  const normalizedSources = normalizeSavedTripSources(sources);
  const mapsUrl = normalizeSavedTripMapsUrl(card.mapsUrl);

  return {
    id: itemId,
    ...(tripId ? { tripId: normalizeSavedTripIdentifier(tripId) } : {}),
    kind: card.kind,
    title,
    createdAt: savedAt,
    updatedAt: savedAt,
    payload: {
      type: "recommendation_card",
      card: {
        id: normalizeSavedTripIdentifier(card.id),
        kind: card.kind,
        title,
        ...(card.subtitle
          ? { subtitle: normalizeSavedTripText(card.subtitle, maxShortTextLength) }
          : {}),
        ...(mapsUrl ? { mapsUrl } : {}),
        ...(card.distanceLabel
          ? { distanceLabel: normalizeSavedTripText(card.distanceLabel, 80) }
          : {}),
        ...(card.openStatusLabel
          ? { openStatusLabel: normalizeSavedTripText(card.openStatusLabel, 80) }
          : {}),
        fitReasons: normalizeSavedTripTextArray(card.fitReasons, 8),
        caveats: normalizeSavedTripTextArray(card.caveats, 12),
        sourceLabel: normalizeSavedTripText(card.sourceLabel, maxShortTextLength),
        ...(card.decision ? { decision: normalizeSavedTripDecision(card.decision) } : {}),
      },
    },
    sources: normalizedSources,
    ...(mapsUrl ? { mapsUrl } : {}),
    caveats,
  };
}

export function buildSavedTripItemFromItineraryPlanArtifact({
  id,
  plan,
  savedAt,
  tripId,
}: {
  id?: string;
  plan: ItineraryPlanSavedArtifact;
  savedAt: string;
  tripId?: string;
}): SavedTripItem {
  const title = normalizeSavedTripText(plan.title, maxShortTextLength);
  const sources = normalizeSavedTripSources(plan.sources);

  return {
    id: normalizeSavedTripIdentifier(id ?? savedTripItemIdForItineraryPlan(plan)),
    ...(tripId ? { tripId: normalizeSavedTripIdentifier(tripId) } : {}),
    kind: "itinerary",
    title,
    createdAt: savedAt,
    updatedAt: savedAt,
    payload: {
      type: "itinerary_plan",
      plan: {
        title,
        durationLabel: normalizeSavedTripText(plan.durationLabel, 80),
        ...(plan.decision ? { decision: normalizeSavedTripDecision(plan.decision) } : {}),
        stops: plan.stops.map(normalizeSavedTripItineraryStop),
        fallbackStops: plan.fallbackStops.map(normalizeSavedTripItineraryStop),
        skip: normalizeSavedTripTextArray(plan.skip, 12),
        sources,
      },
    },
    sources,
    caveats: normalizeSavedTripTextArray(
      [
        ...plan.skip,
        ...plan.stops.flatMap((stop) => stop.caveats),
        ...plan.fallbackStops.flatMap((stop) => stop.caveats),
      ],
      16,
    ),
  };
}

export function savedTripItemIdForRecommendationCard(
  card: Pick<RecommendationCardSavedArtifact, "id" | "kind">,
) {
  return normalizeSavedTripIdentifier(`${card.kind}:${card.id}`);
}

export function savedTripItemIdForItineraryPlan(
  plan: Pick<ItineraryPlanSavedArtifact, "durationLabel" | "title">,
) {
  return normalizeSavedTripIdentifier(`itinerary:${plan.title}:${plan.durationLabel}`);
}

export function normalizeSavedTripIdentifier(value: string) {
  const normalizedValue = value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 128);
  return normalizedValue.length > 0 ? normalizedValue : "saved_item";
}

function normalizeSavedTripItineraryStop(stop: ItineraryStopSavedArtifact) {
  const mapsUrl = normalizeSavedTripMapsUrl(stop.mapsUrl);

  return {
    title: normalizeSavedTripText(stop.title, maxShortTextLength),
    kind: stop.kind,
    sequence: stop.sequence,
    ...(stop.area ? { area: normalizeSavedTripText(stop.area, 120) } : {}),
    ...(typeof stop.travelTimeFromPreviousMinutes === "number"
      ? { travelTimeFromPreviousMinutes: stop.travelTimeFromPreviousMinutes }
      : {}),
    ...(mapsUrl ? { mapsUrl } : {}),
    rationale: normalizeSavedTripText(stop.rationale, maxMediumTextLength),
    caveats: normalizeSavedTripTextArray(stop.caveats, 12),
  };
}

function normalizeSavedTripSources(
  sources: readonly SavedTripSourceArtifact[],
): AnswerSourceSummary[] {
  return sources.map((source) => ({
    label: normalizeSavedTripSourceLabel(source.label),
    sourceName: normalizeSavedTripText(source.sourceName, maxShortTextLength),
    ...(source.sourceProfileId
      ? { sourceProfileId: normalizeSavedTripText(source.sourceProfileId, maxShortTextLength) }
      : {}),
    ...(source.fetchedAt ? { fetchedAt: source.fetchedAt } : {}),
    ...(source.confidence ? { confidence: source.confidence } : {}),
    checked: normalizeSavedTripTextArray(source.checked, 12, maxShortTextLength),
    notChecked: normalizeSavedTripTextArray(source.notChecked, 16, maxShortTextLength),
  }));
}

function normalizeSavedTripSourceLabel(value: string): AnswerSourceSummary["label"] {
  return isSavedTripSourceLabel(value) ? value : "not_verified";
}

function isSavedTripSourceLabel(value: string): value is AnswerSourceSummary["label"] {
  return savedTripSourceLabels.has(value as SavedTripItem["sources"][number]["label"]);
}

function normalizeSavedTripDecision(
  decision: SavedTripArtifactDecisionMetadata,
): SavedTripArtifactDecisionMetadata {
  return {
    label: decision.label,
    bestAction: normalizeSavedTripText(decision.bestAction, maxShortTextLength),
  };
}

function normalizeSavedTripMapsUrl(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length === 0 || trimmedValue.length > 600) {
    return undefined;
  }

  try {
    const url = new URL(trimmedValue);
    return url.protocol === "https:" && isAllowedMapsUrl(url) ? trimmedValue : undefined;
  } catch {
    return undefined;
  }
}

function isAllowedMapsUrl(url: URL) {
  const hostname = url.hostname.toLowerCase();

  if (allowedMapsLinkHosts.has(hostname)) {
    return true;
  }

  if (!allowedGoogleMapsPathHosts.has(hostname)) {
    return false;
  }

  return url.pathname === "/maps" || url.pathname.startsWith("/maps/");
}

function normalizeSavedTripTextArray(
  values: readonly string[],
  maxItems: number,
  maxLength = maxMediumTextLength,
) {
  return values
    .flatMap((value) => {
      const normalizedValue = normalizeSavedTripText(value, maxLength);
      return normalizedValue.length > 0 ? [normalizedValue] : [];
    })
    .slice(0, maxItems);
}

function normalizeSavedTripText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

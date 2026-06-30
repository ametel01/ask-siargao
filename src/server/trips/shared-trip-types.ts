import { z } from "zod";

import {
  type ArtifactDecisionMetadata,
  artifactDecisionLabels,
  type ItineraryPlan,
  type ItineraryStop,
  type RecommendationCard,
} from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";

const savedTripItemKinds = ["place", "beach", "itinerary", "note"] as const;
export type SavedTripItemKind = (typeof savedTripItemKinds)[number];

const savedTripPayloadTypes = ["recommendation_card", "itinerary_plan", "note"] as const;
export type SavedTripPayloadType = (typeof savedTripPayloadTypes)[number];

const maxSavedTripItems = 50;
const maxSharedTripItemIds = 50;

const maxShortTextLength = 180;
const maxMediumTextLength = 500;
const maxNoteTextLength = 2_000;
const savedTripItemIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/;
const localTripIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{7,127}$/;

const trimmedString = (max: number) => z.string().trim().min(1).max(max);
const normalizedTextArraySchema = (maxItems: number, maxLength = maxMediumTextLength) =>
  z.array(trimmedString(maxLength)).max(maxItems);

const allowedMapsLinkHosts = new Set(["maps.app.goo.gl", "maps.google.com", "maps.google.com.ph"]);
const allowedGoogleMapsPathHosts = new Set([
  "google.com",
  "www.google.com",
  "google.com.ph",
  "www.google.com.ph",
]);

const savedTripItemIdSchema = z.string().regex(savedTripItemIdPattern).max(128);
export const localTripIdSchema = z.string().regex(localTripIdPattern).max(128);

export const mapsUrlSchema = z
  .url()
  .max(600)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && isAllowedMapsUrl(url);
  }, "Maps URLs must use an allowed HTTPS maps host.");

const answerSourceSummarySchema = z.strictObject({
  label: z.enum([
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
  ]),
  sourceName: trimmedString(maxShortTextLength),
  sourceProfileId: trimmedString(maxShortTextLength).optional(),
  fetchedAt: z.iso.datetime().optional(),
  confidence: z.enum(["high", "medium", "low"]).optional(),
  checked: normalizedTextArraySchema(12, maxShortTextLength),
  notChecked: normalizedTextArraySchema(16, maxShortTextLength),
});

const artifactDecisionMetadataSchema = z.strictObject({
  label: z.enum(artifactDecisionLabels),
  bestAction: trimmedString(maxShortTextLength),
});

const recommendationCardPayloadSchema = z.strictObject({
  id: savedTripItemIdSchema,
  kind: z.enum(["place", "beach"]),
  title: trimmedString(maxShortTextLength),
  subtitle: trimmedString(maxShortTextLength).optional(),
  mapsUrl: mapsUrlSchema.optional(),
  distanceLabel: trimmedString(80).optional(),
  openStatusLabel: trimmedString(80).optional(),
  fitReasons: normalizedTextArraySchema(8),
  caveats: normalizedTextArraySchema(12),
  sourceLabel: trimmedString(maxShortTextLength),
  decision: artifactDecisionMetadataSchema.optional(),
});

const itineraryStopPayloadSchema = z.strictObject({
  title: trimmedString(maxShortTextLength),
  kind: z.enum(["place", "beach", "activity", "meal", "transfer"]),
  sequence: z.number().int().min(1).max(20),
  area: trimmedString(120).optional(),
  travelTimeFromPreviousMinutes: z
    .number()
    .int()
    .min(0)
    .max(24 * 60)
    .optional(),
  mapsUrl: mapsUrlSchema.optional(),
  rationale: trimmedString(maxMediumTextLength),
  caveats: normalizedTextArraySchema(12),
});

const itineraryPlanPayloadSchema = z.strictObject({
  title: trimmedString(maxShortTextLength),
  durationLabel: trimmedString(80),
  decision: artifactDecisionMetadataSchema.optional(),
  stops: z.array(itineraryStopPayloadSchema).min(1).max(20),
  fallbackStops: z.array(itineraryStopPayloadSchema).max(12),
  skip: normalizedTextArraySchema(12),
  sources: z.array(answerSourceSummarySchema).max(12),
});

const savedRecommendationPayloadSchema = z.strictObject({
  type: z.literal("recommendation_card"),
  card: recommendationCardPayloadSchema,
});

const savedItineraryPayloadSchema = z.strictObject({
  type: z.literal("itinerary_plan"),
  plan: itineraryPlanPayloadSchema,
});

const savedNotePayloadSchema = z.strictObject({
  type: z.literal("note"),
  text: trimmedString(maxNoteTextLength),
});

const savedTripItemPayloadSchema = z.discriminatedUnion("type", [
  savedRecommendationPayloadSchema,
  savedItineraryPayloadSchema,
  savedNotePayloadSchema,
]);

export const savedTripItemSchema = z
  .strictObject({
    id: savedTripItemIdSchema,
    tripId: localTripIdSchema.optional(),
    kind: z.enum(savedTripItemKinds),
    title: trimmedString(maxShortTextLength),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    payload: savedTripItemPayloadSchema,
    sources: z.array(answerSourceSummarySchema).max(12),
    mapsUrl: mapsUrlSchema.optional(),
    caveats: normalizedTextArraySchema(16),
  })
  .superRefine((item, context) => {
    if (item.payload.type === "recommendation_card" && item.kind !== item.payload.card.kind) {
      context.addIssue({
        code: "custom",
        message: "Recommendation saved item kind must match the recommendation card kind.",
        path: ["kind"],
      });
    }

    if (item.payload.type === "itinerary_plan" && item.kind !== "itinerary") {
      context.addIssue({
        code: "custom",
        message: "Itinerary payloads must use the itinerary saved item kind.",
        path: ["kind"],
      });
    }

    if (item.payload.type === "note" && item.kind !== "note") {
      context.addIssue({
        code: "custom",
        message: "Note payloads must use the note saved item kind.",
        path: ["kind"],
      });
    }
  });

export const browserSavedTripStateSchema = z.strictObject({
  tripId: localTripIdSchema,
  items: z.array(savedTripItemSchema).max(maxSavedTripItems),
  updatedAt: z.iso.datetime(),
});

export const saveSavedTripItemsRequestSchema = z.strictObject({
  tripId: localTripIdSchema,
  items: z.array(savedTripItemSchema).max(maxSavedTripItems),
});

export const createSharedTripPlanRequestSchema = z.strictObject({
  tripId: localTripIdSchema,
  title: trimmedString(maxShortTextLength).optional(),
  itemIds: z.array(savedTripItemIdSchema).min(1).max(maxSharedTripItemIds),
  expiresAt: z.iso.datetime().optional(),
});

const sharedTripPlanSchema = z.strictObject({
  id: savedTripItemIdSchema,
  title: trimmedString(maxShortTextLength),
  items: z.array(savedTripItemSchema).max(maxSharedTripItemIds),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime().optional(),
});

export type SavedRecommendationPayload = z.infer<typeof savedRecommendationPayloadSchema>;
export type SavedItineraryPayload = z.infer<typeof savedItineraryPayloadSchema>;
export type SavedNotePayload = z.infer<typeof savedNotePayloadSchema>;
export type SavedTripItemPayload = z.infer<typeof savedTripItemPayloadSchema>;
export type SavedTripItem = z.infer<typeof savedTripItemSchema>;
export type BrowserSavedTripState = z.infer<typeof browserSavedTripStateSchema>;
export type SaveSavedTripItemsRequest = z.infer<typeof saveSavedTripItemsRequestSchema>;
export type CreateSharedTripPlanRequest = z.infer<typeof createSharedTripPlanRequestSchema>;
export type SharedTripPlan = z.infer<typeof sharedTripPlanSchema>;

export function normalizeSavedTripItem(input: unknown): SavedTripItem {
  return savedTripItemSchema.parse(input);
}

export function normalizeSharedTripPlan(input: unknown): SharedTripPlan {
  return sharedTripPlanSchema.parse(input);
}

export function publicSharedTripPlanFromStored(plan: SharedTripPlan): SharedTripPlan {
  return normalizeSharedTripPlan({
    ...plan,
    items: plan.items.map(publicSavedTripItemFromStored),
  });
}

export function savedTripItemFromRecommendationCard({
  card,
  id = card.id,
  sources = [],
  savedAt,
  tripId,
}: {
  card: RecommendationCard;
  id?: string;
  sources?: readonly AnswerSourceSummary[];
  savedAt: string;
  tripId?: string;
}): SavedTripItem {
  const { sources: _cardSources, ...cardPayload } = card;

  return normalizeSavedTripItem({
    id: normalizeIdentifier(id),
    ...(tripId ? { tripId: normalizeIdentifier(tripId) } : {}),
    kind: card.kind,
    title: normalizeText(card.title, maxShortTextLength),
    createdAt: savedAt,
    updatedAt: savedAt,
    payload: {
      type: "recommendation_card",
      card: {
        ...cardPayload,
        id: normalizeIdentifier(card.id),
        title: normalizeText(card.title, maxShortTextLength),
        ...(card.subtitle ? { subtitle: normalizeText(card.subtitle, maxShortTextLength) } : {}),
        fitReasons: normalizeTextArray(card.fitReasons, 8),
        caveats: normalizeTextArray(card.caveats, 12),
        sourceLabel: normalizeText(card.sourceLabel, maxShortTextLength),
        ...(card.decision ? { decision: normalizeArtifactDecision(card.decision) } : {}),
      },
    },
    sources: sources.map(normalizeSourceSummary),
    ...(card.mapsUrl ? { mapsUrl: normalizeMapsUrl(card.mapsUrl) } : {}),
    caveats: normalizeTextArray(card.caveats, 16),
  });
}

export function savedTripItemFromItineraryPlan({
  id,
  plan,
  savedAt,
  tripId,
}: {
  id: string;
  plan: ItineraryPlan;
  savedAt: string;
  tripId?: string;
}): SavedTripItem {
  return normalizeSavedTripItem({
    id: normalizeIdentifier(id),
    ...(tripId ? { tripId: normalizeIdentifier(tripId) } : {}),
    kind: "itinerary",
    title: normalizeText(plan.title, maxShortTextLength),
    createdAt: savedAt,
    updatedAt: savedAt,
    payload: {
      type: "itinerary_plan",
      plan: {
        ...plan,
        title: normalizeText(plan.title, maxShortTextLength),
        ...(plan.decision ? { decision: normalizeArtifactDecision(plan.decision) } : {}),
        stops: plan.stops.map(normalizeItineraryStop),
        fallbackStops: plan.fallbackStops.map(normalizeItineraryStop),
        skip: normalizeTextArray(plan.skip, 12),
        sources: plan.sources.map(normalizeSourceSummary),
      },
    },
    sources: plan.sources.map(normalizeSourceSummary),
    caveats: normalizeTextArray(
      [
        ...plan.skip,
        ...plan.stops.flatMap((stop) => stop.caveats),
        ...plan.fallbackStops.flatMap((stop) => stop.caveats),
      ],
      16,
    ),
  });
}

export function normalizePublicTripTitle(value: string | undefined) {
  return normalizeText(value || "Siargao saved plan", maxShortTextLength);
}

function normalizeIdentifier(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9:_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 128);
}

export function normalizeMapsUrl(value: string) {
  return mapsUrlSchema.parse(value.trim());
}

function normalizeItineraryStop(stop: ItineraryStop) {
  return {
    ...stop,
    title: normalizeText(stop.title, maxShortTextLength),
    ...(stop.area ? { area: normalizeText(stop.area, 120) } : {}),
    ...(stop.mapsUrl ? { mapsUrl: normalizeMapsUrl(stop.mapsUrl) } : {}),
    rationale: normalizeText(stop.rationale, maxMediumTextLength),
    caveats: normalizeTextArray(stop.caveats, 12),
  };
}

function normalizeSourceSummary(source: AnswerSourceSummary) {
  return {
    ...source,
    sourceName: normalizeText(source.sourceName, maxShortTextLength),
    ...(source.sourceProfileId
      ? { sourceProfileId: normalizeText(source.sourceProfileId, maxShortTextLength) }
      : {}),
    checked: normalizeTextArray(source.checked, 12, maxShortTextLength),
    notChecked: normalizeTextArray(source.notChecked, 16, maxShortTextLength),
  };
}

function normalizeArtifactDecision(decision: ArtifactDecisionMetadata): ArtifactDecisionMetadata {
  return {
    label: decision.label,
    bestAction: normalizeText(decision.bestAction, maxShortTextLength),
  };
}

function publicSavedTripItemFromStored(item: SavedTripItem): SavedTripItem {
  const payload = publicSavedTripPayloadFromStored(item.payload);

  return normalizeSavedTripItem({
    id: item.id,
    kind: item.kind,
    title: item.title,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    payload,
    sources: publicSourcesFromStored(item.sources),
    ...publicSavedItemDisplayFields(payload),
  });
}

function publicSavedTripPayloadFromStored(
  payload: SavedTripItem["payload"],
): SavedTripItem["payload"] {
  if (payload.type === "recommendation_card") {
    return {
      type: "recommendation_card",
      card: {
        ...payload.card,
        caveats: publicDisplayCaveats(payload.card.caveats),
      },
    };
  }

  if (payload.type === "itinerary_plan") {
    return {
      type: "itinerary_plan",
      plan: {
        ...payload.plan,
        stops: payload.plan.stops.map(publicItineraryStopFromStored),
        fallbackStops: payload.plan.fallbackStops.map(publicItineraryStopFromStored),
        skip: publicDisplayCaveats(payload.plan.skip),
        sources: publicSourcesFromStored(payload.plan.sources),
      },
    };
  }

  return payload;
}

function publicSavedItemDisplayFields(payload: SavedTripItem["payload"]) {
  if (payload.type === "recommendation_card") {
    return {
      ...(payload.card.mapsUrl ? { mapsUrl: payload.card.mapsUrl } : {}),
      caveats: payload.card.caveats,
    };
  }

  if (payload.type === "itinerary_plan") {
    return {
      caveats: [
        ...payload.plan.skip,
        ...payload.plan.stops.flatMap((stop) => stop.caveats),
        ...payload.plan.fallbackStops.flatMap((stop) => stop.caveats),
      ],
    };
  }

  return { caveats: [] };
}

function publicSourcesFromStored(sources: readonly AnswerSourceSummary[]) {
  const normalizedSources = sources.map(publicSourceSummaryFromStored);
  const hasBrowserSavedCaveat = normalizedSources.some(
    (source) =>
      source.label === browserSavedNotReverifiedSource.label &&
      source.sourceName === browserSavedNotReverifiedSource.sourceName,
  );

  if (hasBrowserSavedCaveat || normalizedSources.length >= 12) {
    return normalizedSources;
  }

  return [...normalizedSources, publicSourceSummaryFromStored(browserSavedNotReverifiedSource)];
}

function publicSourceSummaryFromStored(source: AnswerSourceSummary) {
  return normalizeSourceSummary(source);
}

function publicItineraryStopFromStored(
  stop: Extract<SavedTripItem["payload"], { type: "itinerary_plan" }>["plan"]["stops"][number],
) {
  return {
    ...stop,
    caveats: publicDisplayCaveats(stop.caveats),
  };
}

function publicDisplayCaveats(caveats: readonly string[]) {
  return caveats.filter((caveat) => !isInternalVerificationGap(caveat));
}

function isInternalVerificationGap(value: string) {
  return [
    /\bnot\s+checked\b/i,
    /\bwasn['’]?t\s+(?:separately\s+)?checked\b/i,
    /\bwere\s+not\s+checked\b/i,
    /\bno\s+live\b.{0,90}\bcheck\b/i,
    /\bunchecked\b/i,
    /\bnot\s+verified\b/i,
    /\bI\s+(?:didn['’]?t|did\s+not)\s+(?:live[-\s]?)?check\b/i,
    /\b(?:live[-\s]?)?check(?:ed|ing)?\s+(?:was|were|is|are)?\s*(?:not|needed|needs)\b/i,
    /\bcurated\s+local\s+guide\s+estimate\b/i,
    /\bexact\s+ride\s+time\s+depends\b/i,
    /\buser\s+constraints\s+preserved\b/i,
    /\borigin-specific\s+route\s+timing\b/i,
    /\bthis\s+artifact\b/i,
    /\bsource\s+caveats?\b/i,
    /\bavoid\s+overclaiming\b/i,
    /\buse\s+(?:search_places|places)\b/i,
    /\bplaces\s+evidence\b/i,
    /\b(?:open|opening|cafe|menu|booking|availability|crowd|quietness).{0,80}\bshould\s+be\s+checked\b/i,
    /\bclaim(?:ing)?\b.{0,80}\b(?:open|status|hours|safety|reliability)\b/i,
    /\bwithout\b.{0,80}\b(?:condition|safety|tide|surf|road).{0,40}\bcheck/i,
  ].some((pattern) => pattern.test(value));
}

function normalizeText(value: string, maxLength: number) {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeTextArray(
  values: readonly string[],
  maxItems: number,
  maxLength = maxMediumTextLength,
) {
  return values
    .flatMap((value) => {
      const normalizedValue = normalizeText(value, maxLength);
      return normalizedValue.length > 0 ? [normalizedValue] : [];
    })
    .slice(0, maxItems);
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

const browserSavedNotReverifiedSource: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Browser saved trip",
  confidence: "low",
  checked: [],
  notChecked: ["Saved from browser and not reverified by Ask Siargao before sharing."],
};

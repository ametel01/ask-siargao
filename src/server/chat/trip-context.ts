import type {
  ChatClientContext,
  ChatClientGeolocationConsentScope,
  ChatClientGeolocationContext,
} from "@/server/chat/agent-runtime";
import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";

export type TripContextLocationSource =
  | "user"
  | "gazetteer"
  | "browser_geolocation"
  | "google_places"
  | "profile"
  | "ui_draft";

export type TripContextLocationLabel =
  | "Cloud 9"
  | "Del Carmen Port"
  | "Sugba Lagoon"
  | "General Luna"
  | "Del Carmen"
  | "Dapa"
  | "Siargao Island";

export type TripContextLocation = {
  label: TripContextLocationLabel;
  area?: TripContextLocationLabel;
  source: TripContextLocationSource;
};

export type TransportMode = "walk" | "scooter" | "tricycle" | "van" | "unknown";

export type BudgetPreference = "cheap" | "mid" | "premium";

export type TravelerProfile = {
  withKids: boolean;
  budget?: BudgetPreference;
  avoidsRain: boolean;
  avoidsRockyBeach: boolean;
  surfAbility?: string;
  prefersQuietSleep: boolean;
};

export type TripContextActiveGoal =
  | "food"
  | "beach_swimming"
  | "beach_sunset"
  | "rain_plan"
  | "trip_advice"
  | "itinerary";

export type TemporaryModifier =
  | "open_now"
  | "covered"
  | "cheaper"
  | "rainy_day"
  | "swimming"
  | "sunset"
  | "beach_suitability"
  | "kids"
  | "budget"
  | "ride_time"
  | "itinerary";

export type TripContextBrowserGeolocation = {
  status: ChatClientGeolocationContext["status"];
  source: "browser_geolocation";
  consentScope?: ChatClientGeolocationConsentScope;
  usedAsProximityAnchor: boolean;
};

export type TripContext = {
  latestUserTurn: string;
  recentUserContext: string;
  fullUserContext: string;
  currentArea?: TripContextLocationLabel;
  currentLocation?: TripContextLocation;
  origin?: TripContextLocation;
  destination?: TripContextLocation;
  rideTimeLimitMinutes?: number;
  transportMode: TransportMode;
  travelerProfile: TravelerProfile;
  activeGoal?: TripContextActiveGoal;
  temporaryModifiers: TemporaryModifier[];
  durableConstraints: string[];
  accommodation?: string;
  dateRange?: string;
  travelerType?: string;
  surfAbility?: string;
  prefersQuietSleep: boolean;
  browserGeolocation: TripContextBrowserGeolocation;
  contextSources: TripContextSourceSummary;
  unresolvedReference?: "there";
};

export type ForecastLocationLabel =
  | "Siargao Island"
  | "Cloud 9"
  | "General Luna"
  | "Del Carmen"
  | "Dapa";

export type TripContextDraft = {
  accommodation?: string;
  dateRange?: string;
  travelerType?: string;
  nearbyArea?: ForecastLocationLabel;
};

export type TripContextDraftInput = Partial<TripContextDraft> | null | undefined;

export type UserProfileTripContext = {
  notes?: string | null;
  currentArea?: TripContextLocationLabel | null;
  accommodation?: string | null;
  dateRange?: string | null;
  travelerType?: string | null;
  transportMode?: TransportMode | null;
  rideTimeLimitMinutes?: number | null;
  durableConstraints?: string[];
};

export type TripContextProfileInput = Partial<{
  travelStyle: string | null;
  budgetLevel: string | null;
  dietaryNotes: string | null;
  accessibilityNotes: string | null;
  surfAbility: string | null;
  quietSleepPreference: boolean | null;
  weatherPreference: "avoid_rain" | "flexible" | null;
  interests: readonly string[];
  preferredAreas: readonly string[];
  tripContext: UserProfileTripContext;
}>;

export type TripContextClientGeolocationInput = {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  capturedAt: string;
  consentScope: ChatClientGeolocationConsentScope;
};

export type TripContextClientContextInput = {
  geolocation?: TripContextClientGeolocationInput;
  tripContext?: TripContextDraftInput;
};

export type TripContextClientContext = ChatClientContext & {
  tripContext?: TripContextDraft;
};

export type ChatRequestIntent = {
  tripContext: TripContext;
  locationLabel?: "Cloud 9" | "Del Carmen" | "General Luna" | "Siargao Island";
  nearby: boolean;
  nearMeUsesBrowserGeolocation: boolean;
  shouldDeclineNonSiargaoTopic: boolean;
};

export type TripContextSourceSummary = {
  chatWindow: boolean;
  profile: boolean;
  uiDraft: boolean;
  browserGeolocation: "missing" | "available" | "out_of_area" | "stale" | "low_accuracy";
};

export type TripContextValidationIssue = {
  path: string;
  message: string;
};

const defaultNearbyLocation: TripContextLocation = {
  label: "General Luna",
  area: "General Luna",
  source: "gazetteer",
};

const knownLocationLabels = [
  "Del Carmen Port",
  "Sugba Lagoon",
  "General Luna",
  "Cloud 9",
  "Del Carmen",
  "Dapa",
  "Siargao Island",
] as const;

export const tripContextStorageKey = "ask-siargao:trip-context:v1";

export const forecastLocationLabels = [
  "Cloud 9",
  "General Luna",
  "Del Carmen",
  "Dapa",
  "Siargao Island",
] as const satisfies readonly ForecastLocationLabel[];

export const tripContextProfileNotesMaxLength = 1000;
const maxTripContextTextLength = 80;
const maxRideTimeLimitMinutes = 360;
const maxGeolocationAgeMs = 30 * 60 * 1_000;
const maxFutureGeolocationSkewMs = 5 * 60 * 1_000;
const maxUsableAccuracyMeters = 3_000;

const allowedDurableConstraints = [
  "with_kids",
  "budget_cheap",
  "budget_mid",
  "budget_premium",
  "rain_avoidance",
  "avoid_rocky_beach",
  "no_scooter",
  "quiet_sleep",
] as const;

const profileTripContextKeys = [
  "notes",
  "currentArea",
  "accommodation",
  "dateRange",
  "travelerType",
  "transportMode",
  "rideTimeLimitMinutes",
  "durableConstraints",
] as const;

const siargaoAreaBounds = {
  minLatitude: 9.35,
  maxLatitude: 10.15,
  minLongitude: 125.75,
  maxLongitude: 126.45,
} as const;

export function deriveTripContext(
  messages: readonly AskSiargaoChatMessage[],
  options: {
    clientContext?: TripContextClientContext;
    profileContext?: TripContextProfileInput | null;
    uiDraft?: TripContextDraftInput;
  } = {},
): TripContext {
  const latestUserTurn = getLatestUserTurn(messages);
  const recentUserContext = getRecentUserContext(messages);
  const fullUserContext = joinContext(recentUserContext, latestUserTurn);
  const latestLocation = inferSiargaoLocationLabel(latestUserTurn);
  const recentLocation = inferSiargaoLocationLabel(recentUserContext);
  const reference = inferLocationReference(latestUserTurn);
  const profileSeed = tripContextSeedFromProfile(options.profileContext);
  const uiDraft =
    options.profileContext === null || options.profileContext === undefined
      ? (options.uiDraft ?? options.clientContext?.tripContext)
      : undefined;
  const uiSeed = tripContextSeedFromDraft(uiDraft);
  const activeGoal = inferActiveGoal(latestUserTurn, recentUserContext);
  const nearMeUsesBrowserGeolocation =
    isBrowserLocationNearMeRequest(latestUserTurn) &&
    options.clientContext?.geolocation.status === "available";
  const currentLocation = resolveCurrentLocation({
    latestLocation,
    nearMeUsesBrowserGeolocation,
    profileLocation: profileSeed.currentLocation,
    recentLocation,
    reference,
    uiLocation: uiSeed.currentLocation,
  });
  const routeLocations = inferRouteLocations(fullUserContext);
  const inferredTravelerProfile = inferTravelerProfile(fullUserContext);
  const latestTravelerProfile = inferTravelerProfile(latestUserTurn);
  const chatTravelerProfile = {
    ...inferredTravelerProfile,
    budget: latestTravelerProfile.budget ?? inferredTravelerProfile.budget,
  };
  const travelerProfile = mergeTravelerProfiles(
    chatTravelerProfile,
    uiSeed.travelerProfile,
    profileSeed.travelerProfile,
  );
  const latestTransportMode = inferTransportMode(latestUserTurn);
  const durableConstraints = reconcileLatestDurableConstraints(
    inferDurableConstraints(fullUserContext, travelerProfile, [
      ...profileSeed.durableConstraints,
      ...uiSeed.durableConstraints,
    ]),
    {
      latestBudget: latestTravelerProfile.budget,
      latestTransportMode,
    },
  );
  const rideTimeLimitMinutes =
    inferRideTimeLimitMinutes(fullUserContext) ??
    uiSeed.rideTimeLimitMinutes ??
    profileSeed.rideTimeLimitMinutes;
  const transportMode = firstTransportMode([
    latestTransportMode,
    inferTransportMode(fullUserContext),
    uiSeed.transportMode,
    profileSeed.transportMode,
  ]);
  const temporaryModifiers = inferTemporaryModifiers({
    activeGoal,
    latestUserTurn,
    rideTimeLimitMinutes: inferRideTimeLimitMinutes(latestUserTurn),
  });
  const browserGeolocation = summarizeBrowserGeolocation(
    options.clientContext?.geolocation,
    nearMeUsesBrowserGeolocation,
  );
  const contextSources = {
    chatWindow: Boolean(
      latestLocation ||
        recentLocation ||
        inferredTravelerProfile.withKids ||
        inferredTravelerProfile.budget ||
        inferredTravelerProfile.avoidsRain ||
        inferredTravelerProfile.avoidsRockyBeach ||
        transportMode !== "unknown" ||
        rideTimeLimitMinutes,
    ),
    profile: profileSeed.hasContext,
    uiDraft: uiSeed.hasContext,
    browserGeolocation: browserGeolocation.status,
  } satisfies TripContextSourceSummary;

  return {
    latestUserTurn,
    recentUserContext,
    fullUserContext,
    ...(currentLocation ? { currentArea: currentLocation.area ?? currentLocation.label } : {}),
    ...(currentLocation ? { currentLocation } : {}),
    ...(routeLocations.origin ? { origin: routeLocations.origin } : {}),
    ...(routeLocations.destination ? { destination: routeLocations.destination } : {}),
    ...(rideTimeLimitMinutes ? { rideTimeLimitMinutes } : {}),
    transportMode,
    travelerProfile,
    ...(activeGoal ? { activeGoal } : {}),
    temporaryModifiers,
    durableConstraints,
    ...((uiSeed.accommodation ?? profileSeed.accommodation)
      ? { accommodation: uiSeed.accommodation ?? profileSeed.accommodation }
      : {}),
    ...((uiSeed.dateRange ?? profileSeed.dateRange)
      ? { dateRange: uiSeed.dateRange ?? profileSeed.dateRange }
      : {}),
    ...((uiSeed.travelerType ?? profileSeed.travelerType)
      ? { travelerType: uiSeed.travelerType ?? profileSeed.travelerType }
      : {}),
    ...(profileSeed.surfAbility ? { surfAbility: profileSeed.surfAbility } : {}),
    prefersQuietSleep: travelerProfile.prefersQuietSleep,
    browserGeolocation,
    contextSources,
    ...(reference === "there" && !currentLocation ? { unresolvedReference: "there" as const } : {}),
  };
}

export function interpretChatRequestIntent({
  clientContext,
  messages,
  profileContext,
}: {
  clientContext?: TripContextClientContext;
  messages: readonly AskSiargaoChatMessage[];
  profileContext?: TripContextProfileInput | null;
}): ChatRequestIntent {
  const tripContext = deriveTripContext(messages, {
    clientContext,
    profileContext,
  });
  const locationLabel = inferChatLocationLabelFromTripContext(tripContext);
  const nearby = /\bnear(?:by)?|around|close\s+to|that\s+area|in\s+that\s+area|by\s+/i.test(
    tripContext.fullUserContext,
  );

  return {
    tripContext,
    ...(locationLabel ? { locationLabel } : {}),
    nearby,
    nearMeUsesBrowserGeolocation: tripContext.browserGeolocation.usedAsProximityAnchor,
    shouldDeclineNonSiargaoTopic: shouldDeclineNonSiargaoTopic(messages),
  };
}

export function normalizeTripContextClientContext(
  clientContext: TripContextClientContextInput | undefined,
  now: Date,
): TripContextClientContext {
  const tripContext = normalizeOptionalTripContextDraft(clientContext?.tripContext);
  return {
    geolocation: normalizeClientGeolocation(clientContext?.geolocation, now),
    ...(tripContext ? { tripContext } : {}),
  };
}

export function normalizeClientGeolocation(
  geolocation: TripContextClientGeolocationInput | undefined,
  now: Date,
): ChatClientGeolocationContext {
  if (!geolocation) {
    return {
      status: "missing",
      source: "browser_geolocation",
    };
  }

  const base = {
    source: "browser_geolocation",
    consentScope: geolocation.consentScope,
  } as const;

  if (!isInSiargaoArea(geolocation.latitude, geolocation.longitude)) {
    return {
      ...base,
      status: "out_of_area",
    };
  }

  if (isStaleGeolocation(geolocation.capturedAt, now)) {
    return {
      ...base,
      status: "stale",
    };
  }

  if (
    geolocation.accuracyMeters !== undefined &&
    geolocation.accuracyMeters > maxUsableAccuracyMeters
  ) {
    return {
      ...base,
      status: "low_accuracy",
    };
  }

  return {
    ...base,
    status: "available",
    latitude: geolocation.latitude,
    longitude: geolocation.longitude,
    ...(geolocation.accuracyMeters !== undefined
      ? { accuracyMeters: geolocation.accuracyMeters }
      : {}),
    capturedAt: geolocation.capturedAt,
  };
}

export function normalizeTripContextDraft(
  context: TripContextDraftInput = undefined,
): TripContextDraft {
  const accommodation = normalizedOptionalContextText(context?.accommodation);
  const dateRange = normalizedOptionalContextText(context?.dateRange);
  const travelerType = normalizedOptionalContextText(context?.travelerType);

  return {
    ...(accommodation ? { accommodation } : {}),
    ...(dateRange ? { dateRange } : {}),
    ...(travelerType ? { travelerType } : {}),
    ...(isForecastLocationLabel(context?.nearbyArea) ? { nearbyArea: context.nearbyArea } : {}),
  };
}

export function normalizeOptionalTripContextDraft(
  context: TripContextDraftInput,
): TripContextDraft | undefined {
  if (!context || typeof context !== "object") {
    return undefined;
  }
  const normalized = normalizeTripContextDraft(context);
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function parseUserProfileTripContextPatch(
  value: unknown,
):
  | { success: true; data: UserProfileTripContext }
  | { success: false; issues: TripContextValidationIssue[] } {
  if (value === undefined) {
    return { success: true, data: {} };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      success: false,
      issues: [{ path: "tripContext", message: "Expected an object." }],
    };
  }

  const record = value as Record<string, unknown>;
  const issues: TripContextValidationIssue[] = [];
  for (const key of Object.keys(record)) {
    if (!profileTripContextKeys.includes(key as (typeof profileTripContextKeys)[number])) {
      issues.push({ path: `tripContext.${key}`, message: "Unrecognized key." });
    }
  }
  if ("geolocation" in record || "latitude" in record || "longitude" in record) {
    issues.push({
      path: "tripContext.geolocation",
      message: "Raw browser coordinates are not accepted in profile trip context.",
    });
  }

  const data: UserProfileTripContext = {};
  readNullableBoundedText(
    record.notes,
    "tripContext.notes",
    tripContextProfileNotesMaxLength,
    data,
    "notes",
    issues,
  );
  readNullableBoundedLocation(
    record.currentArea,
    "tripContext.currentArea",
    data,
    "currentArea",
    issues,
  );
  readNullableBoundedText(
    record.accommodation,
    "tripContext.accommodation",
    maxTripContextTextLength,
    data,
    "accommodation",
    issues,
  );
  readNullableBoundedText(
    record.dateRange,
    "tripContext.dateRange",
    maxTripContextTextLength,
    data,
    "dateRange",
    issues,
  );
  readNullableBoundedText(
    record.travelerType,
    "tripContext.travelerType",
    maxTripContextTextLength,
    data,
    "travelerType",
    issues,
  );
  readNullableTransportMode(record.transportMode, data, issues);
  readNullableRideTimeLimit(record.rideTimeLimitMinutes, data, issues);
  readDurableConstraints(record.durableConstraints, data, issues);

  return issues.length ? { success: false, issues } : { success: true, data };
}

export function normalizeStoredProfileTripContext(value: unknown): UserProfileTripContext {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const storedRecord = parsed as Record<string, unknown>;
  const boundedStoredRecord = Object.fromEntries(
    profileTripContextKeys
      .filter((key) => key in storedRecord)
      .map((key) => [key, storedRecord[key]]),
  );
  const normalized = parseUserProfileTripContextPatch(boundedStoredRecord);
  return normalized.success ? normalized.data : {};
}

export function summarizeTripContextForAgent(intent: ChatRequestIntent) {
  return {
    ...(intent.locationLabel ? { locationLabel: intent.locationLabel } : {}),
    nearby: intent.nearby,
    browserGeolocation: intent.tripContext.browserGeolocation,
    tripContext: safeTripContextSummary(intent.tripContext),
  };
}

export function summarizeClientContextForAgent(clientContext: TripContextClientContext) {
  const geolocation = clientContext.geolocation;
  return {
    geolocation: {
      status: geolocation.status,
      source: geolocation.source,
      consentScope: geolocation.consentScope,
      ...(geolocation.status === "available" ? { centerSource: "browser_geolocation" } : {}),
    },
  };
}

export function summarizeClientContextForMetadata(clientContext: TripContextClientContext) {
  return {
    geolocation: summarizeGeolocationForMetadata(clientContext.geolocation),
    ...(clientContext.tripContext
      ? {
          tripContext: {
            hasAccommodation: Boolean(clientContext.tripContext.accommodation),
            hasDateRange: Boolean(clientContext.tripContext.dateRange),
            travelerType: clientContext.tripContext.travelerType,
            nearbyArea: clientContext.tripContext.nearbyArea,
          },
        }
      : {}),
  };
}

export function summarizeTripContextForLogs(intent: ChatRequestIntent) {
  return {
    locationLabel: intent.locationLabel,
    nearby: intent.nearby,
    nearMeUsesBrowserGeolocation: intent.nearMeUsesBrowserGeolocation,
    tripContext: {
      currentLocation: intent.tripContext.currentLocation?.label,
      currentLocationSource: intent.tripContext.currentLocation?.source,
      durableConstraints: intent.tripContext.durableConstraints,
      temporaryModifiers: intent.tripContext.temporaryModifiers,
      unresolvedReference: intent.tripContext.unresolvedReference,
      hasAccommodation: Boolean(intent.tripContext.accommodation),
      hasDateRange: Boolean(intent.tripContext.dateRange),
      travelerType: intent.tripContext.travelerType,
      contextSources: intent.tripContext.contextSources,
      browserGeolocation: intent.tripContext.browserGeolocation,
    },
    shouldDeclineNonSiargaoTopic: intent.shouldDeclineNonSiargaoTopic,
  };
}

function summarizeGeolocationForMetadata(geolocation: ChatClientGeolocationContext) {
  return {
    status: geolocation.status,
    source: geolocation.source,
    consentScope: geolocation.consentScope,
  };
}

export function summarizeTripContextForStoredHistory(intent: ChatRequestIntent) {
  return {
    tripContext: {
      currentArea: intent.tripContext.currentArea,
      currentLocationSource: intent.tripContext.currentLocation?.source,
      durableConstraints: intent.tripContext.durableConstraints,
      temporaryModifiers: intent.tripContext.temporaryModifiers,
      unresolvedReference: intent.tripContext.unresolvedReference,
      hasAccommodation: Boolean(intent.tripContext.accommodation),
      hasDateRange: Boolean(intent.tripContext.dateRange),
      travelerType: intent.tripContext.travelerType,
      contextSources: intent.tripContext.contextSources,
    },
    geolocation: intent.tripContext.browserGeolocation,
  };
}

export function getLatestUserTurn(messages: readonly AskSiargaoChatMessage[]) {
  return messages.filter((message) => message.role === "user").at(-1)?.content ?? "";
}

export function getRecentUserContext(messages: readonly AskSiargaoChatMessage[]) {
  const userTurns = messages.filter((message) => message.role === "user");
  return userTurns
    .slice(0, -1)
    .slice(-6)
    .map((message) => message.content)
    .join(" ");
}

export function inferSiargaoLocationLabel(content: string): TripContextLocationLabel | null {
  if (/\bcloud\s*9|cloud9|catangnan\b/i.test(content)) {
    return "Cloud 9";
  }
  if (/\bdel\s+carmen\s+port\b/i.test(content)) {
    return "Del Carmen Port";
  }
  if (/\bsugba\s+lagoon\b/i.test(content)) {
    return "Sugba Lagoon";
  }
  if (/\bgeneral\s+luna|\bgl\b/i.test(content)) {
    return "General Luna";
  }
  if (/\bdel\s+carmen\b/i.test(content)) {
    return "Del Carmen";
  }
  if (/\bdapa\b/i.test(content)) {
    return "Dapa";
  }
  if (/\bsiargao\b/i.test(content)) {
    return "Siargao Island";
  }

  const normalizedContent = normalizeKey(content);
  return (
    knownLocationLabels.find((label) => normalizedContent.includes(normalizeKey(label))) ?? null
  );
}

export function isBrowserLocationNearMeRequest(content: string) {
  return /\b(?:near\s+me|around\s+me|close\s+to\s+me|by\s+me|my\s+(?:location|area)|current\s+location|where\s+i\s+am|around\s+here|near\s+here|near\s+us|around\s+us|close\s+to\s+us)\b/i.test(
    content,
  );
}

function safeTripContextSummary(tripContext: TripContext) {
  return {
    ...(tripContext.currentArea ? { currentArea: tripContext.currentArea } : {}),
    ...(tripContext.currentLocation
      ? {
          currentLocation: {
            label: tripContext.currentLocation.label,
            area: tripContext.currentLocation.area,
            source: tripContext.currentLocation.source,
          },
        }
      : {}),
    ...(tripContext.origin ? { origin: tripContext.origin.label } : {}),
    ...(tripContext.destination ? { destination: tripContext.destination.label } : {}),
    ...(tripContext.rideTimeLimitMinutes
      ? { rideTimeLimitMinutes: tripContext.rideTimeLimitMinutes }
      : {}),
    transportMode: tripContext.transportMode,
    travelerProfile: tripContext.travelerProfile,
    ...(tripContext.activeGoal ? { activeGoal: tripContext.activeGoal } : {}),
    temporaryModifiers: tripContext.temporaryModifiers,
    durableConstraints: tripContext.durableConstraints,
    ...(tripContext.travelerType ? { travelerType: tripContext.travelerType } : {}),
    ...(tripContext.unresolvedReference
      ? { unresolvedReference: tripContext.unresolvedReference }
      : {}),
  };
}

function summarizeBrowserGeolocation(
  geolocation: ChatClientGeolocationContext | undefined,
  usedAsProximityAnchor: boolean,
): TripContextBrowserGeolocation {
  return {
    status: geolocation?.status ?? "missing",
    source: "browser_geolocation",
    consentScope: geolocation?.consentScope,
    usedAsProximityAnchor,
  };
}

function inferRideTimeLimitMinutes(content: string) {
  const match =
    /\b(?:within|under|max(?:imum)?|no\s+more\s+than|less\s+than|about)\s+(\d{1,3})\s*(?:min|mins|minutes?)\b/i.exec(
      content,
    ) ?? /\b(\d{1,3})\s*(?:min|mins|minutes?)\s+(?:ride|drive|walk)\b/i.exec(content);
  if (!match?.[1]) {
    return undefined;
  }
  return Number(match[1]);
}

function inferTransportMode(content: string): TransportMode {
  if (/\bno\s+scooter|without\s+(?:a\s+)?scooter|do\s+not\s+ride|don't\s+ride\b/i.test(content)) {
    return "walk";
  }
  if (/\bscooter|motorbike|motor\s*bike\b/i.test(content)) {
    return "scooter";
  }
  if (/\btricycle\b/i.test(content)) {
    return "tricycle";
  }
  if (/\bvan|transfer\b/i.test(content)) {
    return "van";
  }
  if (/\bwalk(?:ing)?|on\s+foot\b/i.test(content)) {
    return "walk";
  }
  return "unknown";
}

function joinContext(recentUserContext: string, latestUserTurn: string) {
  return [recentUserContext, latestUserTurn].filter(Boolean).join(" ");
}

function inferLocationReference(content: string): "there" | "nearby" | null {
  if (/\bnear(?:by)?|around|close\s+to|by\s+/i.test(content)) {
    return "nearby";
  }
  if (/\b(?:is|are|was|were)\s+there\b/i.test(content)) {
    return null;
  }
  if (/\bthere|that\s+area|in\s+that\s+area\b/i.test(content)) {
    return "there";
  }
  return null;
}

function resolveCurrentLocation({
  latestLocation,
  nearMeUsesBrowserGeolocation,
  profileLocation,
  recentLocation,
  reference,
  uiLocation,
}: {
  latestLocation: TripContextLocationLabel | null;
  nearMeUsesBrowserGeolocation: boolean;
  profileLocation: TripContextLocation | undefined;
  recentLocation: TripContextLocationLabel | null;
  reference: "there" | "nearby" | null;
  uiLocation: TripContextLocation | undefined;
}): TripContextLocation | undefined {
  if (latestLocation) {
    return locationFromLabel(latestLocation, "user");
  }
  if (nearMeUsesBrowserGeolocation) {
    return undefined;
  }
  if (recentLocation) {
    return locationFromLabel(recentLocation, "user");
  }
  if (uiLocation) {
    return uiLocation;
  }
  if (profileLocation) {
    return profileLocation;
  }
  if (reference === "nearby") {
    return defaultNearbyLocation;
  }
  return undefined;
}

function inferRouteLocations(content: string) {
  const fromMatch = /\bfrom\s+([a-z0-9\s]+?)\s+(?:to|toward|towards|going\s+to)\s+/i.exec(content);
  const toMatch = /\b(?:to|toward|towards|going\s+to)\s+([a-z0-9\s]+?)(?:[?.!,;:]|$)/i.exec(
    content,
  );

  return {
    origin: locationFromText(fromMatch?.[1]),
    destination: locationFromText(toMatch?.[1]),
  };
}

function locationFromText(content: string | undefined): TripContextLocation | undefined {
  if (!content) {
    return undefined;
  }
  const label = inferSiargaoLocationLabel(content);
  return label ? locationFromLabel(label, "user") : undefined;
}

function locationFromLabel(
  label: TripContextLocationLabel,
  source: TripContextLocationSource,
): TripContextLocation {
  return {
    label,
    area: areaForLocation(label),
    source,
  };
}

function areaForLocation(label: TripContextLocationLabel): TripContextLocationLabel {
  if (label === "Cloud 9") {
    return "General Luna";
  }
  if (label === "Del Carmen Port" || label === "Sugba Lagoon") {
    return "Del Carmen";
  }
  return label;
}

function inferTravelerProfile(content: string): TravelerProfile {
  return {
    withKids: /\bkids?|children|child|toddler|family|families\b/i.test(content),
    budget: inferBudgetPreference(content),
    avoidsRain: /\bavoid\s+rain|rain\s+avoidance|covered|indoors?|inside\b/i.test(content),
    avoidsRockyBeach: /\bnot\s+rocky|no\s+rocks?|avoid\s+rocks?|smooth\s+sand|sandy\b/i.test(
      content,
    ),
    prefersQuietSleep: /\bquiet\s+sleep|quiet\s+room|sleep\s+quietly\b/i.test(content),
  };
}

function inferBudgetPreference(content: string): BudgetPreference | undefined {
  if (/\bcheap\b|\bbudget\b|\baffordable\b|\blow[-\s]?cost\b|\binexpensive\b/i.test(content)) {
    return "cheap";
  }
  if (/\bmid(?:range)?|moderate\b/i.test(content)) {
    return "mid";
  }
  if (/\bpremium|upscale|nice|splurge|high[-\s]?end\b/i.test(content)) {
    return "premium";
  }
  return undefined;
}

function inferDurableConstraints(
  content: string,
  travelerProfile: TravelerProfile,
  seedConstraints: readonly string[] = [],
) {
  const constraints = new Set(seedConstraints.filter(isDurableConstraint));
  if (travelerProfile.withKids) {
    constraints.add("with_kids");
  }
  if (travelerProfile.budget) {
    constraints.add(`budget_${travelerProfile.budget}`);
  }
  if (travelerProfile.avoidsRain) {
    constraints.add("rain_avoidance");
  }
  if (travelerProfile.avoidsRockyBeach) {
    constraints.add("avoid_rocky_beach");
  }
  if (/\bno\s+scooter|without\s+(?:a\s+)?scooter|do\s+not\s+ride|don't\s+ride\b/i.test(content)) {
    constraints.add("no_scooter");
  }
  return [...constraints];
}

function reconcileLatestDurableConstraints(
  constraints: readonly string[],
  {
    latestBudget,
    latestTransportMode,
  }: {
    latestBudget?: BudgetPreference;
    latestTransportMode: TransportMode;
  },
) {
  let reconciled = constraints.filter(isDurableConstraint);
  if (latestBudget) {
    reconciled = reconciled.filter((constraint) => !constraint.startsWith("budget_"));
    reconciled.push(`budget_${latestBudget}`);
  }
  if (
    latestTransportMode === "scooter" ||
    latestTransportMode === "tricycle" ||
    latestTransportMode === "van"
  ) {
    reconciled = reconciled.filter((constraint) => constraint !== "no_scooter");
  }
  return [...new Set(reconciled)];
}

function inferActiveGoal(
  latestUserTurn: string,
  recentUserContext: string,
): TripContextActiveGoal | undefined {
  if (/\bsunset\b/i.test(latestUserTurn)) {
    return "beach_sunset";
  }
  if (/\brainy|rain(?:ing)?|showers?|storm|covered|indoors?|inside\b/i.test(latestUserTurn)) {
    return "rain_plan";
  }
  if (/\bswim(?:ming)?|calm\s+water|beaches?|beach\s+day\b/i.test(latestUserTurn)) {
    return "beach_swimming";
  }
  if (isBroadTripAdviceContent(latestUserTurn)) {
    return "trip_advice";
  }
  if (
    /\b(restaurants?|where\s+(?:can|should)\s+(?:we|i)\s+eat|food|dinner|lunch|breakfast|brunch|caf[eé]s?|coffee|bars?|drinks?)\b/i.test(
      latestUserTurn,
    )
  ) {
    return "food";
  }
  if (
    /\b(w?hat\s+should|w?hat\s+can|things?\s+to\s+do|activities?|plan|itinerary)\b/i.test(
      latestUserTurn,
    )
  ) {
    return "itinerary";
  }
  if (
    isContextualFollowUp(latestUserTurn) &&
    /\b(restaurants?|food|dinner|lunch|breakfast|brunch|caf[eé]s?|coffee|bars?|drinks?)\b/i.test(
      recentUserContext,
    )
  ) {
    return "food";
  }
  return undefined;
}

function isBroadTripAdviceContent(content: string) {
  const hasStayContext =
    /\b(stay(?:ing)?|base(?:d)?|near|around|in)\b/i.test(content) &&
    /\b(\d{1,2}\s*(?:days?|nights?)|week|weeks|trip|vacation|holiday)\b/i.test(content);
  const asksForAdvice =
    /\bwhat\s+should\s+(?:we|i)\s+know|what\s+do\s+(?:we|i)\s+need\s+to\s+know|any\s+tips|advice|recommendations?|worth\s+knowing\b/i.test(
      content,
    );
  const tripNeedMatches = content.match(
    /\b(quiet\s+sleep|sleep|hotel|stay|surf(?:ing)?|restaurants?|food|caf[eé]s?|airport|transfer|transport|ferry|arrival|departure|rain|weather|beaches?|activities?)\b/gi,
  );

  return hasStayContext && asksForAdvice && (tripNeedMatches?.length ?? 0) >= 2;
}

function inferTemporaryModifiers({
  activeGoal,
  latestUserTurn,
  rideTimeLimitMinutes,
}: {
  activeGoal?: TripContextActiveGoal;
  latestUserTurn: string;
  rideTimeLimitMinutes?: number;
}) {
  const modifiers = new Set<TemporaryModifier>();
  if (/\bopen\s+now|currently\s+open|still\s+open|right\s+now\b/i.test(latestUserTurn)) {
    modifiers.add("open_now");
  }
  if (/\bcovered|indoors?|inside\b/i.test(latestUserTurn)) {
    modifiers.add("covered");
  }
  if (/\bcheap(?:er)?|budget|affordable|low[-\s]?cost|inexpensive\b/i.test(latestUserTurn)) {
    modifiers.add(/\bcheaper\b/i.test(latestUserTurn) ? "cheaper" : "budget");
  }
  if (/\brainy|rain(?:ing)?|showers?|storm\b/i.test(latestUserTurn)) {
    modifiers.add("rainy_day");
  }
  if (/\bsunset\b/i.test(latestUserTurn)) {
    modifiers.add("sunset");
  }
  if (/\bswim(?:ming)?|calm\s+water\b/i.test(latestUserTurn)) {
    modifiers.add("swimming");
  }
  if (
    /\bsand(?:y)?|not\s+rocky|no\s+rocks?|avoid\s+rocks?|beach\s+suitability\b/i.test(
      latestUserTurn,
    )
  ) {
    modifiers.add("beach_suitability");
  }
  if (/\bkids?|children|child|toddler|family|families\b/i.test(latestUserTurn)) {
    modifiers.add("kids");
  }
  if (rideTimeLimitMinutes) {
    modifiers.add("ride_time");
  }
  if (/\bitinerary|change\s+the\s+plan|instead|what\s+about|how\s+about\b/i.test(latestUserTurn)) {
    modifiers.add("itinerary");
  }

  if (activeGoal === "beach_sunset") {
    modifiers.delete("swimming");
  }
  if (activeGoal === "beach_swimming") {
    modifiers.delete("sunset");
  }

  return [...modifiers];
}

function tripContextSeedFromDraft(input: TripContextDraftInput) {
  const draft = normalizeOptionalTripContextDraft(input);
  const accommodationLocation = draft ? inferSiargaoLocationLabel(draft.accommodation ?? "") : null;
  const draftLocation = draft
    ? accommodationLocation || draft.nearbyArea
      ? locationFromLabel(accommodationLocation ?? draft.nearbyArea ?? "Siargao Island", "ui_draft")
      : undefined
    : undefined;
  const travelerProfile = draft
    ? inferTravelerProfile(draft.travelerType ?? "")
    : emptyTravelerProfile();
  const durableConstraints = draft
    ? inferDurableConstraints(draft.travelerType ?? "", travelerProfile)
    : [];

  return {
    hasContext: Boolean(draft && Object.keys(draft).length > 0),
    currentLocation: draftLocation,
    travelerProfile,
    durableConstraints,
    transportMode: draft ? inferTransportMode(draft.travelerType ?? "") : "unknown",
    accommodation: draft?.accommodation,
    dateRange: draft?.dateRange,
    travelerType: draft?.travelerType,
    rideTimeLimitMinutes: undefined,
  };
}

function tripContextSeedFromProfile(input: TripContextProfileInput | null | undefined) {
  const profileTripContext = normalizeStoredProfileTripContext(input?.tripContext);
  const preferredArea = firstLocationLabel(input?.preferredAreas);
  const profileLocationLabel =
    profileTripContext.currentArea ??
    preferredArea ??
    inferSiargaoLocationLabel(profileTripContext.accommodation ?? "") ??
    null;
  const profileText = [
    input?.travelStyle,
    input?.budgetLevel,
    input?.dietaryNotes,
    input?.accessibilityNotes,
    input?.surfAbility,
    ...(input?.interests ?? []),
    profileTripContext.travelerType,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  const inferredProfile = inferTravelerProfile(profileText);
  const budget = inferBudgetPreference(input?.budgetLevel ?? "") ?? inferredProfile.budget;
  const travelerProfile = {
    ...inferredProfile,
    ...(budget ? { budget } : {}),
    ...(input?.surfAbility ? { surfAbility: input.surfAbility } : {}),
    prefersQuietSleep: input?.quietSleepPreference === true,
    avoidsRain: input?.weatherPreference === "avoid_rain" || inferredProfile.avoidsRain,
  };
  const durableConstraints = [
    ...(profileTripContext.durableConstraints ?? []),
    ...inferDurableConstraints(profileText, travelerProfile),
    ...(input?.quietSleepPreference ? ["quiet_sleep"] : []),
  ].filter(isDurableConstraint);

  return {
    hasContext: Boolean(
      input &&
        (profileLocationLabel ||
          profileTripContext.accommodation ||
          profileTripContext.dateRange ||
          profileTripContext.travelerType ||
          profileTripContext.transportMode ||
          profileTripContext.rideTimeLimitMinutes ||
          durableConstraints.length > 0 ||
          input.budgetLevel ||
          input.travelStyle ||
          input.surfAbility ||
          input.quietSleepPreference ||
          input.weatherPreference ||
          input.interests?.length ||
          input.preferredAreas?.length),
    ),
    currentLocation: profileLocationLabel
      ? locationFromLabel(profileLocationLabel, "profile")
      : undefined,
    travelerProfile,
    durableConstraints,
    transportMode: profileTripContext.transportMode ?? inferTransportMode(profileText),
    accommodation: profileTripContext.accommodation ?? undefined,
    dateRange: profileTripContext.dateRange ?? undefined,
    travelerType: profileTripContext.travelerType ?? undefined,
    rideTimeLimitMinutes: profileTripContext.rideTimeLimitMinutes ?? undefined,
    surfAbility: input?.surfAbility ?? undefined,
  };
}

function mergeTravelerProfiles(
  chatProfile: TravelerProfile,
  uiProfile: TravelerProfile,
  profileProfile: TravelerProfile,
): TravelerProfile {
  return {
    withKids: chatProfile.withKids || uiProfile.withKids || profileProfile.withKids,
    budget: chatProfile.budget ?? uiProfile.budget ?? profileProfile.budget,
    avoidsRain: chatProfile.avoidsRain || uiProfile.avoidsRain || profileProfile.avoidsRain,
    avoidsRockyBeach:
      chatProfile.avoidsRockyBeach || uiProfile.avoidsRockyBeach || profileProfile.avoidsRockyBeach,
    surfAbility: chatProfile.surfAbility ?? uiProfile.surfAbility ?? profileProfile.surfAbility,
    prefersQuietSleep:
      chatProfile.prefersQuietSleep ||
      uiProfile.prefersQuietSleep ||
      profileProfile.prefersQuietSleep,
  };
}

function emptyTravelerProfile(): TravelerProfile {
  return {
    withKids: false,
    avoidsRain: false,
    avoidsRockyBeach: false,
    prefersQuietSleep: false,
  };
}

function firstTransportMode(modes: readonly (TransportMode | undefined)[]): TransportMode {
  return modes.find((mode) => mode && mode !== "unknown") ?? "unknown";
}

function firstLocationLabel(values: readonly string[] | undefined) {
  for (const value of values ?? []) {
    const label = inferSiargaoLocationLabel(value);
    if (label) {
      return label;
    }
  }
  return null;
}

function inferChatLocationLabelFromTripContext(
  tripContext: TripContext,
): ChatRequestIntent["locationLabel"] {
  const label = tripContext.currentLocation?.label ?? tripContext.currentArea;
  if (label === "Cloud 9" || label === "General Luna" || label === "Siargao Island") {
    return label;
  }
  if (label === "Del Carmen" || label === "Del Carmen Port" || label === "Sugba Lagoon") {
    return "Del Carmen";
  }
  return undefined;
}

function shouldDeclineNonSiargaoTopic(messages: readonly AskSiargaoChatMessage[]) {
  const latestUserMessage = getLatestUserMessage(messages);
  const content = latestUserMessage?.content ?? "";

  if (!content || hasSiargaoScopeSignal(content) || hasLikelySiargaoTravelSignal(content)) {
    return false;
  }

  return hasClearlyUnrelatedTopicSignal(content);
}

function hasSiargaoScopeSignal(content: string) {
  return /\b(siargao|general\s+luna|cloud\s*9|cloud9|catangnan|dapa|del\s+carmen|sayak|pacifico|malinao|pilar|santa\s+monica|bucas\s+grande|sugba\s+lagoon|magpupungko|maasin\s+river|daku|guyam|naked\s+island|sohoton)\b/i.test(
    content,
  );
}

function hasLikelySiargaoTravelSignal(content: string) {
  return /\b(weather|forecast|rain|wind|waves?|surf|tides?|ferr(?:y|ies)|airport|flight|van|tricycle|scooter|motorbike|transfer|route|itinerary|trip|stay|stays|hotel|hostel|resort|villa|accommodation|restaurants?|cafes?|coffee|bars?|nightlife|food|dinner|lunch|breakfast|brunch|beach|island\s+hopping|tour|activity|activities|budget|cash|atm|sim|wifi|internet|power|brownout|quiet|safe|safety|pack|packing)\b/i.test(
    content,
  );
}

function hasClearlyUnrelatedTopicSignal(content: string) {
  return /\b(capital\s+of|president\s+of|prime\s+minister|who\s+(is|was|won)|nba|nfl|mlb|nhl|olympics|stock|stocks|bitcoin|crypto|cryptocurrency|recipe|homework|essay|poem|song|lyrics|movie|netflix|celebrity|quantum|calculus|algebra|debug|code|coding|program|script|function|regex|sql|python|javascript|typescript|react|next\.?js)\b/i.test(
    content,
  );
}

function getLatestUserMessage(messages: readonly AskSiargaoChatMessage[]) {
  return [...messages].reverse().find((message) => message.role === "user");
}

function isContextualFollowUp(content: string) {
  return /\b(what\s+about|how\s+about|that\s+area|there|nearby|instead|options?|open\s+now|open\s+today|currently\s+open|still\s+open|hours?|cheap(?:er)?|budget|affordable)\b/i.test(
    content,
  );
}

function normalizeKey(value: string) {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

function normalizedOptionalContextText(value: string | undefined) {
  return value?.trim().slice(0, maxTripContextTextLength) ?? "";
}

function isForecastLocationLabel(value: unknown): value is ForecastLocationLabel {
  return (
    typeof value === "string" &&
    forecastLocationLabels.includes(value as (typeof forecastLocationLabels)[number])
  );
}

function isLocationLabel(value: unknown): value is TripContextLocationLabel {
  return (
    typeof value === "string" &&
    knownLocationLabels.includes(value as (typeof knownLocationLabels)[number])
  );
}

function isTransportMode(value: unknown): value is TransportMode {
  return (
    value === "walk" ||
    value === "scooter" ||
    value === "tricycle" ||
    value === "van" ||
    value === "unknown"
  );
}

function isDurableConstraint(value: unknown): value is (typeof allowedDurableConstraints)[number] {
  return (
    typeof value === "string" &&
    allowedDurableConstraints.includes(value as (typeof allowedDurableConstraints)[number])
  );
}

function readNullableBoundedText<K extends keyof UserProfileTripContext>(
  value: unknown,
  path: string,
  maxLength: number,
  output: UserProfileTripContext,
  key: K,
  issues: TripContextValidationIssue[],
) {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    output[key] = null as UserProfileTripContext[K];
    return;
  }
  if (typeof value !== "string") {
    issues.push({ path, message: "Expected a string or null." });
    return;
  }

  const trimmedValue = value.trim();
  if (trimmedValue.length > maxLength) {
    issues.push({ path, message: `Must be ${maxLength} characters or fewer.` });
    return;
  }
  output[key] = (trimmedValue || null) as UserProfileTripContext[K];
}

function readNullableBoundedLocation(
  value: unknown,
  path: string,
  output: UserProfileTripContext,
  key: "currentArea",
  issues: TripContextValidationIssue[],
) {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    output[key] = null;
    return;
  }
  if (!isLocationLabel(value)) {
    issues.push({ path, message: "Expected a supported Siargao location label or null." });
    return;
  }
  output[key] = value;
}

function readNullableTransportMode(
  value: unknown,
  output: UserProfileTripContext,
  issues: TripContextValidationIssue[],
) {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    output.transportMode = null;
    return;
  }
  if (!isTransportMode(value)) {
    issues.push({
      path: "tripContext.transportMode",
      message: "Expected a supported transport mode or null.",
    });
    return;
  }
  output.transportMode = value;
}

function readNullableRideTimeLimit(
  value: unknown,
  output: UserProfileTripContext,
  issues: TripContextValidationIssue[],
) {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    output.rideTimeLimitMinutes = null;
    return;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > maxRideTimeLimitMinutes
  ) {
    issues.push({
      path: "tripContext.rideTimeLimitMinutes",
      message: `Expected an integer from 1 to ${maxRideTimeLimitMinutes}, or null.`,
    });
    return;
  }
  output.rideTimeLimitMinutes = value;
}

function readDurableConstraints(
  value: unknown,
  output: UserProfileTripContext,
  issues: TripContextValidationIssue[],
) {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value)) {
    issues.push({ path: "tripContext.durableConstraints", message: "Expected an array." });
    return;
  }
  const constraints = value.filter(isDurableConstraint);
  if (
    constraints.length !== value.length ||
    constraints.length > allowedDurableConstraints.length
  ) {
    issues.push({
      path: "tripContext.durableConstraints",
      message: "Expected supported durable constraint identifiers only.",
    });
    return;
  }
  output.durableConstraints = [...new Set(constraints)];
}

function isInSiargaoArea(latitude: number, longitude: number) {
  return (
    latitude >= siargaoAreaBounds.minLatitude &&
    latitude <= siargaoAreaBounds.maxLatitude &&
    longitude >= siargaoAreaBounds.minLongitude &&
    longitude <= siargaoAreaBounds.maxLongitude
  );
}

function isStaleGeolocation(capturedAt: string, now: Date) {
  const capturedTime = Date.parse(capturedAt);
  const ageMs = now.getTime() - capturedTime;
  return ageMs > maxGeolocationAgeMs || ageMs < -maxFutureGeolocationSkewMs;
}

function parseJsonValue(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

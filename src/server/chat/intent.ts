import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";

export type TripContextLocationSource =
  | "user"
  | "gazetteer"
  | "browser_geolocation"
  | "google_places";

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
};

export type TripContextActiveGoal =
  | "food"
  | "beach_swimming"
  | "beach_sunset"
  | "rain_plan"
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
  unresolvedReference?: "there";
};

export type UnifiedChatIntentResult = {
  latestUserTurn: string;
  recentUserContext: string;
  tripContext: TripContext;
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

export function deriveTripContext(messages: readonly AskSiargaoChatMessage[]): TripContext {
  const latestUserTurn = getLatestUserTurn(messages);
  const recentUserContext = getRecentUserContext(messages);
  const fullUserContext = joinContext(recentUserContext, latestUserTurn);
  const latestLocation = inferSiargaoLocationLabel(latestUserTurn);
  const recentLocation = inferSiargaoLocationLabel(recentUserContext);
  const reference = inferLocationReference(latestUserTurn);
  const activeGoal = inferActiveGoal(latestUserTurn, recentUserContext);
  const currentLocation = resolveCurrentLocation({
    latestLocation,
    recentLocation,
    reference,
  });
  const routeLocations = inferRouteLocations(fullUserContext);
  const travelerProfile = inferTravelerProfile(fullUserContext);
  const durableConstraints = inferDurableConstraints(fullUserContext, travelerProfile);
  const rideTimeLimitMinutes = inferRideTimeLimitMinutes(fullUserContext);
  const temporaryModifiers = inferTemporaryModifiers({
    activeGoal,
    latestUserTurn,
    rideTimeLimitMinutes: inferRideTimeLimitMinutes(latestUserTurn),
  });

  return {
    latestUserTurn,
    recentUserContext,
    fullUserContext,
    ...(currentLocation ? { currentArea: currentLocation.area ?? currentLocation.label } : {}),
    ...(currentLocation ? { currentLocation } : {}),
    ...(routeLocations.origin ? { origin: routeLocations.origin } : {}),
    ...(routeLocations.destination ? { destination: routeLocations.destination } : {}),
    ...(rideTimeLimitMinutes ? { rideTimeLimitMinutes } : {}),
    transportMode: inferTransportMode(fullUserContext),
    travelerProfile,
    ...(activeGoal ? { activeGoal } : {}),
    temporaryModifiers,
    durableConstraints,
    ...(reference === "there" && !currentLocation ? { unresolvedReference: "there" as const } : {}),
  };
}

export function deriveChatIntent(
  messages: readonly AskSiargaoChatMessage[],
): UnifiedChatIntentResult {
  const tripContext = deriveTripContext(messages);
  return {
    latestUserTurn: tripContext.latestUserTurn,
    recentUserContext: tripContext.recentUserContext,
    tripContext,
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

export function inferRideTimeLimitMinutes(content: string) {
  const match =
    /\b(?:within|under|max(?:imum)?|no\s+more\s+than|less\s+than|about)\s+(\d{1,3})\s*(?:min|mins|minutes?)\b/i.exec(
      content,
    ) ?? /\b(\d{1,3})\s*(?:min|mins|minutes?)\s+(?:ride|drive|walk)\b/i.exec(content);
  if (!match?.[1]) {
    return undefined;
  }
  return Number(match[1]);
}

export function inferTransportMode(content: string): TransportMode {
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
  recentLocation,
  reference,
}: {
  latestLocation: TripContextLocationLabel | null;
  recentLocation: TripContextLocationLabel | null;
  reference: "there" | "nearby" | null;
}): TripContextLocation | undefined {
  if (latestLocation) {
    return locationFromLabel(latestLocation, "user");
  }
  if (recentLocation) {
    return locationFromLabel(recentLocation, "user");
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

function inferDurableConstraints(content: string, travelerProfile: TravelerProfile) {
  const constraints = new Set<string>();
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

function isContextualFollowUp(content: string) {
  return /\b(what\s+about|how\s+about|that\s+area|there|nearby|instead|options?|open\s+now|open\s+today|currently\s+open|still\s+open|hours?|cheap(?:er)?|budget|affordable)\b/i.test(
    content,
  );
}

function normalizeKey(value: string) {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

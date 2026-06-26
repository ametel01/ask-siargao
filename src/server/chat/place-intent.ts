import type { AskSiargaoChatMessage } from "@/server/llm/chat-adapter";

export type PlaceCategory =
  | "food"
  | "coffee"
  | "bar"
  | "activity_place"
  | "service"
  | "specific_place";

export type PlaceLiveNeed = "open_now" | "hours" | "nearby" | "identity" | "recommendation";

export type MealIntent = "breakfast" | "lunch" | "dinner" | null;

export type PlaceAreaScope = "nearby" | "in_area" | null;

export type PlaceIntent = {
  category: PlaceCategory;
  liveNeeds: PlaceLiveNeed[];
  meal: MealIntent;
  location: string | null;
  areaScope: PlaceAreaScope;
  constraints: string[];
  avoid: string[];
  radiusMeters: number;
  placeName: string | null;
  latestUserTurn: string;
  recentUserContext: string;
};

const defaultNearbyLocation = "General Luna";
const nearbyRadiusMeters = 6_000;
const areaRadiusMeters = 12_000;

const knownPlaceLocationLabels = [
  "Del Carmen Port",
  "Sugba Lagoon",
  "General Luna",
  "Cloud 9",
  "Del Carmen",
  "Dapa",
] as const;

export function interpretPlaceIntent(
  messages: readonly AskSiargaoChatMessage[],
): PlaceIntent | null {
  const latestUserTurn = getLatestUserTurn(messages);
  const recentUserContext = getRecentUserContext(messages);
  const latestCategory = inferPlaceCategory(latestUserTurn);
  const contextualRequest = isContextualPlaceFollowUp(latestUserTurn);
  const recentCategory = inferPlaceCategory(recentUserContext);
  const category = latestCategory ?? (contextualRequest ? recentCategory : null);

  if (!category) {
    return null;
  }

  const meal = inferMeal(latestUserTurn) ?? inferMeal(recentUserContext);
  const fullContext = `${recentUserContext} ${latestUserTurn}`;
  const areaScope = inferAreaScope(latestUserTurn) ?? inferAreaScope(recentUserContext);
  const location =
    inferPlaceLocationLabel(latestUserTurn) ??
    inferPlaceLocationLabel(recentUserContext) ??
    (areaScope === "nearby" ? defaultNearbyLocation : null);
  const constraints = [
    ...new Set([...inferConstraints(recentUserContext), ...inferConstraints(latestUserTurn)]),
  ];
  const explicitlyRequestedCafe = /\b(caf[eé]s?|coffee)\b/i.test(fullContext);
  const avoid = inferAvoidTerms({ explicitlyRequestedCafe, latestUserTurn, meal });
  const liveNeeds = inferLiveNeeds({
    areaScope,
    category,
    latestUserTurn,
    placeName: inferSpecificPlaceName(latestUserTurn),
  });

  return {
    category,
    liveNeeds,
    meal,
    location,
    areaScope,
    constraints,
    avoid,
    radiusMeters: areaScope === "nearby" ? nearbyRadiusMeters : areaRadiusMeters,
    placeName: inferSpecificPlaceName(latestUserTurn),
    latestUserTurn,
    recentUserContext,
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

export function isPlaceRecommendationContent(content: string) {
  return (
    /\b(restaurants?|where\s+(?:can|should)\s+(?:we|i)\s+eat|food|dinner|lunch|breakfast|brunch|caf[eé]s?|coffee|bars?|nightlife|drinks?|places?\s+to\s+(?:eat|go|stop)|stop\s+to\s+eat|food\s+stops?|car[ie]nderias?|seafood|covered\s+(?:caf[eé]s?|places?|spots?)|beachfront\s+(?:places?|caf[eé]s?|restaurants?|spots?)|specific\s+(?:places?|spots?|caf[eé]s?))\b/i.test(
      content,
    ) ||
    isServicePlaceContent(content) ||
    inferSpecificPlaceName(content) !== null
  );
}

export function inferPlaceCategory(content: string): PlaceCategory | null {
  if (!content.trim()) {
    return null;
  }
  if (inferSpecificPlaceName(content)) {
    return "specific_place";
  }
  if (/\b(caf[eé]s?|coffee)\b/i.test(content)) {
    return "coffee";
  }
  if (/\b(bars?|nightlife|drinks?)\b/i.test(content)) {
    return "bar";
  }
  if (isServicePlaceContent(content)) {
    return "service";
  }
  if (
    /\b(restaurants?|where\s+(?:can|should)\s+(?:we|i)\s+eat|food|dinner|lunch|breakfast|brunch|places?\s+to\s+eat|stop\s+to\s+eat|food\s+stops?|car[ie]nderias?|seafood)\b/i.test(
      content,
    )
  ) {
    return "food";
  }
  if (/\b(beachfront|covered|indoors?|inside)\s+(?:places?|spots?)\b/i.test(content)) {
    return "activity_place";
  }
  return null;
}

export function inferLiveNeeds({
  areaScope,
  category,
  latestUserTurn,
  placeName,
}: {
  areaScope: PlaceAreaScope;
  category: PlaceCategory;
  latestUserTurn: string;
  placeName: string | null;
}): PlaceLiveNeed[] {
  const needs = new Set<PlaceLiveNeed>();
  if (/\bopen\s+now|currently\s+open|still\s+open|right\s+now\b/i.test(latestUserTurn)) {
    needs.add("open_now");
  }
  if (/\bhours?|open\s+today|closing|close\s+time\b/i.test(latestUserTurn)) {
    needs.add("hours");
  }
  if (areaScope === "nearby") {
    needs.add("nearby");
  }
  if (category === "specific_place" || placeName) {
    needs.add("identity");
  }
  if (
    needs.size === 0 ||
    /\b(recommend|suggest|where|options?|places?|specific)\b/i.test(latestUserTurn)
  ) {
    needs.add("recommendation");
  }
  return [...needs];
}

export function inferPlaceLocationLabel(content: string): string | null {
  const normalizedContent = normalizeKey(content);
  const location = knownPlaceLocationLabels.find((label) =>
    normalizedContent.includes(normalizeKey(label)),
  );
  if (location) {
    return location;
  }
  if (/\bsiargao\b/i.test(content)) {
    return "Siargao Island";
  }
  return null;
}

export function inferMeal(content: string): MealIntent {
  if (/\bbreakfast\b/i.test(content)) {
    return "breakfast";
  }
  if (/\blunch\b/i.test(content)) {
    return "lunch";
  }
  if (/\bdinner|evening\s+(?:meal|food|dining)\b/i.test(content)) {
    return "dinner";
  }
  return null;
}

export function inferAreaScope(content: string): PlaceAreaScope {
  if (/\bnear(?:by)?|around|close\s+to|that\s+area|in\s+that\s+area|by\s+/i.test(content)) {
    return "nearby";
  }
  if (/\bon\s+the\s+way|route|from\s+.+\s+to/i.test(content)) {
    return "nearby";
  }
  if (inferPlaceLocationLabel(content)) {
    return "in_area";
  }
  return null;
}

export function inferConstraints(content: string) {
  const constraints: string[] = [];
  if (/\brain(?:y|ing)?|downpour|storm/i.test(content)) {
    constraints.push("rainy_day", "covered_seating");
  }
  if (/\bcovered|indoors?|inside\b/i.test(content)) {
    constraints.push("covered_seating");
  }
  if (/\bbeachfront|beach\s*front\b/i.test(content)) {
    constraints.push("beachfront");
  }
  return constraints;
}

export function inferAvoidTerms({
  explicitlyRequestedCafe,
  latestUserTurn,
  meal,
}: {
  explicitlyRequestedCafe: boolean;
  latestUserTurn: string;
  meal: MealIntent;
}) {
  const avoid: string[] = [];
  if (meal === "dinner" && !explicitlyRequestedCafe) {
    avoid.push("brunch_only", "coffee_only");
  }
  if (/\bproper|sit[-\s]?down|not\s+car[ie]nderia\b/i.test(latestUserTurn)) {
    avoid.push("carinderia", "canteen");
  }
  return avoid;
}

export function inferSpecificPlaceName(content: string) {
  const mapLinkMatch =
    /\b(?:map\s+link|maps?|directions?|hours?|open\s+(?:now|today)|still\s+open|is|find|check)\s+(?:for|to|at)?\s*([A-Z][A-Za-z0-9'&.-]*(?:\s+[A-Z][A-Za-z0-9'&.-]*){0,4})\b/.exec(
      content,
    );
  if (mapLinkMatch?.[1] && !isGenericCapitalizedPhrase(mapLinkMatch[1])) {
    return cleanSpecificPlaceName(mapLinkMatch[1]);
  }

  const quotedMatch = /["']([^"']{2,80})["']/.exec(content);
  if (quotedMatch?.[1]) {
    return cleanSpecificPlaceName(quotedMatch[1]);
  }

  return null;
}

function isContextualPlaceFollowUp(content: string) {
  return /\b(what\s+about|how\s+about|that\s+area|there|nearby|instead|options?|open\s+now|open\s+today|currently\s+open|still\s+open|hours?)\b/i.test(
    content,
  );
}

function isServicePlaceContent(content: string) {
  return /\b(clinics?|pharmac(?:y|ies)|drugstores?|scooter\s+rentals?|motorbike\s+rentals?|laundr(?:y|ies)|atms?|cash\s+machines?)\b/i.test(
    content,
  );
}

function cleanSpecificPlaceName(value: string) {
  return value
    .replace(/\b(?:in|near|around|on|at|for|please|now|today|siargao)\b.*$/i, "")
    .replace(/[?.!,;:]+$/g, "")
    .trim();
}

function isGenericCapitalizedPhrase(value: string) {
  return /^(Siargao|General Luna|Cloud 9|Del Carmen|Dapa|Google Places?|Maps?)$/i.test(
    value.trim(),
  );
}

function normalizeKey(value: string) {
  return value.toLowerCase().replaceAll(/\s+/g, " ").trim();
}

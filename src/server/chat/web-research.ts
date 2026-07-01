export const webResearchIntents = [
  "recommendation",
  "schedule",
  "availability",
  "price",
  "safety",
  "how_to",
  "fact",
] as const;

export type WebResearchIntent = (typeof webResearchIntents)[number];

export const webResearchDateContexts = [
  "today",
  "tonight",
  "tomorrow",
  "next_7_days",
  "date_range",
  "none",
] as const;

export type WebResearchDateContext = (typeof webResearchDateContexts)[number];

export const webResearchSourceTypes = [
  "official",
  "government",
  "local_directory",
  "maps",
  "guide",
  "social",
  "community",
  "news",
  "weather",
] as const;

export type WebResearchSourceType = (typeof webResearchSourceTypes)[number];

export const webResearchFreshnessLevels = ["live", "same_day", "week", "month", "stable"] as const;

export type WebResearchFreshnessLevel = (typeof webResearchFreshnessLevels)[number];

const webResearchStatuses = ["available", "insufficient", "provider_unavailable"] as const;

export type WebResearchStatus = (typeof webResearchStatuses)[number];

const webResearchAnswerRoles = ["primary", "supporting", "negative", "caveat"] as const;

export type WebResearchAnswerRole = (typeof webResearchAnswerRoles)[number];

const webResearchEntityKinds = [
  "place",
  "operator",
  "event",
  "route",
  "service",
  "activity",
] as const;

export type WebResearchEntityKind = (typeof webResearchEntityKinds)[number];

export type ResearchWebRequest = {
  query: string;
  intent: WebResearchIntent;
  location?: string;
  localDate?: string;
  dateContext?: WebResearchDateContext;
  sourceTypes?: readonly WebResearchSourceType[];
  requiredFreshness?: WebResearchFreshnessLevel;
  maxSources?: number;
};

export type ResearchFinding = {
  claim: string;
  answerRole: WebResearchAnswerRole;
  confidence: "high" | "medium" | "low";
  sourceUrl: string;
  sourceTitle: string;
  sourceType: WebResearchSourceType;
  publishedOrUpdatedAt?: string;
  matchedDateContext?: string;
};

export type ResearchEntity = {
  name: string;
  kind: WebResearchEntityKind;
  role?: string;
  area?: string;
  needsPlacesEnrichment?: boolean;
};

export type ResearchSourceScore = {
  sourceUrl: string;
  sourceTitle: string;
  sourceType: WebResearchSourceType;
  score: number;
  reasons: readonly string[];
  confidence: "high" | "medium" | "low";
  publishedOrUpdatedAt?: string;
};

export type ResearchWebResultData = {
  status: WebResearchStatus;
  normalizedQuery: string;
  searchedQueries: readonly string[];
  findings: readonly ResearchFinding[];
  entities: readonly ResearchEntity[];
  sourceScores: readonly ResearchSourceScore[];
  notChecked: readonly string[];
};

export type WebResearchProviderResult = {
  url: string;
  title: string;
  snippet?: string;
  pageSummary?: string;
  sourceType?: WebResearchSourceType;
  publishedOrUpdatedAt?: string;
  entities?: readonly ResearchEntity[];
};

export type WebResearchRunOptions = {
  now?: Date;
  providerUnavailable?: boolean;
  minimumScore?: number;
};

type ScoredResearchSource = ResearchSourceScore & {
  source: WebResearchProviderResult;
  negativeEvidence: boolean;
  matchedDateContext?: string;
};

const defaultMinimumScore = 52;

const authorityScores: Record<WebResearchSourceType, number> = {
  official: 65,
  government: 65,
  local_directory: 56,
  maps: 48,
  guide: 42,
  social: 35,
  community: 30,
  news: 48,
  weather: 44,
};

const sourceQueryModifiers: Record<WebResearchSourceType, string> = {
  official: "official",
  government: "government advisory official",
  local_directory: "Siargao events directory local listing",
  maps: "open now map hours",
  guide: "recent guide 2026",
  social: "instagram facebook public post",
  community: "reddit forum",
  news: "news update",
  weather: "weather advisory forecast",
};

const weakFallbackNotChecked = [
  "booking inventory, reservations, guest lists, private messages, live crowd size, and raw social stories",
];

export function runWebResearch(
  request: ResearchWebRequest,
  sources: readonly WebResearchProviderResult[],
  options: WebResearchRunOptions = {},
): ResearchWebResultData {
  const normalizedQuery = normalizeResearchQuery(request.query);
  const searchedQueries = buildWebResearchQueries(request);

  if (options.providerUnavailable) {
    return {
      status: "provider_unavailable",
      normalizedQuery,
      searchedQueries,
      findings: [],
      entities: [],
      sourceScores: [],
      notChecked: [
        "public web evidence because the configured web research provider was unavailable",
        ...weakFallbackNotChecked,
      ],
    };
  }

  const scoredSources = sources
    .map((source) => scoreResearchSource(source, request, options.now))
    .sort(
      (left, right) =>
        right.score - left.score || left.sourceTitle.localeCompare(right.sourceTitle),
    );
  const minimumScore = options.minimumScore ?? defaultMinimumScore;
  const selectedSources = scoredSources
    .filter(
      (source) =>
        (!vehicleRentalLike(request.query) ||
          vehicleRentalSourceText(normalizedSourceText(source.source))) &&
        (source.score >= minimumScore || source.negativeEvidence),
    )
    .slice(0, Math.max(1, request.maxSources ?? 6));
  const findings = selectedSources.map((source, index) => researchFindingFromSource(source, index));
  const entities = uniqueResearchEntities(
    selectedSources.flatMap((source) => sourceEntities(source)),
  );
  const status: WebResearchStatus = findings.length > 0 ? "available" : "insufficient";

  return {
    status,
    normalizedQuery,
    searchedQueries,
    findings,
    entities,
    sourceScores: scoredSources.map(
      ({ source: _source, negativeEvidence: _negative, ...score }) => score,
    ),
    notChecked:
      status === "available"
        ? weakFallbackNotChecked
        : [
            "sufficient current public evidence for the requested fact or recommendation",
            ...weakFallbackNotChecked,
          ],
  };
}

export function buildWebResearchQueries(request: ResearchWebRequest) {
  const normalizedQuery = normalizeResearchQuery(request.query);
  const baseParts = [normalizedQuery, request.location, dateQueryPart(request)]
    .filter(Boolean)
    .map((part) => normalizeResearchQuery(String(part)));
  const baseQuery = uniqueTokens(baseParts.join(" "));
  const intentModifier = intentQueryModifier(request);
  const sourceTypes = request.sourceTypes?.length
    ? request.sourceTypes
    : defaultSourceTypesForRequest(request);

  return uniqueStrings([
    uniqueTokens([baseQuery, intentModifier].filter(Boolean).join(" ")),
    ...sourceTypes.map((sourceType) =>
      uniqueTokens(
        [baseQuery, intentModifier, sourceQueryModifierForRequest(sourceType, request)].join(" "),
      ),
    ),
  ]).slice(0, 8);
}

export function classifyWebResearchSource(
  source: Pick<WebResearchProviderResult, "url" | "title">,
) {
  const explicitSourceType = (source as WebResearchProviderResult).sourceType;
  if (explicitSourceType) {
    return explicitSourceType;
  }

  const sourceUrl = lowerUrl(source.url);
  const title = source.title.toLowerCase();
  if (sourceUrl.includes(".gov.") || sourceUrl.endsWith(".gov") || sourceUrl.includes("gov.ph")) {
    return "government";
  }
  if (sourceUrl.includes("open-meteo") || title.includes("weather")) {
    return "weather";
  }
  if (sourceUrl.includes("google.") || sourceUrl.includes("maps.")) {
    return "maps";
  }
  if (sourceUrl.includes("reddit.") || sourceUrl.includes("forum")) {
    return "community";
  }
  if (
    sourceUrl.includes("instagram.") ||
    sourceUrl.includes("facebook.") ||
    sourceUrl.includes("tiktok.")
  ) {
    return "social";
  }
  if (sourceUrl.includes("rappler.") || sourceUrl.includes("news") || title.includes("news")) {
    return "news";
  }
  if (
    sourceUrl.includes("siargaovibes.") ||
    sourceUrl.includes("discoversiargao.") ||
    title.includes("directory") ||
    title.includes("events schedule")
  ) {
    return "local_directory";
  }
  if (sourceUrl.includes("official") || title.includes("official")) {
    return "official";
  }
  return "guide";
}

export function scoreResearchSource(
  source: WebResearchProviderResult,
  request: ResearchWebRequest,
  now = new Date(),
): ScoredResearchSource {
  const sourceType = classifyWebResearchSource(source);
  const text = normalizedSourceText(source);
  const reasons: string[] = [`${sourceType} source class`];
  let score = authorityScores[sourceType];

  const sourceFit = sourceFitScore(sourceType, request);
  score += sourceFit.score;
  reasons.push(sourceFit.reason);

  const freshness = freshnessScore(source, request, now);
  score += freshness.score;
  reasons.push(freshness.reason);

  const exactness = exactnessScore(text, request);
  score += exactness.score;
  if (exactness.reason) {
    reasons.push(exactness.reason);
  }

  if (
    vehicleRentalLike(request.query) &&
    !vehicleRentalSourceText(text) &&
    !hasNegativeEvidence(text)
  ) {
    score -= 60;
    reasons.push("does not directly describe a vehicle rental operator or rates");
  }

  const negativeEvidence = hasNegativeEvidence(text);
  if (negativeEvidence) {
    score += 8;
    reasons.push("negative evidence preserved");
  }

  const matchedDateContext = matchedDateContextFromText(text, request);
  if (matchedDateContext) {
    score += 8;
    reasons.push(`matches ${matchedDateContext}`);
  }

  const boundedScore = Math.max(0, Math.min(100, score));
  return {
    source,
    sourceUrl: source.url,
    sourceTitle: source.title,
    sourceType,
    score: boundedScore,
    reasons,
    confidence: confidenceFromScore(boundedScore),
    publishedOrUpdatedAt: source.publishedOrUpdatedAt,
    negativeEvidence,
    matchedDateContext,
  };
}

function researchFindingFromSource(source: ScoredResearchSource, index: number): ResearchFinding {
  return {
    claim: boundedClaim(source.source),
    answerRole: source.negativeEvidence ? "negative" : index === 0 ? "primary" : "supporting",
    confidence: source.confidence,
    sourceUrl: source.sourceUrl,
    sourceTitle: source.sourceTitle,
    sourceType: source.sourceType,
    ...(source.publishedOrUpdatedAt ? { publishedOrUpdatedAt: source.publishedOrUpdatedAt } : {}),
    ...(source.matchedDateContext ? { matchedDateContext: source.matchedDateContext } : {}),
  };
}

function sourceEntities(source: ScoredResearchSource): readonly ResearchEntity[] {
  if (source.source.entities?.length) {
    return source.source.entities.map((entity) => ({
      ...entity,
      needsPlacesEnrichment:
        entity.needsPlacesEnrichment ??
        (source.sourceType !== "maps" && ["event", "operator", "place"].includes(entity.kind)),
    }));
  }

  const name = titleEntityName(source.source.title);
  if (!name) {
    return [];
  }

  return [
    {
      name,
      kind: inferEntityKind(source),
      needsPlacesEnrichment: source.sourceType !== "maps",
    },
  ];
}

function defaultSourceTypesForRequest(
  request: ResearchWebRequest,
): readonly WebResearchSourceType[] {
  if (request.intent === "safety") {
    return ["government", "news", "weather", "community"];
  }
  if (request.intent === "price") {
    return ["official", "local_directory", "guide"];
  }
  if (request.intent === "schedule" || request.intent === "availability") {
    return ["official", "government", "local_directory", "maps"];
  }
  if (restaurantLike(request.query)) {
    return ["maps", "official", "local_directory", "guide"];
  }
  if (vehicleRentalLike(request.query)) {
    return ["official", "local_directory", "guide"];
  }
  if (eventLike(request.query)) {
    return ["official", "local_directory", "social", "guide", "community"];
  }
  return ["official", "local_directory", "guide", "community"];
}

function sourceFitScore(sourceType: WebResearchSourceType, request: ResearchWebRequest) {
  const primary = primarySourceTypesForRequest(request);
  if (primary.includes(sourceType)) {
    return { score: 16, reason: "primary source fit for request" };
  }
  const supporting = supportingSourceTypesForRequest(request);
  if (supporting.includes(sourceType)) {
    return { score: 8, reason: "supporting source fit for request" };
  }
  return { score: -8, reason: "weak source fit for request" };
}

function primarySourceTypesForRequest(
  request: ResearchWebRequest,
): readonly WebResearchSourceType[] {
  if (request.intent === "safety") {
    return ["government", "news", "weather"];
  }
  if (request.intent === "price") {
    return ["official", "local_directory"];
  }
  if (request.intent === "schedule" || request.intent === "availability") {
    return ["official", "government", "local_directory"];
  }
  if (restaurantLike(request.query)) {
    return ["maps", "official", "local_directory"];
  }
  if (vehicleRentalLike(request.query)) {
    return ["official", "local_directory"];
  }
  if (eventLike(request.query)) {
    return ["official", "local_directory", "social"];
  }
  return ["official", "local_directory"];
}

function supportingSourceTypesForRequest(
  request: ResearchWebRequest,
): readonly WebResearchSourceType[] {
  if (request.intent === "safety") {
    return ["community", "official"];
  }
  if (request.intent === "price") {
    return ["guide"];
  }
  if (restaurantLike(request.query)) {
    return ["guide", "social"];
  }
  if (vehicleRentalLike(request.query)) {
    return ["guide", "social", "maps"];
  }
  if (eventLike(request.query)) {
    return ["guide", "community"];
  }
  return ["guide", "community", "news"];
}

function freshnessScore(source: WebResearchProviderResult, request: ResearchWebRequest, now: Date) {
  const requiredFreshness =
    request.requiredFreshness ?? freshnessForDateContext(request.dateContext ?? "none");
  const updatedAt = parseDate(source.publishedOrUpdatedAt);
  if (!updatedAt) {
    if (requiredFreshness === "stable") {
      return { score: 4, reason: "stable request does not require a dated source" };
    }
    return { score: -12, reason: "undated source for current request" };
  }

  const ageDays = Math.max(0, (now.getTime() - updatedAt.getTime()) / 86_400_000);
  if (requiredFreshness === "live" && ageDays <= 1) {
    return { score: 20, reason: "live freshness match" };
  }
  if (requiredFreshness === "same_day" && ageDays <= 1) {
    return { score: 20, reason: "same-day freshness match" };
  }
  if (requiredFreshness === "week" && ageDays <= 7) {
    return { score: 14, reason: "week freshness match" };
  }
  if (requiredFreshness === "month" && ageDays <= 31) {
    return { score: 8, reason: "month freshness match" };
  }
  if (requiredFreshness === "stable" && ageDays <= 365) {
    return { score: 4, reason: "stable freshness match" };
  }
  return { score: -18, reason: "stale for requested freshness" };
}

function exactnessScore(text: string, request: ResearchWebRequest) {
  const queryTokens = importantTokens(request.query);
  const locationTokens = importantTokens(request.location ?? "");
  const matchedTokens = [...queryTokens, ...locationTokens].filter((token) => text.includes(token));
  const score = Math.min(18, matchedTokens.length * 3);
  return {
    score,
    reason: score > 0 ? `matches ${matchedTokens.length} query/location terms` : undefined,
  };
}

function matchedDateContextFromText(text: string, request: ResearchWebRequest) {
  const dateParts = [request.dateContext, request.localDate, localWeekday(request.localDate)]
    .filter(Boolean)
    .map((part) => normalizeResearchQuery(String(part)));
  return dateParts.find((part) => text.includes(part));
}

function dateQueryPart(request: ResearchWebRequest) {
  return [request.dateContext, request.localDate, localWeekday(request.localDate)]
    .filter(Boolean)
    .join(" ");
}

function intentQueryModifier(request: ResearchWebRequest) {
  if (request.intent === "schedule") {
    return "schedule hours timetable";
  }
  if (request.intent === "availability") {
    return "open running closed cancelled current status";
  }
  if (request.intent === "price") {
    return "price rates current fee";
  }
  if (request.intent === "safety") {
    return "advisory closure disruption safety update";
  }
  if (eventLike(request.query)) {
    return "events party schedule DJ tonight";
  }
  if (restaurantLike(request.query)) {
    return "best open now menu";
  }
  if (vehicleRentalLike(request.query)) {
    return "rental rates contact whatsapp deposit helmet";
  }
  return "best recommended current";
}

function sourceQueryModifierForRequest(
  sourceType: WebResearchSourceType,
  request: ResearchWebRequest,
) {
  if (!vehicleRentalLike(request.query)) {
    return sourceQueryModifiers[sourceType];
  }

  switch (sourceType) {
    case "official":
      return "official scooter motorbike rental";
    case "local_directory":
      return "Siargao scooter motorbike rental directory rates";
    case "maps":
      return "scooter motorbike rental map contact hours";
    case "guide":
      return "scooter motorbike rental guide rates";
    case "social":
      return "facebook instagram scooter motorbike rental";
    default:
      return sourceQueryModifiers[sourceType];
  }
}

function boundedClaim(source: WebResearchProviderResult) {
  const text = (source.pageSummary || source.snippet || source.title).replace(/\s+/g, " ").trim();
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return firstSentence.slice(0, 280);
}

function normalizedSourceText(source: WebResearchProviderResult) {
  return normalizeResearchQuery(
    [source.title, source.snippet, source.pageSummary].filter(Boolean).join(" "),
  );
}

function hasNegativeEvidence(text: string) {
  return /\b(closed|cancelled|canceled|not running|suspended|inactive|not available|no longer|postponed)\b/i.test(
    text,
  );
}

function vehicleRentalLike(value: string) {
  return (
    /\b(?:scooters?|motorbikes?|motor\s*bikes?|motorcycles?|bike|bikes)\b/i.test(value) &&
    /\b(?:rent|rental|rentals|hire|hiring)\b/i.test(value)
  );
}

function vehicleRentalSourceText(text: string) {
  if (vehicleRentalDisqualifier(text)) {
    return false;
  }
  return (
    /\b(?:scooters?|motorbikes?|motor\s*bikes?|motorcycles?|mopeds?|bike|bikes|car\s*&\s*bike)\b/i.test(
      text,
    ) &&
    /\b(?:rent|rental|rentals|hire|hiring|rates?|daily\s+rate|per\s+day|deposit|helmet|whatsapp|delivery|pickup)\b/i.test(
      text,
    )
  );
}

function vehicleRentalDisqualifier(text: string) {
  return (
    /\b(?:not|isn t|isn't|not\s+a|not\s+an)\s+(?:a\s+|an\s+)?(?:scooter|motorbike|motorcycle|vehicle|bike)?\s*(?:rental|operator|shop|listing|company)\b/i.test(
      text,
    ) ||
    /\b(?:parking|transport(?:ation)?\s+on\s+the\s+island|nearby availability reference|indirect context only)\b/i.test(
      text,
    )
  );
}

function inferEntityKind(source: ScoredResearchSource): WebResearchEntityKind {
  if (/\b(ferry|route|transfer|bus|van|transport)\b/i.test(source.source.title)) {
    return "route";
  }
  if (source.sourceType === "official" && /\b(operator|tour|ferry)\b/i.test(source.source.title)) {
    return "operator";
  }
  if (eventLike(source.source.title)) {
    return "event";
  }
  return "place";
}

function titleEntityName(title: string) {
  const candidate = title.split(/\s[-|:]\s/)[0]?.trim();
  if (!candidate || candidate.length > 64) {
    return undefined;
  }
  if (!/[A-Z0-9]/.test(candidate) || /^(best|top|guide|siargao|general luna)$/i.test(candidate)) {
    return undefined;
  }
  return candidate;
}

function uniqueResearchEntities(entities: readonly ResearchEntity[]) {
  const seen = new Set<string>();
  const unique: ResearchEntity[] = [];
  for (const entity of entities) {
    const key = `${entity.kind}:${entity.name.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(entity);
  }
  return unique;
}

function confidenceFromScore(score: number): "high" | "medium" | "low" {
  if (score >= 86) {
    return "high";
  }
  if (score >= 60) {
    return "medium";
  }
  return "low";
}

function freshnessForDateContext(dateContext: WebResearchDateContext): WebResearchFreshnessLevel {
  if (dateContext === "today" || dateContext === "tonight" || dateContext === "tomorrow") {
    return "same_day";
  }
  if (dateContext === "next_7_days" || dateContext === "date_range") {
    return "week";
  }
  return "stable";
}

export function normalizeResearchQuery(value: string) {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function importantTokens(value: string) {
  return normalizeResearchQuery(value)
    .split(" ")
    .filter((token) => token.length > 2 && !stopWords.has(token));
}

function uniqueTokens(value: string) {
  return Array.from(new Set(value.split(/\s+/).filter(Boolean))).join(" ");
}

function uniqueStrings(values: readonly string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function parseDate(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function localWeekday(localDate: string | undefined) {
  if (!localDate) {
    return undefined;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(localDate);
  if (!match) {
    return undefined;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
    date.getUTCDay()
  ];
}

function lowerUrl(value: string) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function eventLike(value: string) {
  return /\b(party|nightlife|event|events|dj|bar|club|live music|tonight)\b/i.test(value);
}

function restaurantLike(value: string) {
  return /\b(restaurant|dinner|lunch|breakfast|cafe|food|eat|menu)\b/i.test(value);
}

const stopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "near",
  "what",
  "where",
  "best",
  "good",
  "today",
  "tonight",
  "tomorrow",
  "current",
  "siargao",
]);

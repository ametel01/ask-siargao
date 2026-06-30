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

export const webResearchStatuses = ["available", "insufficient", "provider_unavailable"] as const;

export type WebResearchStatus = (typeof webResearchStatuses)[number];

export const webResearchAnswerRoles = ["primary", "supporting", "negative", "caveat"] as const;

export type WebResearchAnswerRole = (typeof webResearchAnswerRoles)[number];

export const webResearchEntityKinds = [
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

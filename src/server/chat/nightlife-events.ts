import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  type nightlifeCommunitySourceProfileIds,
  nightlifeEventSourceProfileIds,
} from "@/server/providers/adapters";

export const nightlifeEventInterestValues = [
  "party",
  "bar_hopping",
  "dj",
  "live_music",
  "foam_party",
  "pub_quiz",
  "trivia",
  "drinks",
] as const;

export type NightlifeEventInterest = (typeof nightlifeEventInterestValues)[number];

export type NightlifeRouteRole = "warm_up" | "main_party" | "late_option" | "softer_option";
export type NightlifeEventConfidence = "high" | "medium" | "low";

export type NightlifeEventCandidate = {
  id: string;
  venueName: string;
  eventName: string;
  location: "General Luna";
  dayOfWeek: string;
  startTime: string;
  endTime?: string;
  localTimeWindow: string;
  routeRole: NightlifeRouteRole;
  intensity: "low" | "medium" | "high";
  interests: readonly NightlifeEventInterest[];
  sourceProfileId: NightlifeEventSourceProfileId;
  sourceName: string;
  sourceUrl?: string;
  manualVerificationNote?: string;
  sourceBasis: string;
  confidence: NightlifeEventConfidence;
  observedAt: string;
  lastVerifiedAt: string;
  expiresAt: string;
  reviewAfter: string;
  notes: readonly string[];
};

export type NightlifeEventSourceProfileId = (typeof nightlifeEventSourceProfileIds)[number];
export type NightlifeCommunitySourceProfileId = (typeof nightlifeCommunitySourceProfileIds)[number];

export type NightlifePriorityRefreshDecision = {
  status: "not_needed" | "recommended";
  reason: string;
  localDate: string;
  dayOfWeek: string;
  checkedFreshHighMediumEventCount: number;
  minimumFreshHighMediumEventCount: number;
  prioritySourceProfileIds: readonly NightlifeEventSourceProfileId[];
};

export type NightlifeEventSearchInput = {
  location: "General Luna";
  date: "tonight" | "today";
  interests?: readonly NightlifeEventInterest[];
  now?: Date;
};

export type NightlifeEventSearchResult = {
  status: "available" | "no_events";
  location: "General Luna";
  requestedDate: "tonight" | "today";
  localDate: string;
  dayOfWeek: string;
  candidates: readonly NightlifeEventCandidate[];
  route: {
    warmUp?: NightlifeEventCandidate;
    mainParty?: NightlifeEventCandidate;
    lateOption?: NightlifeEventCandidate;
    softerOption?: NightlifeEventCandidate;
  };
  sources: readonly AnswerSourceSummary[];
  source: AnswerSourceSummary;
  refreshDecision: NightlifePriorityRefreshDecision;
};

type WeeklyNightlifeEventFact = Omit<
  NightlifeEventCandidate,
  "observedAt" | "expiresAt" | "sourceProfileId"
> & {
  sourceProfileId: NightlifeEventSourceProfileId | NightlifeCommunitySourceProfileId;
  expiresAtLocalTime: string;
  expiresAtDayOffset?: number;
};

const minimumFreshHighMediumEventCount = 2;
const priorityNightlifeEventSourceProfileIds: readonly NightlifeEventSourceProfileId[] = [
  "source_nightlife_official_venue_websites",
  "source_nightlife_official_multi_venue_event_pages",
  "source_nightlife_local_event_directories",
  "source_nightlife_venue_submitted_events",
  "source_nightlife_public_official_social_posts",
];

const weeklyEventFacts: readonly WeeklyNightlifeEventFact[] = [
  {
    id: "nightlife_barrel_tuesday_pub_quiz",
    venueName: "BARREL",
    eventName: "Tuesday Pub Quiz",
    location: "General Luna",
    dayOfWeek: "Tuesday",
    startTime: "19:00",
    endTime: "21:00",
    localTimeWindow: "7 PM-9 PM",
    routeRole: "warm_up",
    intensity: "medium",
    interests: ["pub_quiz", "trivia", "drinks", "bar_hopping"],
    sourceProfileId: "source_nightlife_local_event_directories",
    sourceName: "SiargaoVibes event listing",
    sourceUrl: "https://siargaovibes.com/activities/tuesdays-pub-quiz-at-barrel/",
    sourceBasis: "Local event listing for Tuesday pub quiz at BARREL.",
    confidence: "medium",
    lastVerifiedAt: "2026-06-30T09:00:00+08:00",
    reviewAfter: "2026-07-01T09:00:00+08:00",
    expiresAtLocalTime: "21:30",
    notes: ["Best used as a social warm-up before a louder main party."],
  },
  {
    id: "nightlife_barbosa_tuesday_disco_tropico",
    venueName: "Barbosa",
    eventName: "Disco Tropico",
    location: "General Luna",
    dayOfWeek: "Tuesday",
    startTime: "21:00",
    localTimeWindow: "9 PM-late",
    routeRole: "main_party",
    intensity: "high",
    interests: ["party", "dj", "drinks", "bar_hopping"],
    sourceProfileId: "source_nightlife_official_venue_websites",
    sourceName: "Barbosa official weekly schedule",
    sourceUrl: "https://www.barbosasiargao.com/schedule-1",
    sourceBasis: "Official weekly schedule lists Tuesday Disco Tropico.",
    confidence: "high",
    lastVerifiedAt: "2026-06-30T09:00:00+08:00",
    reviewAfter: "2026-07-01T09:00:00+08:00",
    expiresAtLocalTime: "02:00",
    expiresAtDayOffset: 1,
    notes: ["Strong Tuesday anchor when the user wants the main party."],
  },
  {
    id: "nightlife_mama_coco_tuesday_latin",
    venueName: "Mama Coco",
    eventName: "Latin Night",
    location: "General Luna",
    dayOfWeek: "Tuesday",
    startTime: "21:00",
    localTimeWindow: "9 PM-late",
    routeRole: "softer_option",
    intensity: "medium",
    interests: ["party", "dj", "live_music", "drinks", "bar_hopping"],
    sourceProfileId: "source_nightlife_local_event_directories",
    sourceName: "SiargaoVibes nightlife listing",
    sourceUrl: "https://siargaovibes.com/nightlife/mama-coco-siargao-events-schedule/",
    sourceBasis: "Local nightlife listing describes the Tuesday Latin Night pattern.",
    confidence: "medium",
    lastVerifiedAt: "2026-06-30T09:00:00+08:00",
    reviewAfter: "2026-07-01T09:00:00+08:00",
    expiresAtLocalTime: "02:00",
    expiresAtDayOffset: 1,
    notes: ["Use as a softer dance option if Barbosa is too intense."],
  },
  {
    id: "nightlife_siargao_beach_club_tuesday_foam",
    venueName: "Siargao Beach Club",
    eventName: "Foam-party pattern",
    location: "General Luna",
    dayOfWeek: "Tuesday",
    startTime: "23:00",
    localTimeWindow: "late night",
    routeRole: "late_option",
    intensity: "high",
    interests: ["party", "foam_party", "dj", "drinks", "bar_hopping"],
    sourceProfileId: "source_nightlife_public_official_social_posts",
    sourceName: "Siargao Beach Club official social profile",
    sourceUrl: "https://www.instagram.com/siargaobeachclubph/",
    sourceBasis: "Official social profile is the approved check point for the foam-party pattern.",
    confidence: "medium",
    lastVerifiedAt: "2026-06-30T09:00:00+08:00",
    reviewAfter: "2026-07-01T09:00:00+08:00",
    expiresAtLocalTime: "02:00",
    expiresAtDayOffset: 1,
    notes: ["Treat as a late option, not as proof of same-day crowd size."],
  },
  {
    id: "nightlife_bed_brew_thursday_party",
    venueName: "Bed & Brew",
    eventName: "Thursday Party",
    location: "General Luna",
    dayOfWeek: "Thursday",
    startTime: "20:00",
    endTime: "23:59",
    localTimeWindow: "8 PM-11:59 PM",
    routeRole: "main_party",
    intensity: "high",
    interests: ["party", "dj", "drinks", "bar_hopping"],
    sourceProfileId: "source_nightlife_local_event_directories",
    sourceName: "SiargaoVibes nightlife listing",
    sourceUrl: "https://siargaovibes.com/nightlife/thursdays-at-bed-brew/",
    sourceBasis: "Local nightlife listing describes the Thursday Bed & Brew party.",
    confidence: "medium",
    lastVerifiedAt: "2026-06-30T09:00:00+08:00",
    reviewAfter: "2026-07-04T09:00:00+08:00",
    expiresAtLocalTime: "00:30",
    expiresAtDayOffset: 1,
    notes: ["Use as the Thursday anchor when present."],
  },
  {
    id: "nightlife_harana_saturday_two_stage",
    venueName: "Harana Surf Resort",
    eventName: "Saturday two-stage party",
    location: "General Luna",
    dayOfWeek: "Saturday",
    startTime: "21:00",
    endTime: "01:00",
    localTimeWindow: "9 PM-1 AM",
    routeRole: "main_party",
    intensity: "high",
    interests: ["party", "dj", "live_music", "drinks", "bar_hopping"],
    sourceProfileId: "source_nightlife_local_event_directories",
    sourceName: "SiargaoVibes nightlife listing",
    sourceUrl: "https://siargaovibes.com/nightlife/saturdays-at-harana/",
    sourceBasis:
      "Listing describes a recurring Saturday party pattern; official same-day confirmation remains unchecked.",
    confidence: "medium",
    lastVerifiedAt: "2026-06-30T09:00:00+08:00",
    reviewAfter: "2026-07-04T09:00:00+08:00",
    expiresAtLocalTime: "01:30",
    expiresAtDayOffset: 1,
    notes: ["Good Saturday anchor, but do not claim last-minute lineup confirmation."],
  },
  {
    id: "nightlife_el_lobo_monday_community_pattern",
    venueName: "El Lobo",
    eventName: "Reported Monday/Wednesday/Friday party rhythm",
    location: "General Luna",
    dayOfWeek: "Monday",
    startTime: "21:00",
    localTimeWindow: "9 PM-late",
    routeRole: "main_party",
    intensity: "medium",
    interests: ["party", "dj", "drinks", "bar_hopping"],
    sourceProfileId: "source_nightlife_local_guides",
    sourceName: "Broad nightlife guide",
    sourceUrl: "https://smallgirlbigbackpack.com/siargao-nightlife-and-party-schedule/",
    sourceBasis:
      "Background guide reports a recurring party rhythm, but it is not an approved event-schedule source.",
    confidence: "low",
    lastVerifiedAt: "2026-06-30T09:00:00+08:00",
    reviewAfter: "2026-07-30T09:00:00+08:00",
    expiresAtLocalTime: "02:00",
    expiresAtDayOffset: 1,
    notes: ["Community-style discovery signal only; do not use as same-day event truth."],
  },
];

export function searchNightlifeEvents(
  input: NightlifeEventSearchInput,
): NightlifeEventSearchResult {
  const now = input.now ?? new Date();
  const localDate = manilaDateParts(now);
  const requestedInterests = new Set(input.interests ?? []);
  const candidates = weeklyEventFacts
    .filter((event) => event.dayOfWeek === localDate.weekday)
    .filter(isApprovedEventSourceFact)
    .filter((event) => isFreshForSameDay(event, now))
    .map((event) => eventOccurrenceFromWeeklyFact(event, localDate.date))
    .filter((event) => !isExpiredOccurrence(event, now))
    .filter((event) => eventMatchesRequestedInterests(event, requestedInterests))
    .sort(compareNightlifeCandidates);
  const refreshDecision = buildPriorityRefreshDecision(candidates, localDate);
  const sources = nightlifeSourceSummaries({
    candidates,
    dayOfWeek: localDate.weekday,
    fetchedAt: now.toISOString(),
  });

  return {
    status: candidates.length > 0 ? "available" : "no_events",
    location: input.location,
    requestedDate: input.date,
    localDate: localDate.date,
    dayOfWeek: localDate.weekday,
    candidates,
    route: routeFromCandidates(candidates),
    sources,
    source: sources[0] ?? fallbackNightlifeSourceSummary(localDate.weekday, now.toISOString()),
    refreshDecision,
  };
}

export function renderNightlifeEventsText(result: NightlifeEventSearchResult) {
  if (result.status === "no_events") {
    return [
      `No approved General Luna nightlife event facts matched ${result.dayOfWeek} ${result.localDate}.`,
      "Do not substitute Google Places bar rankings as event evidence.",
      `Not checked: ${nightlifeNotChecked.join("; ")}.`,
    ].join(" ");
  }

  return [
    `Approved General Luna nightlife event facts for ${result.dayOfWeek} ${result.localDate}:`,
    ...result.candidates.map(
      (candidate, index) =>
        `${index + 1}. ${candidate.venueName} - ${candidate.eventName} (${candidate.localTimeWindow}; ${candidate.routeRole.replaceAll("_", " ")}; ${candidate.intensity} intensity; confidence: ${candidate.confidence}; profile: ${candidate.sourceProfileId}; verified: ${candidate.lastVerifiedAt}; expires: ${candidate.expiresAt}; source: ${candidate.sourceName}).`,
    ),
    routeSummaryText(result),
    refreshDecisionText(result.refreshDecision),
    `Not checked: ${nightlifeNotChecked.join("; ")}.`,
  ].join("\n");
}

function routeFromCandidates(candidates: readonly NightlifeEventCandidate[]) {
  return {
    warmUp: candidates.find((candidate) => candidate.routeRole === "warm_up"),
    mainParty: candidates.find((candidate) => candidate.routeRole === "main_party"),
    lateOption: candidates.find((candidate) => candidate.routeRole === "late_option"),
    softerOption: candidates.find((candidate) => candidate.routeRole === "softer_option"),
  };
}

function routeSummaryText(result: NightlifeEventSearchResult) {
  const route = [
    routeStop("Warm-up", result.route.warmUp),
    routeStop("Main party", result.route.mainParty),
    routeStop("Late option", result.route.lateOption),
    routeStop("Softer option", result.route.softerOption),
  ].filter(Boolean);
  return route.length ? `Route roles: ${route.join(" | ")}.` : "No complete route roles available.";
}

function routeStop(label: string, candidate: NightlifeEventCandidate | undefined) {
  return candidate ? `${label}: ${candidate.venueName} (${candidate.eventName})` : undefined;
}

function isApprovedEventSourceFact(
  event: WeeklyNightlifeEventFact,
): event is WeeklyNightlifeEventFact & { sourceProfileId: NightlifeEventSourceProfileId } {
  return (nightlifeEventSourceProfileIds as readonly string[]).includes(event.sourceProfileId);
}

function isFreshForSameDay(event: WeeklyNightlifeEventFact, now: Date) {
  return new Date(event.reviewAfter).getTime() >= now.getTime();
}

function eventOccurrenceFromWeeklyFact(
  event: WeeklyNightlifeEventFact & { sourceProfileId: NightlifeEventSourceProfileId },
  localDate: string,
): NightlifeEventCandidate {
  return {
    ...event,
    observedAt: `${localDate}T${event.startTime}:00+08:00`,
    expiresAt: eventExpiresAt(event, localDate),
  };
}

function eventExpiresAt(event: WeeklyNightlifeEventFact, localDate: string) {
  const eventDate = manilaDateWithOffset(localDate, event.expiresAtDayOffset ?? 0);
  return `${eventDate}T${event.expiresAtLocalTime}:00+08:00`;
}

function manilaDateWithOffset(localDate: string, offsetDays: number) {
  if (offsetDays === 0) {
    return localDate;
  }
  const date = new Date(`${localDate}T00:00:00+08:00`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return manilaDateParts(date).date;
}

function isExpiredOccurrence(event: NightlifeEventCandidate, now: Date) {
  return new Date(event.expiresAt).getTime() <= now.getTime();
}

function eventMatchesRequestedInterests(
  event: NightlifeEventCandidate,
  requestedInterests: ReadonlySet<NightlifeEventInterest>,
) {
  if (requestedInterests.size === 0) {
    return true;
  }
  if (event.interests.some((interest) => requestedInterests.has(interest))) {
    return true;
  }
  return isBroadRouteSearch(requestedInterests) && event.routeRole === "warm_up";
}

function isBroadRouteSearch(requestedInterests: ReadonlySet<NightlifeEventInterest>) {
  return requestedInterests.has("party") || requestedInterests.has("bar_hopping");
}

function buildPriorityRefreshDecision(
  candidates: readonly NightlifeEventCandidate[],
  localDate: ReturnType<typeof manilaDateParts>,
): NightlifePriorityRefreshDecision {
  const checkedFreshHighMediumEventCount = candidates.filter((candidate) =>
    highOrMediumConfidence(candidate.confidence),
  ).length;
  if (checkedFreshHighMediumEventCount >= minimumFreshHighMediumEventCount) {
    return {
      status: "not_needed",
      reason:
        "Fresh high/medium confidence event-backed options meet the same-day General Luna minimum.",
      localDate: localDate.date,
      dayOfWeek: localDate.weekday,
      checkedFreshHighMediumEventCount,
      minimumFreshHighMediumEventCount,
      prioritySourceProfileIds: priorityNightlifeEventSourceProfileIds,
    };
  }

  return {
    status: "recommended",
    reason:
      "Fewer than two fresh high/medium confidence event-backed options are available; refresh approved priority event sources before treating the answer as current.",
    localDate: localDate.date,
    dayOfWeek: localDate.weekday,
    checkedFreshHighMediumEventCount,
    minimumFreshHighMediumEventCount,
    prioritySourceProfileIds: priorityNightlifeEventSourceProfileIds,
  };
}

function highOrMediumConfidence(confidence: NightlifeEventConfidence) {
  return confidence === "high" || confidence === "medium";
}

function refreshDecisionText(decision: NightlifePriorityRefreshDecision) {
  return `Same-day refresh decision: ${decision.status} (${decision.checkedFreshHighMediumEventCount}/${decision.minimumFreshHighMediumEventCount} fresh high/medium event-backed options; ${decision.reason}).`;
}

function nightlifeSourceSummaries({
  candidates,
  dayOfWeek,
  fetchedAt,
}: {
  candidates: readonly NightlifeEventCandidate[];
  dayOfWeek: string;
  fetchedAt: string;
}): readonly AnswerSourceSummary[] {
  const sourceGroups = new Map<NightlifeEventSourceProfileId, NightlifeEventCandidate[]>();
  for (const candidate of candidates) {
    sourceGroups.set(candidate.sourceProfileId, [
      ...(sourceGroups.get(candidate.sourceProfileId) ?? []),
      candidate,
    ]);
  }

  if (sourceGroups.size === 0) {
    return [fallbackNightlifeSourceSummary(dayOfWeek, fetchedAt)];
  }

  return [...sourceGroups.entries()].map(([sourceProfileId, sourceCandidates]) => ({
    label: "event_checked",
    sourceName: nightlifeSourceSummaryName(sourceProfileId),
    sourceProfileId,
    fetchedAt,
    confidence: strongestConfidence(sourceCandidates),
    checked: [
      `approved General Luna nightlife event facts for ${dayOfWeek}`,
      `verified event occurrences: ${sourceCandidates.map((candidate) => candidate.venueName).join(", ")}`,
      "route roles: warm-up, main party, late option, and softer option when available",
    ],
    notChecked: nightlifeNotChecked,
  }));
}

function fallbackNightlifeSourceSummary(dayOfWeek: string, fetchedAt: string): AnswerSourceSummary {
  return {
    label: "no_current_event_facts",
    sourceName: "Approved General Luna nightlife event source profiles",
    sourceProfileId: priorityNightlifeEventSourceProfileIds[0],
    fetchedAt,
    confidence: "low",
    checked: [],
    notChecked: [
      `current General Luna nightlife event facts for ${dayOfWeek}`,
      ...nightlifeNotChecked,
      "same-day event schedule until approved priority sources are refreshed",
    ],
  };
}

function strongestConfidence(candidates: readonly NightlifeEventCandidate[]) {
  if (candidates.some((candidate) => candidate.confidence === "high")) {
    return "high";
  }
  if (candidates.some((candidate) => candidate.confidence === "medium")) {
    return "medium";
  }
  return "low";
}

function nightlifeSourceSummaryName(sourceProfileId: NightlifeEventSourceProfileId) {
  switch (sourceProfileId) {
    case "source_nightlife_official_venue_websites":
      return "Official nightlife venue websites";
    case "source_nightlife_official_multi_venue_event_pages":
      return "Official multi-venue nightlife event pages";
    case "source_nightlife_local_event_directories":
      return "Local nightlife event directories";
    case "source_nightlife_venue_submitted_events":
      return "Venue-submitted nightlife events";
    case "source_nightlife_public_official_social_posts":
      return "Public official venue social posts";
  }
}

const nightlifeNotChecked = [
  "same-day venue social posts",
  "live crowd size",
  "door policy",
  "guest list",
  "table availability",
  "last-minute cancellation",
  "exact closing time",
];

function compareNightlifeCandidates(left: NightlifeEventCandidate, right: NightlifeEventCandidate) {
  const timeDelta = minutesSinceMidnight(left.startTime) - minutesSinceMidnight(right.startTime);
  if (timeDelta !== 0) {
    return timeDelta;
  }
  return intensityRank(right.intensity) - intensityRank(left.intensity);
}

function intensityRank(value: NightlifeEventCandidate["intensity"]) {
  if (value === "high") {
    return 3;
  }
  if (value === "medium") {
    return 2;
  }
  return 1;
}

function minutesSinceMidnight(value: string) {
  const [hour, minute] = value.split(":").map((part) => Number(part));
  return (hour ?? 0) * 60 + (minute ?? 0);
}

function manilaDateParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
  }).formatToParts(date);
  return {
    date: `${partValue(parts, "year")}-${partValue(parts, "month")}-${partValue(parts, "day")}`,
    weekday: partValue(parts, "weekday"),
  };
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

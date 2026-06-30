import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";

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
  sourceName: string;
  sourceUrl: string;
  sourceBasis: string;
  confidence: "high" | "medium" | "low";
  notes: readonly string[];
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
  source: AnswerSourceSummary;
};

const sourceProfileId = "source_ask_siargao_nightlife_events";

const weeklyEventFacts: readonly NightlifeEventCandidate[] = [
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
    sourceName: "SiargaoVibes event listing",
    sourceUrl: "https://siargaovibes.com/activities/tuesdays-pub-quiz-at-barrel/",
    sourceBasis: "Local event listing for Tuesday pub quiz at BARREL.",
    confidence: "medium",
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
    sourceName: "Barbosa official weekly schedule",
    sourceUrl: "https://www.barbosasiargao.com/schedule-1",
    sourceBasis: "Official weekly schedule lists Tuesday Disco Tropico.",
    confidence: "high",
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
    sourceName: "SiargaoVibes nightlife listing",
    sourceUrl: "https://siargaovibes.com/nightlife/mama-coco-siargao-events-schedule/",
    sourceBasis: "Local nightlife listing describes the Tuesday Latin Night pattern.",
    confidence: "medium",
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
    sourceName: "Siargao Beach Club official social profile",
    sourceUrl: "https://www.instagram.com/siargaobeachclubph/",
    sourceBasis: "Official social profile is the approved check point for the foam-party pattern.",
    confidence: "medium",
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
    sourceName: "SiargaoVibes nightlife listing",
    sourceUrl: "https://siargaovibes.com/nightlife/thursdays-at-bed-brew/",
    sourceBasis: "Local nightlife listing describes the Thursday Bed & Brew party.",
    confidence: "medium",
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
    sourceName: "SiargaoVibes nightlife listing",
    sourceUrl: "https://siargaovibes.com/nightlife/saturdays-at-harana/",
    sourceBasis:
      "Listing describes a recurring Saturday party pattern; official same-day confirmation remains unchecked.",
    confidence: "medium",
    notes: ["Good Saturday anchor, but do not claim last-minute lineup confirmation."],
  },
];

export function searchNightlifeEvents(
  input: NightlifeEventSearchInput,
): NightlifeEventSearchResult {
  const localDate = manilaDateParts(input.now ?? new Date());
  const requestedInterests = new Set(input.interests ?? []);
  const candidates = weeklyEventFacts
    .filter((event) => event.dayOfWeek === localDate.weekday)
    .filter((event) => eventMatchesRequestedInterests(event, requestedInterests))
    .sort(compareNightlifeCandidates);

  return {
    status: candidates.length > 0 ? "available" : "no_events",
    location: input.location,
    requestedDate: input.date,
    localDate: localDate.date,
    dayOfWeek: localDate.weekday,
    candidates,
    route: routeFromCandidates(candidates),
    source: nightlifeSourceSummary({
      candidateCount: candidates.length,
      dayOfWeek: localDate.weekday,
      fetchedAt: (input.now ?? new Date()).toISOString(),
    }),
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
        `${index + 1}. ${candidate.venueName} - ${candidate.eventName} (${candidate.localTimeWindow}; ${candidate.routeRole.replaceAll("_", " ")}; ${candidate.intensity} intensity; source: ${candidate.sourceName}).`,
    ),
    routeSummaryText(result),
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

function nightlifeSourceSummary({
  candidateCount,
  dayOfWeek,
  fetchedAt,
}: {
  candidateCount: number;
  dayOfWeek: string;
  fetchedAt: string;
}): AnswerSourceSummary {
  return {
    label: "curated_local_guide",
    sourceName: "Ask Siargao approved nightlife event facts",
    sourceProfileId,
    fetchedAt,
    confidence: candidateCount > 0 ? "medium" : "low",
    checked:
      candidateCount > 0
        ? [
            `approved General Luna nightlife event facts for ${dayOfWeek}`,
            "route roles: warm-up, main party, late option, and softer option when available",
          ]
        : [`approved General Luna nightlife event facts for ${dayOfWeek}`],
    notChecked: nightlifeNotChecked,
  };
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

import { z } from "zod";

import type { ItineraryPlan, ItineraryStop } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  type LocalGuideCandidate,
  type LocalGuideSearchResult,
  searchSiargaoLocalGuide,
} from "@/server/local/siargao-beaches";

export const localItineraryThemes = [
  "rainy_cloud_9_afternoon",
  "sunset_plus_dinner",
  "sandy_beach_half_day",
  "non_surfer_half_day",
  "food_crawl",
] as const;

const optionalNullable = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

export const localItineraryRequestSchema = z
  .object({
    theme: z.enum(localItineraryThemes),
    origin: optionalNullable(z.string().trim().min(2).max(120)),
    duration_hours: optionalNullable(z.number().min(2).max(4)),
    transport_mode: optionalNullable(z.enum(["walk", "scooter", "tricycle", "van"])),
    max_ride_minutes: optionalNullable(z.number().int().min(5).max(180)),
    needs_weather_check: optionalNullable(z.boolean()),
    needs_open_now: optionalNullable(z.boolean()),
    meal_preference: optionalNullable(z.string().trim().min(2).max(120)),
    constraints: optionalNullable(z.array(z.string().trim().min(1).max(120)).max(12)),
  })
  .strict();

export type LocalItineraryRequest = z.infer<typeof localItineraryRequestSchema>;

export type LocalItineraryResult = {
  request: Required<Pick<LocalItineraryRequest, "duration_hours" | "max_ride_minutes" | "origin">> &
    Omit<LocalItineraryRequest, "duration_hours" | "max_ride_minutes" | "origin">;
  localGuide: LocalGuideSearchResult;
  plan: ItineraryPlan;
  requiredToolChecks: ItineraryRequiredToolChecks;
  caveats: readonly string[];
};

export type ItineraryRequiredToolChecks = {
  weather?: {
    required: true;
    tool: "get_weather_forecast";
    location: "Siargao Island" | "Cloud 9" | "General Luna" | "Del Carmen";
    date_range: "today" | "next_7_days";
    reason: string;
  };
  places: readonly {
    required: true;
    tool: "search_places";
    query: string;
    center: { latitude: number; longitude: number };
    radius_meters: number;
    constraints: {
      included_type?: string;
      open_now?: boolean;
      page_size: number;
    };
    reason: string;
  }[];
};

const defaultOrigin = "General Luna / Cloud 9";
const defaultDurationHours = 3;
const defaultMaxRideMinutes = 30;
const generalLunaCenter = { latitude: 9.784, longitude: 126.158 };
const cloud9Center = { latitude: 9.8116, longitude: 126.1651 };
const siargaoGenericUnchecked = [
  "live weather",
  "live Google Places open status",
  "surf",
  "tide",
  "road flooding",
  "closures",
  "provider-independent safety checks",
];

export function planLocalItinerary(input: LocalItineraryRequest): LocalItineraryResult {
  const request = normalizeRequest(input);
  const localGuide = searchSiargaoLocalGuide(localGuideQuery(request));
  const uncheckedSource = itineraryUncheckedSourceSummary(request);
  const sources = uniqueSourceSummaries([localGuide.sourceSummary, uncheckedSource]);
  const plan = buildPlan(request, localGuide, sources);
  const requiredToolChecks = buildRequiredToolChecks(request);
  const caveats = uniqueText([
    ...plan.stops.flatMap((stop) => stop.caveats),
    ...plan.fallbackStops.flatMap((stop) => stop.caveats),
    ...localGuide.caveats,
    ...uncheckedSource.notChecked,
  ]);

  return {
    request,
    localGuide,
    plan,
    requiredToolChecks,
    caveats,
  };
}

export function renderLocalItineraryToolText(result: LocalItineraryResult) {
  return [
    `Structured itinerary artifact prepared: ${result.plan.title} (${result.plan.durationLabel}).`,
    "Use this as planning evidence; write the final traveler-facing answer in your own concise prose.",
    ...result.plan.stops.map((stop) =>
      [
        `${stop.sequence}. ${stop.title}`,
        stop.area,
        stop.kind,
        stop.travelTimeFromPreviousMinutes
          ? `estimated ${stop.travelTimeFromPreviousMinutes} min from previous stop`
          : undefined,
        stop.rationale,
      ]
        .filter(Boolean)
        .join(" - "),
    ),
    ...(result.plan.fallbackStops.length
      ? [
          `Fallbacks: ${result.plan.fallbackStops
            .map((stop) => `${stop.title} (${stop.rationale})`)
            .join("; ")}.`,
        ]
      : []),
    ...(result.plan.skip.length ? [`Skip: ${result.plan.skip.join("; ")}.`] : []),
    ...renderRequiredToolChecksText(result.requiredToolChecks),
    `Source caveats: ${result.caveats.join("; ")}.`,
  ].join("\n");
}

function renderRequiredToolChecksText(requiredToolChecks: ItineraryRequiredToolChecks) {
  const lines: string[] = [];
  if (requiredToolChecks.weather) {
    lines.push(
      `Required weather check: call ${requiredToolChecks.weather.tool} for ${requiredToolChecks.weather.location} (${requiredToolChecks.weather.date_range}) because ${requiredToolChecks.weather.reason}.`,
    );
  }
  for (const placesCheck of requiredToolChecks.places) {
    lines.push(
      `Required Places check: call ${placesCheck.tool} for "${placesCheck.query}" within ${placesCheck.radius_meters}m because ${placesCheck.reason}.`,
    );
  }
  return lines;
}

function normalizeRequest(input: LocalItineraryRequest): LocalItineraryResult["request"] {
  return {
    ...input,
    origin: input.origin ?? defaultOrigin,
    duration_hours: input.duration_hours ?? defaultDurationHours,
    max_ride_minutes: input.max_ride_minutes ?? defaultMaxRideMinutes,
  };
}

function localGuideQuery(request: LocalItineraryResult["request"]) {
  switch (request.theme) {
    case "rainy_cloud_9_afternoon":
      return {
        query: "rainy Cloud 9 afternoon short ride fallback",
        filters: {
          rainFit: true,
          maxRideMinutes: Math.min(request.max_ride_minutes, 30),
          transportMode: request.transport_mode,
        },
      };
    case "sunset_plus_dinner":
      return {
        query: "sunset late-afternoon beach stop near General Luna",
        filters: {
          sunset: true,
          maxRideMinutes: Math.min(request.max_ride_minutes, 30),
          transportMode: request.transport_mode,
        },
      };
    case "sandy_beach_half_day":
      return {
        query: "sandy beach half day close to General Luna",
        filters: {
          beachSurface: "sand" as const,
          swimming: true,
          maxRideMinutes: Math.min(request.max_ride_minutes, 30),
          transportMode: request.transport_mode,
        },
      };
    case "non_surfer_half_day":
      return {
        query: "non surfer half day sandy beach walk near General Luna",
        filters: {
          beachSurface: "sand" as const,
          swimming: true,
          maxRideMinutes: Math.min(request.max_ride_minutes, 35),
          transportMode: request.transport_mode,
        },
      };
    case "food_crawl":
      return {
        query: "General Luna food crawl short route",
        filters: {
          maxRideMinutes: Math.min(request.max_ride_minutes, 30),
          transportMode: request.transport_mode,
        },
      };
  }
}

function buildPlan(
  request: LocalItineraryResult["request"],
  localGuide: LocalGuideSearchResult,
  sources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  switch (request.theme) {
    case "rainy_cloud_9_afternoon":
      return rainyCloud9Plan(request, localGuide, sources);
    case "sunset_plus_dinner":
      return sunsetDinnerPlan(request, localGuide, sources);
    case "sandy_beach_half_day":
      return sandyBeachPlan(request, localGuide, sources);
    case "non_surfer_half_day":
      return nonSurferPlan(request, localGuide, sources);
    case "food_crawl":
      return foodCrawlPlan(request, sources);
  }
}

function rainyCloud9Plan(
  request: LocalItineraryResult["request"],
  localGuide: LocalGuideSearchResult,
  sources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  const fallback = localGuide.candidates[0];
  return {
    title: "Rainy Cloud 9 Afternoon",
    durationLabel: durationLabel(request.duration_hours),
    stops: [
      {
        title: "Cloud 9 boardwalk and surf-watch window",
        kind: "activity",
        sequence: 1,
        area: "Cloud 9",
        rationale: "Keeps the exposed part short and close to cover if showers build.",
        caveats: [
          "Weather must be checked with get_weather_forecast before the final answer calls this a rainy-day-safe plan.",
          "Surf, tide, road flooding, closures, and safety were not checked.",
        ],
      },
      {
        title: "Covered cafe near Cloud 9",
        kind: "meal",
        sequence: 2,
        area: "Cloud 9 / Catangnan",
        travelTimeFromPreviousMinutes: 5,
        rationale: "Gives the plan a practical rain fallback without a long ride.",
        caveats: ["Use search_places before claiming open-now status, maps identity, or hours."],
      },
      candidateStop(fallback, 3, {
        fallbackTitle: "Close General Luna-side beach break",
        rationale: "Use only if there is a dry break and roads look normal.",
      }),
    ],
    fallbackStops: fallback
      ? [
          candidateStop(fallback, 1, {
            rationale: "Swap this in only during a dry break; keep the route close.",
          }),
        ]
      : [],
    skip: [
      "Exposed beach hopping if heavy rain starts",
      "Long north-island rides from General Luna",
      "Reef or surf activity without a separate surf/tide/safety check",
    ],
    sources,
  };
}

function sunsetDinnerPlan(
  request: LocalItineraryResult["request"],
  localGuide: LocalGuideSearchResult,
  sources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  const beachStop = localGuide.candidates.find((candidate) =>
    /cloud 9|malinao|doot/i.test(candidate.name),
  );
  return {
    title: "Sunset plus Dinner",
    durationLabel: durationLabel(request.duration_hours),
    stops: [
      beachStop
        ? candidateStop(beachStop, 1, {
            rationale:
              "Keeps the pre-dinner stop close to General Luna and avoids a late long ride.",
          })
        : {
            title: "Cloud 9 boardwalk sunset watch",
            kind: "activity",
            sequence: 1,
            area: "Cloud 9",
            rationale: "Classic late-afternoon atmosphere without committing to a far beach.",
            caveats: ["Cloud cover and rain were not checked."],
          },
      {
        title: dinnerTitle(request),
        kind: "meal",
        sequence: 2,
        area: "General Luna",
        travelTimeFromPreviousMinutes: 10,
        rationale: "Keeps dinner close after dark and lets Places choose live options later.",
        caveats: [
          "Use search_places before naming specific dinner venues or claiming open status.",
        ],
      },
    ],
    fallbackStops: [
      {
        title: "Cafe or casual dinner in General Luna",
        kind: "meal",
        sequence: 1,
        area: "General Luna",
        rationale: "Use this if sunset weather is poor or the first dinner search fails.",
        caveats: ["Live availability, bookings, and kitchen hours were not checked."],
      },
    ],
    skip: [
      "Far north dinner detours after sunset",
      "Any venue claimed open without Places evidence",
    ],
    sources,
  };
}

function sandyBeachPlan(
  request: LocalItineraryResult["request"],
  localGuide: LocalGuideSearchResult,
  sources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  const candidates = localGuide.candidates.slice(0, 2);
  return {
    title: "Sandy Beach Half-Day",
    durationLabel: durationLabel(request.duration_hours),
    stops: [
      ...candidates.map((candidate, index) =>
        candidateStop(candidate, index + 1, {
          rationale:
            index === 0
              ? "Make this the main sandy beach stop within the ride-time constraint."
              : "Keep this as a nearby second stop only if conditions look comfortable.",
        }),
      ),
      {
        title: "Simple snack or cafe stop near General Luna",
        kind: "meal",
        sequence: candidates.length + 1,
        area: "General Luna",
        travelTimeFromPreviousMinutes: 15,
        rationale: "Keeps the plan within a half-day instead of stretching to the north island.",
        caveats: ["Specific cafe identity and open status need Places evidence."],
      },
    ],
    fallbackStops: localGuide.candidates.slice(2, 3).map((candidate) =>
      candidateStop(candidate, 1, {
        rationale: "Use this if the first sandy stop is crowded or conditions look off.",
      }),
    ),
    skip: [
      "Pacifico Beach and Alegria Beach under a strict 30-minute General Luna constraint",
      "Cloud 9 as the smooth-sand swimming stop",
      "Swimming claims without a tide/current/safety check",
    ],
    sources,
  };
}

function nonSurferPlan(
  request: LocalItineraryResult["request"],
  localGuide: LocalGuideSearchResult,
  sources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  const candidates = localGuide.candidates.filter((candidate) => !/cloud 9/i.test(candidate.name));
  const firstBeach = candidates[0];
  const secondBeach = candidates[1];
  return {
    title: "Non-Surfer Half-Day",
    durationLabel: durationLabel(request.duration_hours),
    stops: [
      candidateStop(firstBeach, 1, {
        fallbackTitle: "Close sandy beach walk",
        rationale: "Start with a non-surf beach stop instead of reef/surf watching.",
      }),
      {
        title: "General Luna cafe or town stroll",
        kind: "activity",
        sequence: 2,
        area: "General Luna",
        travelTimeFromPreviousMinutes: 15,
        rationale: "Adds a dry-land stop so the plan is not surf-only.",
        caveats: ["Use Places if the cafe identity, maps link, or open status matters."],
      },
      candidateStop(secondBeach, 3, {
        fallbackTitle: "Second close beach option",
        rationale: "Use as an optional short second beach stop if time and conditions allow.",
      }),
    ],
    fallbackStops: [
      {
        title: "Covered cafe in General Luna",
        kind: "meal",
        sequence: 1,
        area: "General Luna",
        rationale: "Fallback if beach conditions or rain make outdoor time poor.",
        caveats: ["Live cafe status was not checked."],
      },
    ],
    skip: [
      "Surf-only lessons or reef entries",
      "Cloud 9 as the main swimming beach",
      "Any safety claim without local condition checks",
    ],
    sources,
  };
}

function foodCrawlPlan(
  request: LocalItineraryResult["request"],
  sources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  const mealPreference = request.meal_preference ?? "casual local food";
  return {
    title: "General Luna Food Crawl",
    durationLabel: durationLabel(request.duration_hours),
    stops: [
      {
        title: `First ${mealPreference} stop in General Luna`,
        kind: "meal",
        sequence: 1,
        area: "General Luna",
        rationale: "Start central so live Places searches can keep the crawl compact.",
        caveats: ["Use search_places before naming venues, maps links, ratings, or open status."],
      },
      {
        title: "Second stop toward Catangnan or Tourism Road",
        kind: "meal",
        sequence: 2,
        area: "General Luna / Catangnan",
        travelTimeFromPreviousMinutes: 10,
        rationale: "Keeps rides short while giving the AI room to pick a different food type.",
        caveats: ["Cuisine, price, and open-now status need Places evidence."],
      },
      {
        title: "Dessert, coffee, or drinks stop",
        kind: "meal",
        sequence: 3,
        area: "General Luna",
        travelTimeFromPreviousMinutes: 10,
        rationale: "Ends near the main accommodation and tricycle area.",
        caveats: ["Use Places for live hours before presenting a final venue."],
      },
    ],
    fallbackStops: [
      {
        title: "One reliable central General Luna venue",
        kind: "meal",
        sequence: 1,
        area: "General Luna",
        rationale: "Use this if live Places checks return too few crawl stops.",
        caveats: ["Do not claim reliability unless Places or curated evidence supports it."],
      },
    ],
    skip: [
      "Venue names without live or fresh-cache Places evidence",
      "Long rides between meal stops",
      "Claims about bookings, table availability, or review text",
    ],
    sources,
  };
}

function buildRequiredToolChecks(
  request: LocalItineraryResult["request"],
): ItineraryRequiredToolChecks {
  return {
    ...(requiresWeatherCheck(request) ? { weather: weatherCheckForRequest(request) } : {}),
    places: placesChecksForRequest(request),
  };
}

function requiresWeatherCheck(request: LocalItineraryResult["request"]) {
  return (
    request.needs_weather_check === true ||
    request.theme === "rainy_cloud_9_afternoon" ||
    request.theme === "sunset_plus_dinner"
  );
}

function weatherCheckForRequest(
  request: LocalItineraryResult["request"],
): NonNullable<ItineraryRequiredToolChecks["weather"]> {
  const location = request.theme === "rainy_cloud_9_afternoon" ? "Cloud 9" : "General Luna";
  return {
    required: true,
    tool: "get_weather_forecast",
    location,
    date_range: "today",
    reason:
      request.theme === "rainy_cloud_9_afternoon"
        ? "rain materially changes the sequence and fallback choice"
        : "cloud cover and rain materially affect the outdoor itinerary window",
  };
}

function placesChecksForRequest(
  request: LocalItineraryResult["request"],
): ItineraryRequiredToolChecks["places"] {
  switch (request.theme) {
    case "rainy_cloud_9_afternoon":
      return [
        placesCheck({
          center: cloud9Center,
          includedType: "cafe",
          query: "covered cafes near Cloud 9 Siargao",
          radiusMeters: 2_500,
          reason: "the rainy plan uses a covered cafe stop whose live identity and hours matter",
        }),
      ];
    case "sunset_plus_dinner":
      return [
        placesCheck({
          center: generalLunaCenter,
          includedType: "restaurant",
          query: `${request.meal_preference ?? "dinner restaurants"} General Luna Siargao`,
          radiusMeters: 4_000,
          reason: "the dinner stop needs live venue identity, map links, and open-now status",
        }),
      ];
    case "food_crawl":
      return [
        placesCheck({
          center: generalLunaCenter,
          includedType: "restaurant",
          query: `${request.meal_preference ?? "restaurants"} General Luna Siargao`,
          radiusMeters: 4_000,
          reason: "the first food-crawl stop needs live venue choices",
        }),
        placesCheck({
          center: generalLunaCenter,
          includedType: "cafe",
          query: "cafes or dessert near General Luna Siargao",
          radiusMeters: 4_000,
          reason: "the later crawl stop needs live cafe or dessert options",
        }),
      ];
    case "sandy_beach_half_day":
    case "non_surfer_half_day":
      return request.needs_open_now
        ? [
            placesCheck({
              center: generalLunaCenter,
              includedType: "cafe",
              query: "cafes near General Luna Siargao",
              radiusMeters: 4_000,
              reason: "the optional cafe or snack stop needs live identity and hours",
            }),
          ]
        : [];
  }
}

function placesCheck({
  center,
  includedType,
  query,
  radiusMeters,
  reason,
}: {
  center: { latitude: number; longitude: number };
  includedType: string;
  query: string;
  radiusMeters: number;
  reason: string;
}): ItineraryRequiredToolChecks["places"][number] {
  return {
    required: true,
    tool: "search_places",
    query,
    center,
    radius_meters: radiusMeters,
    constraints: {
      included_type: includedType,
      open_now: true,
      page_size: 5,
    },
    reason,
  };
}

function candidateStop(
  candidate: LocalGuideCandidate | undefined,
  sequence: number,
  options: { fallbackTitle?: string; rationale: string },
): ItineraryStop {
  if (!candidate) {
    return {
      title: options.fallbackTitle ?? "General Luna-side flexible stop",
      kind: "activity",
      sequence,
      area: "General Luna",
      rationale: options.rationale,
      caveats: ["No curated local guide candidate was available for this exact slot."],
    };
  }

  return {
    title: candidate.name,
    kind: "beach",
    sequence,
    area: candidate.area,
    travelTimeFromPreviousMinutes: candidate.rideTimeFromGeneralLunaMinutes.max,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${candidate.name} ${candidate.area} Siargao`,
    )}`,
    rationale: options.rationale,
    caveats: uniqueText([...candidate.caveats, candidate.sourceNotes]),
  };
}

function itineraryUncheckedSourceSummary(
  request: LocalItineraryResult["request"],
): AnswerSourceSummary {
  return {
    label: "not_verified",
    sourceName: "Itinerary planner unchecked live signals",
    confidence: "medium",
    checked: [],
    notChecked: uniqueText([
      ...(request.needs_weather_check ? ["weather forecast for the itinerary window"] : []),
      ...(request.needs_open_now ? ["live open-now status for meal, cafe, or venue stops"] : []),
      ...siargaoGenericUnchecked,
    ]),
  };
}

function dinnerTitle(request: LocalItineraryResult["request"]) {
  return request.meal_preference
    ? `Dinner in General Luna matching ${request.meal_preference}`
    : "Dinner in General Luna";
}

function durationLabel(hours: number) {
  if (hours >= 4) {
    return "4 hours";
  }
  return `${hours}-${Math.min(hours + 1, 4)} hours`;
}

function uniqueSourceSummaries(sources: readonly AnswerSourceSummary[]) {
  const results: AnswerSourceSummary[] = [];
  const seen = new Set<string>();
  for (const source of sources) {
    const key = [
      source.label,
      normalizeText(source.sourceName),
      source.sourceProfileId ?? "",
      source.fetchedAt ?? "",
    ].join("|");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(source);
  }
  return results;
}

function uniqueText(values: readonly string[]) {
  return [...new Set(values.map(normalizeText).filter(Boolean))];
}

function normalizeText(value: string) {
  return value.replaceAll(/\s+/g, " ").trim();
}

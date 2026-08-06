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
  "itinerary_review",
] as const;

const optionalNullable = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

const itineraryReviewStopSchema = z.strictObject({
  title: z.string().trim().min(2).max(120),
  area: z.string().trim().min(2).max(80),
  kind: z.enum(["place", "beach", "activity", "meal", "transfer"]),
  time: optionalNullable(z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)),
  duration_minutes: optionalNullable(z.number().int().min(15).max(720)),
  weather_sensitive: optionalNullable(z.boolean()),
});

const itineraryReviewDaySchema = z.strictObject({
  day_label: z.string().trim().min(1).max(40),
  stops: z.array(itineraryReviewStopSchema).min(1).max(7),
});

export const localItineraryRequestSchema = z
  .strictObject({
    theme: z.enum(localItineraryThemes),
    origin: optionalNullable(z.string().trim().min(2).max(120)),
    duration_hours: optionalNullable(z.number().min(2).max(4)),
    transport_mode: optionalNullable(z.enum(["walk", "scooter", "tricycle", "van"])),
    max_ride_minutes: optionalNullable(z.number().int().min(5).max(180)),
    needs_weather_check: optionalNullable(z.boolean()),
    needs_open_now: optionalNullable(z.boolean()),
    meal_preference: optionalNullable(z.string().trim().min(2).max(120)),
    constraints: optionalNullable(z.array(z.string().trim().min(1).max(120)).max(12)),
    review_days: optionalNullable(z.array(itineraryReviewDaySchema).min(1).max(7)),
  })
  .superRefine((value, context) => {
    if (value.theme === "itinerary_review" && !value.review_days) {
      context.addIssue({
        code: "custom",
        path: ["review_days"],
        message: "review_days are required for itinerary_review",
      });
    }
    const totalStops = value.review_days?.reduce((total, day) => total + day.stops.length, 0) ?? 0;
    if (totalStops > 7) {
      context.addIssue({
        code: "custom",
        path: ["review_days"],
        message: "itinerary review accepts at most seven total stops",
      });
    }
  });

export type LocalItineraryRequest = z.infer<typeof localItineraryRequestSchema>;

export type LocalItineraryResult = {
  request: Required<Pick<LocalItineraryRequest, "duration_hours" | "max_ride_minutes" | "origin">> &
    Omit<LocalItineraryRequest, "duration_hours" | "max_ride_minutes" | "origin">;
  constraints: ItineraryConstraintSummary;
  localGuide: LocalGuideSearchResult;
  plan: ItineraryPlan;
  requiredToolChecks: ItineraryRequiredToolChecks;
  caveats: readonly string[];
  review?: ItineraryReviewAnalysis;
};

export type ItineraryReviewConflict = {
  code: "tight_transfer" | "early_departure_positioning" | "transport_strain" | "missing_time";
  severity: "high" | "medium";
  message: string;
  dayLabel: string;
  stopTitles: readonly string[];
};

export type ItineraryReviewAnalysis = {
  conflicts: readonly ItineraryReviewConflict[];
  revisedAction: string;
  fallback: string;
  travelTimeBasis: "curated_estimate";
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
  localFacts?: readonly {
    required: true;
    tool: "query_local_facts";
    entityTypes: readonly ["area", "route"];
    text: string;
    limit: number;
    reason: string;
  }[];
};

export type ItineraryConstraintSummary = {
  raw: readonly string[];
  labels: readonly string[];
  withKids: boolean;
  noScooter: boolean;
  vegetarian: boolean;
  quiet: boolean;
  notSurfing: boolean;
};

const defaultOrigin = "General Luna / Cloud 9";
const defaultDurationHours = 3;
const defaultMaxRideMinutes = 30;
const generalLunaCenter = { latitude: 9.784, longitude: 126.158 };
const cloud9Center = { latitude: 9.8116, longitude: 126.1651 };
const delCarmenCenter = { latitude: 9.8692, longitude: 125.9706 };
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
  const constraints = summarizeItineraryConstraints(request);
  const localGuide =
    request.theme === "itinerary_review"
      ? emptyReviewLocalGuideResult()
      : searchSiargaoLocalGuide(localGuideQuery(request, constraints));
  const uncheckedSource = itineraryUncheckedSourceSummary(request, constraints);
  const sources = itinerarySourceSummaries(request, localGuide.sourceSummary, uncheckedSource);
  const review =
    request.theme === "itinerary_review" ? analyzeItineraryReview(request, constraints) : undefined;
  const plan = review
    ? buildItineraryReviewPlan(request, review, sources)
    : applyOriginGuidance(
        applyConstraintGuidance(buildPlan(request, localGuide, sources), constraints),
        request,
      );
  const requiredToolChecks = buildRequiredToolChecks(request);
  const caveats = uniqueText([
    ...plan.stops.flatMap((stop) => stop.caveats),
    ...plan.fallbackStops.flatMap((stop) => stop.caveats),
    ...(usesCuratedLocalGuideSource(request) ? localGuide.caveats : []),
    ...uncheckedSource.notChecked,
  ]);

  return {
    request,
    constraints,
    localGuide,
    plan,
    requiredToolChecks,
    caveats,
    ...(review ? { review } : {}),
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
    ...(result.review
      ? [
          `Feasibility conflicts: ${
            result.review.conflicts.length > 0
              ? result.review.conflicts.map((conflict) => conflict.message).join("; ")
              : "no deterministic conflict found"
          }.`,
          `Revised action: ${result.review.revisedAction}`,
          `Fallback: ${result.review.fallback}`,
          "Travel times are curated non-live estimates; live traffic, schedules, opening hours, reservations, and availability were not inferred.",
        ]
      : []),
    ...renderRequiredToolChecksText(result.requiredToolChecks),
  ].join("\n");
}

function renderRequiredToolChecksText(requiredToolChecks: ItineraryRequiredToolChecks) {
  const lines: string[] = [];
  if (requiredToolChecks.weather) {
    lines.push(
      `Required weather check: call ${requiredToolChecks.weather.tool} for ${requiredToolChecks.weather.location} (${requiredToolChecks.weather.date_range}) because ${requiredToolChecks.weather.reason}.`,
    );
  }
  for (const localFactsCheck of requiredToolChecks.localFacts ?? []) {
    lines.push(
      `Required local facts check: call ${localFactsCheck.tool} for "${localFactsCheck.text}" before dependent place enrichment because ${localFactsCheck.reason}.`,
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

function localGuideQuery(
  request: LocalItineraryResult["request"],
  constraints: ItineraryConstraintSummary,
) {
  const transportMode = request.transport_mode ?? (constraints.noScooter ? "walk" : undefined);
  const originArea = localGuideOriginAreaForRequest(request);
  switch (request.theme) {
    case "rainy_cloud_9_afternoon":
      return {
        query: "rainy Cloud 9 afternoon short ride fallback",
        filters: {
          rainFit: true,
          originArea,
          maxRideMinutes: Math.min(request.max_ride_minutes, 30),
          transportMode,
          withKids: constraints.withKids,
        },
      };
    case "sunset_plus_dinner":
      return {
        query: "sunset late-afternoon beach stop near General Luna",
        filters: {
          sunset: true,
          originArea,
          maxRideMinutes: Math.min(request.max_ride_minutes, 30),
          transportMode,
          withKids: constraints.withKids,
        },
      };
    case "sandy_beach_half_day":
      return {
        query: "sandy beach half day close to General Luna",
        filters: {
          beachSurface: "sand" as const,
          originArea,
          swimming: true,
          maxRideMinutes: Math.min(request.max_ride_minutes, 30),
          transportMode,
          withKids: constraints.withKids,
        },
      };
    case "non_surfer_half_day":
      return {
        query: "non surfer half day sandy beach walk near General Luna",
        filters: {
          beachSurface: "sand" as const,
          originArea,
          swimming: true,
          maxRideMinutes: Math.min(request.max_ride_minutes, 35),
          transportMode,
          withKids: constraints.withKids,
        },
      };
    case "food_crawl":
      return {
        query: "General Luna food crawl short route",
        filters: {
          maxRideMinutes: Math.min(request.max_ride_minutes, 30),
          transportMode,
          withKids: constraints.withKids,
        },
      };
    case "itinerary_review":
      return { query: "itinerary review", filters: {} };
  }
}

function localGuideOriginAreaForRequest(request: LocalItineraryResult["request"]) {
  if (/\bcloud\s*9|catangnan\b/i.test(request.origin)) {
    return "Cloud 9";
  }
  if (/\bgeneral\s+luna\b/i.test(request.origin)) {
    return "General Luna";
  }
  if (/\bmalinao\b/i.test(request.origin)) {
    return "Malinao";
  }
  if (/\bpacifico\b/i.test(request.origin)) {
    return "Pacifico";
  }
  if (/\balegria\b/i.test(request.origin)) {
    return "Alegria";
  }
  return undefined;
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
    case "itinerary_review":
      throw new Error("itinerary_review is built by the focused review analyzer");
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
        caveats: ["Keep this stop short if rain builds."],
      },
      {
        title: "Covered cafe near Cloud 9",
        kind: "meal",
        sequence: 2,
        area: "Cloud 9 / Catangnan",
        travelTimeFromPreviousMinutes: 5,
        rationale: "Gives the plan a practical rain fallback without a long ride.",
        caveats: [],
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
            caveats: ["Keep this as a short stop if the sky looks unsettled."],
          },
      {
        title: dinnerTitle(request),
        kind: "meal",
        sequence: 2,
        area: placeAreaForRequest(request).label,
        travelTimeFromPreviousMinutes: 10,
        rationale: "Keeps dinner close after dark and lets Places choose live options later.",
        caveats: [],
      },
    ],
    fallbackStops: [
      {
        title: `Cafe or casual dinner in ${placeAreaForRequest(request).label}`,
        kind: "meal",
        sequence: 1,
        area: placeAreaForRequest(request).label,
        rationale: "Use this if sunset weather is poor or the first dinner search fails.",
        caveats: [],
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
        caveats: [],
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
        caveats: [],
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
        caveats: [],
      },
    ],
    skip: ["Surf-only lessons or reef entries", "Cloud 9 as the main swimming beach"],
    sources,
  };
}

function foodCrawlPlan(
  request: LocalItineraryResult["request"],
  sources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  const constraints = summarizeItineraryConstraints(request);
  const mealPreference =
    request.meal_preference ??
    (constraints.vegetarian ? "vegetarian-friendly food" : "casual local food");
  const placeArea = placeAreaForRequest(request);
  return {
    title: `${placeArea.label} Food Crawl`,
    durationLabel: durationLabel(request.duration_hours),
    stops: [
      {
        title: `First ${mealPreference} stop in ${placeArea.label}`,
        kind: "meal",
        sequence: 1,
        area: placeArea.label,
        rationale: "Start central so live Places searches can keep the crawl compact.",
        caveats: [],
      },
      {
        title: `Second stop near ${placeArea.label}`,
        kind: "meal",
        sequence: 2,
        area: placeArea.label,
        travelTimeFromPreviousMinutes: 10,
        rationale: "Keeps rides short while giving the AI room to pick a different food type.",
        caveats: [],
      },
      {
        title: "Dessert, coffee, or drinks stop",
        kind: "meal",
        sequence: 3,
        area: placeArea.label,
        travelTimeFromPreviousMinutes: 10,
        rationale: "Ends near the main accommodation and tricycle area.",
        caveats: [],
      },
    ],
    fallbackStops: [
      {
        title: `One reliable central ${placeArea.label} venue`,
        kind: "meal",
        sequence: 1,
        area: placeArea.label,
        rationale: "Use this if live Places checks return too few crawl stops.",
        caveats: [],
      },
    ],
    skip: [
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
    ...(request.theme === "itinerary_review"
      ? { localFacts: localFactChecksForReview(request) }
      : {}),
  };
}

function requiresWeatherCheck(request: LocalItineraryResult["request"]) {
  return (
    request.needs_weather_check === true ||
    (request.theme === "itinerary_review" &&
      request.review_days?.some((day) =>
        day.stops.some((stop) => stop.weather_sensitive === true),
      )) ||
    request.theme === "rainy_cloud_9_afternoon" ||
    request.theme === "sunset_plus_dinner"
  );
}

function weatherLocationForRequest(
  request: LocalItineraryResult["request"],
): NonNullable<ItineraryRequiredToolChecks["weather"]>["location"] {
  if (/\bdel\s+carmen\b/i.test(request.origin)) {
    return "Del Carmen";
  }
  if (/\bgeneral\s+luna\b/i.test(request.origin)) {
    return "General Luna";
  }
  if (/\bcloud\s*9|catangnan\b/i.test(request.origin)) {
    return "Cloud 9";
  }
  return "General Luna";
}

function placeAreaForRequest(request: LocalItineraryResult["request"]) {
  if (/\bdel\s+carmen\b/i.test(request.origin)) {
    return {
      label: "Del Carmen",
      queryArea: "Del Carmen Siargao",
      center: delCarmenCenter,
    };
  }
  if (/\bgeneral\s+luna\b/i.test(request.origin)) {
    return {
      label: "General Luna",
      queryArea: "General Luna Siargao",
      center: generalLunaCenter,
    };
  }
  if (/\bcloud\s*9|catangnan\b/i.test(request.origin)) {
    return {
      label: "Cloud 9 / Catangnan",
      queryArea: "Cloud 9 Siargao",
      center: cloud9Center,
    };
  }
  return { label: "General Luna", queryArea: "General Luna Siargao", center: generalLunaCenter };
}

function applyOriginGuidance(
  plan: ItineraryPlan,
  request: LocalItineraryResult["request"],
): ItineraryPlan {
  if (request.theme === "food_crawl" || isRouteAwareOriginSupported(request.origin)) {
    return plan;
  }

  return {
    ...plan,
    stops: plan.stops.map(originCaveatedStop),
    fallbackStops: plan.fallbackStops.map(originCaveatedStop),
  };
}

function originCaveatedStop(stop: ItineraryStop): ItineraryStop {
  return {
    ...stop,
    travelTimeFromPreviousMinutes: undefined,
  };
}

function isRouteAwareOriginSupported(origin: string) {
  return /\bgeneral\s+luna\b|\bcloud\s*9\b|\bcatangnan\b/i.test(origin);
}

function weatherCheckForRequest(
  request: LocalItineraryResult["request"],
): NonNullable<ItineraryRequiredToolChecks["weather"]> {
  const location =
    request.theme === "rainy_cloud_9_afternoon" ? "Cloud 9" : weatherLocationForRequest(request);
  return {
    required: true,
    tool: "get_weather_forecast",
    location,
    date_range: request.theme === "itinerary_review" ? "next_7_days" : "today",
    reason:
      request.theme === "rainy_cloud_9_afternoon"
        ? "rain materially changes the sequence and fallback choice"
        : request.theme === "itinerary_review"
          ? "weather materially affects one or more outdoor stops in the reviewed sequence"
          : "cloud cover and rain materially affect the outdoor itinerary window",
  };
}

function placesChecksForRequest(
  request: LocalItineraryResult["request"],
): ItineraryRequiredToolChecks["places"] {
  const placeArea = placeAreaForRequest(request);
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
          center: placeArea.center,
          includedType: "restaurant",
          query: `${request.meal_preference ?? "dinner restaurants"} ${placeArea.queryArea}`,
          radiusMeters: 4_000,
          reason: "the dinner stop needs live venue identity, map links, and open-now status",
        }),
      ];
    case "food_crawl":
      return [
        placesCheck({
          center: placeArea.center,
          includedType: "restaurant",
          query: `${request.meal_preference ?? "restaurants"} ${placeArea.queryArea}`,
          radiusMeters: 4_000,
          reason: "the first food-crawl stop needs live venue choices",
        }),
        placesCheck({
          center: placeArea.center,
          includedType: "cafe",
          query: `cafes or dessert near ${placeArea.queryArea}`,
          radiusMeters: 4_000,
          reason: "the later crawl stop needs live cafe or dessert options",
        }),
      ];
    case "sandy_beach_half_day":
    case "non_surfer_half_day":
      return request.needs_open_now
        ? [
            placesCheck({
              center: placeArea.center,
              includedType: "cafe",
              query: `cafes near ${placeArea.queryArea}`,
              radiusMeters: 4_000,
              reason: "the optional cafe or snack stop needs live identity and hours",
            }),
          ]
        : [];
    case "itinerary_review": {
      if (!request.needs_open_now) {
        return [];
      }
      const checks: ItineraryRequiredToolChecks["places"][number][] = [];
      for (const day of request.review_days ?? []) {
        for (const stop of day.stops) {
          if (stop.kind !== "meal" && stop.kind !== "place") {
            continue;
          }
          const area = reviewAreaCenter(stop.area);
          checks.push(
            placesCheck({
              center: area.center,
              includedType: stop.kind === "meal" ? "restaurant" : "tourist_attraction",
              query: `${stop.title} ${stop.area} Siargao`,
              radiusMeters: area.radiusMeters,
              reason: "the reviewed stop needs current identity and opening-hour evidence",
            }),
          );
          if (checks.length === 3) {
            return checks;
          }
        }
      }
      return checks;
    }
  }
}

function localFactChecksForReview(
  request: LocalItineraryResult["request"],
): NonNullable<ItineraryRequiredToolChecks["localFacts"]> {
  const areas = uniqueText(
    (request.review_days ?? []).flatMap((day) => day.stops.map((stop) => stop.area)),
  );
  if (areas.length < 2) {
    return [];
  }
  return [
    {
      required: true,
      tool: "query_local_facts",
      entityTypes: ["area", "route"],
      text: areas.join(" to "),
      limit: 10,
      reason: "the review needs governed area and route context before downstream place checks",
    },
  ];
}

function reviewAreaCenter(area: string) {
  if (/\bpacifico\b/iu.test(area)) {
    return { center: { latitude: 9.954, longitude: 126.088 }, radiusMeters: 5_000 };
  }
  if (/\bdapa\b/iu.test(area)) {
    return { center: { latitude: 9.759, longitude: 126.052 }, radiusMeters: 5_000 };
  }
  if (/\bcloud\s*9|catangnan\b/iu.test(area)) {
    return { center: cloud9Center, radiusMeters: 4_000 };
  }
  return { center: generalLunaCenter, radiusMeters: 6_000 };
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

function emptyReviewLocalGuideResult(): LocalGuideSearchResult {
  return {
    query: "itinerary review",
    filters: {},
    candidates: [],
    excluded: [],
    caveats: [],
    sourceSummary: {
      label: "not_verified",
      sourceName: "Itinerary review local-guide boundary",
      confidence: "low",
      checked: [],
      notChecked: ["route timing", "opening hours", "availability"],
    },
  };
}

function analyzeItineraryReview(
  request: LocalItineraryResult["request"],
  constraints: ItineraryConstraintSummary,
): ItineraryReviewAnalysis {
  const days = request.review_days ?? [];
  const conflicts: ItineraryReviewConflict[] = [];

  for (const day of days) {
    if (day.stops.length > 1 && day.stops.some((stop) => !stop.time)) {
      conflicts.push({
        code: "missing_time",
        severity: "medium",
        message: `${day.day_label} has multiple stops without enough timing detail to verify the sequence.`,
        dayLabel: day.day_label,
        stopTitles: day.stops.map((stop) => stop.title),
      });
    }

    for (let index = 1; index < day.stops.length; index += 1) {
      const previous = day.stops[index - 1];
      const current = day.stops[index];
      if (!previous || !current || !previous.time || !current.time) {
        continue;
      }
      const estimate = estimatedTransferRange(previous.area, current.area);
      if (!estimate) {
        continue;
      }
      const availableMinutes =
        timeToMinutes(current.time) -
        timeToMinutes(previous.time) -
        (previous.duration_minutes ?? 60);
      if (availableMinutes < estimate.min) {
        conflicts.push({
          code: "tight_transfer",
          severity: "high",
          message: `${day.day_label} leaves ${Math.max(availableMinutes, 0)} minutes between ${previous.title} and ${current.title}, below the ${estimate.min}-${estimate.max} minute non-live transfer estimate.`,
          dayLabel: day.day_label,
          stopTitles: [previous.title, current.title],
        });
      }
    }

    const distinctAreas = uniqueText(day.stops.map((stop) => normalizedReviewArea(stop.area)));
    const hasLongNorthTransfer = day.stops.some((stop, index) => {
      const previous = day.stops[index - 1];
      return previous ? (estimatedTransferRange(previous.area, stop.area)?.min ?? 0) >= 60 : false;
    });
    if (
      (constraints.withKids || constraints.noScooter) &&
      (distinctAreas.length >= 3 || hasLongNorthTransfer)
    ) {
      conflicts.push({
        code: "transport_strain",
        severity: "medium",
        message: `${day.day_label} is transport-heavy for ${constraints.withKids ? "travel with kids" : "a no-scooter trip"}; keep one area as the day's base.`,
        dayLabel: day.day_label,
        stopTitles: day.stops.map((stop) => stop.title),
      });
    }
  }

  for (let dayIndex = 1; dayIndex < days.length; dayIndex += 1) {
    const previousDay = days[dayIndex - 1];
    const day = days[dayIndex];
    const previousStop = previousDay?.stops.at(-1);
    const firstStop = day?.stops[0];
    if (
      previousDay &&
      day &&
      previousStop &&
      firstStop?.time &&
      timeToMinutes(firstStop.time) <= 9 * 60 &&
      /\bdapa\b/iu.test(firstStop.area) &&
      /\b(?:pacifico|alegria|burgos)\b/iu.test(previousStop.area)
    ) {
      conflicts.push({
        code: "early_departure_positioning",
        severity: "high",
        message: `${day.day_label}'s early Dapa departure is a weak follow-on from ${previousStop.area}; the non-live transfer estimate does not protect against road or pickup delays.`,
        dayLabel: day.day_label,
        stopTitles: [previousStop.title, firstStop.title],
      });
    }
  }

  const earlyDepartureConflict = conflicts.find(
    (conflict) => conflict.code === "early_departure_positioning",
  );
  const tightTransferConflict = conflicts.find((conflict) => conflict.code === "tight_transfer");
  const transportConflict = conflicts.find((conflict) => conflict.code === "transport_strain");
  if (earlyDepartureConflict) {
    return {
      conflicts,
      revisedAction:
        "Move the final north-island night to General Luna or Dapa before the early ferry.",
      fallback:
        "Drop the Pacifico dinner and travel south before dark if the overnight base cannot change.",
      travelTimeBasis: "curated_estimate",
    };
  }
  if (tightTransferConflict) {
    return {
      conflicts,
      revisedAction: `Add transfer buffer or remove one of: ${tightTransferConflict.stopTitles.join(" / ")}.`,
      fallback: "Keep the fixed-time stop and drop the flexible stop if the transfer starts late.",
      travelTimeBasis: "curated_estimate",
    };
  }
  if (transportConflict) {
    return {
      conflicts,
      revisedAction:
        "Group each day around one base area and pre-arrange tricycle or van transport.",
      fallback: "Drop the farthest flexible stop if transport is not confirmed.",
      travelTimeBasis: "curated_estimate",
    };
  }
  return {
    conflicts,
    revisedAction:
      "Keep the sequence, but add explicit start times and transport buffers before committing.",
    fallback: "Drop the farthest flexible stop if a transfer or opening-time check fails.",
    travelTimeBasis: "curated_estimate",
  };
}

function buildItineraryReviewPlan(
  request: LocalItineraryResult["request"],
  review: ItineraryReviewAnalysis,
  sources: readonly AnswerSourceSummary[],
): ItineraryPlan {
  const days = request.review_days ?? [];
  let sequence = 0;
  const stops = days.flatMap((day) =>
    day.stops.map((stop, index) => {
      sequence += 1;
      const previous = day.stops[index - 1];
      const estimate = previous ? estimatedTransferRange(previous.area, stop.area) : undefined;
      return {
        title: stop.title,
        kind: stop.kind,
        sequence,
        area: stop.area,
        ...(estimate
          ? { travelTimeFromPreviousMinutes: Math.round((estimate.min + estimate.max) / 2) }
          : {}),
        rationale: `${day.day_label}${stop.time ? ` at ${stop.time}` : " with timing still needed"}.`,
        caveats: uniqueText([
          ...(estimate ? ["Transfer time is a non-live estimate, not live traffic."] : []),
          ...(stop.weather_sensitive ? ["Current weather still needs a separate check."] : []),
        ]),
      } satisfies ItineraryStop;
    }),
  );
  return {
    title: "Itinerary Feasibility Review",
    durationLabel: `${days.length} day${days.length === 1 ? "" : "s"}, ${stops.length} stops`,
    decision: {
      label: review.conflicts.some((conflict) => conflict.severity === "high")
        ? "avoid_today"
        : review.conflicts.length > 0
          ? "needs_confirmation"
          : "best_fit",
      bestAction: review.revisedAction,
    },
    stops,
    fallbackStops: [
      {
        title: review.fallback,
        kind: "transfer",
        sequence: 1,
        rationale: "Use this fallback when the main feasibility conflict cannot be resolved.",
        caveats: ["Reservations, vehicle availability, and live road conditions were not checked."],
      },
    ],
    skip: review.conflicts.map((conflict) => conflict.message),
    sources,
  };
}

function estimatedTransferRange(fromArea: string, toArea: string) {
  const from = normalizedReviewArea(fromArea);
  const to = normalizedReviewArea(toArea);
  if (from === to) {
    return undefined;
  }
  const key = [from, to].sort().join("|");
  return reviewTransferEstimates[key];
}

const reviewTransferEstimates: Record<string, { min: number; max: number }> = {
  "cloud 9|general luna": { min: 10, max: 20 },
  "cloud 9|pacifico": { min: 70, max: 95 },
  "dapa|general luna": { min: 35, max: 55 },
  "dapa|pacifico": { min: 80, max: 110 },
  "general luna|pacifico": { min: 75, max: 100 },
  "general luna|malinao": { min: 15, max: 25 },
};

function normalizedReviewArea(value: string) {
  if (/\bcloud\s*9|catangnan\b/iu.test(value)) return "cloud 9";
  if (/\bgeneral\s+luna\b|\bgl\b/iu.test(value)) return "general luna";
  if (/\bpacifico\b/iu.test(value)) return "pacifico";
  if (/\bdapa\b/iu.test(value)) return "dapa";
  if (/\bmalinao\b/iu.test(value)) return "malinao";
  return normalizeText(value);
}

function timeToMinutes(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function candidateStop(
  candidate: LocalGuideCandidate | undefined,
  sequence: number,
  options: {
    fallbackTitle?: string;
    rationale: string;
    travelTimeFromPreviousMinutes?: number;
  },
): ItineraryStop {
  if (!candidate) {
    return {
      title: options.fallbackTitle ?? "General Luna-side flexible stop",
      kind: "activity",
      sequence,
      area: "General Luna",
      rationale: options.rationale,
      caveats: [],
    };
  }

  return {
    title: candidate.name,
    kind: "beach",
    sequence,
    area: candidate.area,
    ...(options.travelTimeFromPreviousMinutes
      ? { travelTimeFromPreviousMinutes: options.travelTimeFromPreviousMinutes }
      : {}),
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${candidate.name} ${candidate.area} Siargao`,
    )}`,
    rationale: options.rationale,
    caveats: uniqueText(candidate.caveats),
  };
}

function itineraryUncheckedSourceSummary(
  request: LocalItineraryResult["request"],
  constraints: ItineraryConstraintSummary,
): AnswerSourceSummary {
  return {
    label: "not_verified",
    sourceName: "Itinerary planner unchecked live signals",
    confidence: "medium",
    checked: [],
    notChecked: uniqueText([
      ...(request.needs_weather_check ? ["weather forecast for the itinerary window"] : []),
      ...(request.needs_open_now ? ["live open-now status for meal, cafe, or venue stops"] : []),
      ...(request.theme === "itinerary_review"
        ? [
            "live traffic and exact route duration",
            "ferry or operator schedule changes",
            "reservations and vehicle availability",
          ]
        : []),
      ...constraintNotCheckedItems(constraints),
      ...siargaoGenericUnchecked,
    ]),
  };
}

function dinnerTitle(request: LocalItineraryResult["request"]) {
  const constraints = summarizeItineraryConstraints(request);
  const preference =
    request.meal_preference ?? (constraints.vegetarian ? "vegetarian-friendly" : "");
  const area = placeAreaForRequest(request).label;
  return preference ? `Dinner in ${area} matching ${preference}` : `Dinner in ${area}`;
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

function itinerarySourceSummaries(
  request: LocalItineraryResult["request"],
  localGuideSource: AnswerSourceSummary,
  uncheckedSource: AnswerSourceSummary,
) {
  return uniqueSourceSummaries([
    ...(usesCuratedLocalGuideSource(request) ? [localGuideSource] : []),
    uncheckedSource,
  ]);
}

function usesCuratedLocalGuideSource(request: LocalItineraryResult["request"]) {
  return request.theme !== "food_crawl" && request.theme !== "itinerary_review";
}

function uniqueText(values: readonly string[]) {
  return [
    ...new Set(
      values.flatMap((value) => {
        const normalizedValue = normalizeText(value);
        return normalizedValue ? [normalizedValue] : [];
      }),
    ),
  ];
}

function summarizeItineraryConstraints(
  request: Pick<LocalItineraryRequest, "constraints">,
): ItineraryConstraintSummary {
  const raw = uniqueText(request.constraints ?? []);
  const haystack = raw.join(" ");
  const withKids = /\b(with[_\s-]?kids|kids?|children|child|toddler|family|families)\b/i.test(
    haystack,
  );
  const noScooter =
    /\b(no[_\s-]?scooter|avoid\s+scooters?|without\s+(?:a\s+)?scooter|walk(?:ing)?\s+only|no\s+motorbike)\b/i.test(
      haystack,
    );
  const vegetarian = /\b(vegetarian|vegan|plant[-\s]?based|no\s+meat)\b/i.test(haystack);
  const quiet = /\b(quiet|calm|low[-\s]?key|not\s+crowded|avoid\s+crowds?|peaceful)\b/i.test(
    haystack,
  );
  const notSurfing =
    /\b(not\s+surfing|non[-\s]?surfer|avoid\s+surf|no\s+surf(?:ing)?|not\s+a\s+surfer)\b/i.test(
      haystack,
    );

  return {
    raw,
    labels: uniqueText([
      ...(withKids ? ["with kids"] : []),
      ...(noScooter ? ["avoid scooters"] : []),
      ...(vegetarian ? ["vegetarian"] : []),
      ...(quiet ? ["quiet"] : []),
      ...(notSurfing ? ["not surfing"] : []),
      ...raw,
    ]),
    withKids,
    noScooter,
    vegetarian,
    quiet,
    notSurfing,
  };
}

function applyConstraintGuidance(
  plan: ItineraryPlan,
  constraints: ItineraryConstraintSummary,
): ItineraryPlan {
  const caveats = constraintCaveats(constraints);
  const skip = constraintSkipGuidance(constraints);
  if (caveats.length === 0 && skip.length === 0) {
    return plan;
  }

  return {
    ...plan,
    stops: plan.stops.map((stop) => ({
      ...stop,
      caveats: uniqueText([...stop.caveats, ...caveats]),
    })),
    fallbackStops: plan.fallbackStops.map((stop) => ({
      ...stop,
      caveats: uniqueText([...stop.caveats, ...caveats]),
    })),
    skip: uniqueText([...plan.skip, ...skip]),
  };
}

function constraintCaveats(constraints: ItineraryConstraintSummary) {
  if (constraints.labels.length === 0) {
    return [];
  }

  return uniqueText([
    ...(constraints.withKids ? ["Keep water time shallow and supervised for kids."] : []),
    ...(constraints.noScooter
      ? ["Favor tricycle-friendly stops or places within comfortable walking distance."]
      : []),
    ...(constraints.notSurfing
      ? ["Keep the day beach-walk focused rather than surf-focused."]
      : []),
  ]);
}

function constraintSkipGuidance(constraints: ItineraryConstraintSummary) {
  return uniqueText([
    ...(constraints.withKids ? ["Deep-water swim stops for kids"] : []),
    ...(constraints.noScooter ? ["Scooter-only routing or stops that require self-driving"] : []),
    ...(constraints.vegetarian ? ["Food stops without clear vegetarian-friendly options"] : []),
    ...(constraints.quiet
      ? ["Known noisy or crowd-heavy stops when quieter options are available"]
      : []),
    ...(constraints.notSurfing ? ["Surf lessons, reef entries, or surf-only stops"] : []),
  ]);
}

function constraintNotCheckedItems(constraints: ItineraryConstraintSummary) {
  if (constraints.labels.length === 0) {
    return [];
  }

  return uniqueText([
    `live confirmation of user constraints: ${constraints.labels.join(", ")}`,
    ...(constraints.vegetarian ? ["live vegetarian menu fit"] : []),
    ...(constraints.quiet ? ["live crowd or noise levels"] : []),
    ...(constraints.noScooter ? ["live tricycle, van, or walking-route availability"] : []),
    ...(constraints.withKids ? ["kid-specific swim safety"] : []),
  ]);
}

function normalizeText(value: string) {
  return value.replaceAll(/\s+/g, " ").trim();
}

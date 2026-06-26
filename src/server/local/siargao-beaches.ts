export type SiargaoBeachSurface = "sand" | "mixed" | "rocky";

export type SiargaoBeach = {
  name: string;
  area: string;
  distanceFromGeneralLunaMinutes: { min: number; max: number };
  surface: SiargaoBeachSurface;
  swimmingFit: string;
  sunsetFit: string;
  surfFit: string;
  rainFit: string;
  tideNotes: string;
  confidence: "high" | "medium" | "low";
  sourceNotes: string;
};

export type BeachRecommendationRequest = {
  originLabel?: "Cloud 9" | "General Luna" | "Siargao Island";
  maxRideMinutes?: number;
  sandOnly?: boolean;
  avoidRocky?: boolean;
  swimming?: boolean;
  sunset?: boolean;
  transportMode?: "walk" | "scooter" | "tricycle" | "van";
  withKids?: boolean;
  durableConstraints?: string[];
};

const siargaoBeachGuide: SiargaoBeach[] = [
  {
    name: "Doot Beach",
    area: "Doot / General Luna side",
    distanceFromGeneralLunaMinutes: { min: 15, max: 25 },
    surface: "sand",
    swimmingFit: "usually one of the easier sandy options close to General Luna",
    sunsetFit: "good for a quiet late-afternoon sandy beach stop, not a guaranteed horizon sunset",
    surfFit: "not a surf pick; choose it for a quieter beach stop",
    rainFit: "reasonable for a short close ride, but avoid if roads are flooding",
    tideNotes: "entry and water depth can vary with tide",
    confidence: "medium",
    sourceNotes: "Curated local guide estimate; exact ride time depends on start point and roads.",
  },
  {
    name: "Malinao Beach",
    area: "Malinao",
    distanceFromGeneralLunaMinutes: { min: 10, max: 20 },
    surface: "sand",
    swimmingFit: "good sandy shoreline candidate when conditions are calm",
    sunsetFit: "good for a relaxed late-afternoon walk if you want to stay close to General Luna",
    surfFit: "better for a beach walk or swim than surf",
    rainFit: "close enough to keep as a flexible bad-weather fallback",
    tideNotes: "some stretches are better at mid to high tide",
    confidence: "medium",
    sourceNotes: "Curated local guide estimate for sandy stretches around Malinao.",
  },
  {
    name: "Secret Beach",
    area: "Guiwan / General Luna side",
    distanceFromGeneralLunaMinutes: { min: 15, max: 25 },
    surface: "sand",
    swimmingFit: "sandy, but swim comfort depends on surf and currents",
    sunsetFit: "fine for late-afternoon beach time, but check surf and access before staying long",
    surfFit: "often more useful for small surf or a beach stop than a calm swim",
    rainFit: "keep it for a clear break rather than active rain",
    tideNotes: "check the exact access point and conditions before swimming",
    confidence: "medium",
    sourceNotes: "Curated local guide estimate; access and conditions vary by exact entry point.",
  },
  {
    name: "Union Beach area",
    area: "Union",
    distanceFromGeneralLunaMinutes: { min: 20, max: 30 },
    surface: "mixed",
    swimmingFit: "can work for a coastal stop, but not the cleanest sand-only pick",
    sunsetFit: "possible late-afternoon coastal stop, but not ideal for a sand-only filter",
    surfFit: "varies by stretch and conditions",
    rainFit: "borderline for a rainy-day ride from General Luna",
    tideNotes: "expect some mixed entry points depending on the exact stretch",
    confidence: "low",
    sourceNotes: "Included as a broader area, not a guaranteed sand-only access point.",
  },
  {
    name: "Cloud 9 beach access",
    area: "Catangnan / Cloud 9",
    distanceFromGeneralLunaMinutes: { min: 5, max: 15 },
    surface: "rocky",
    swimmingFit: "not the best smooth-sand swimming pick; known more for surf and reef",
    sunsetFit: "good for Cloud 9 atmosphere and surf-watching, but not a sand-only beach pick",
    surfFit: "iconic surf-side stop",
    rainFit: "easy to reach, but exposed in active rain",
    tideNotes: "reef and rocks matter, especially around low tide",
    confidence: "high",
    sourceNotes: "Included to avoid treating Cloud 9 as a sand-only swimming beach.",
  },
  {
    name: "Pacifico Beach",
    area: "Pacifico / San Isidro",
    distanceFromGeneralLunaMinutes: { min: 65, max: 90 },
    surface: "sand",
    swimmingFit: "sandy in stretches, but not a strict 30-minute option from General Luna",
    sunsetFit:
      "better treated as a longer north-island beach trip, not a quick sunset hop from General Luna",
    surfFit: "better known as a north-island surf/coastal trip",
    rainFit: "not ideal during rain because of the longer ride",
    tideNotes: "conditions vary by swell and exact beach stretch",
    confidence: "medium",
    sourceNotes: "Kept in the dataset so strict 30-minute filters can explicitly exclude it.",
  },
  {
    name: "Alegria Beach",
    area: "Santa Monica / north Siargao",
    distanceFromGeneralLunaMinutes: { min: 80, max: 110 },
    surface: "sand",
    swimmingFit: "sandy and scenic, but too far for a 30-minute General Luna beach list",
    sunsetFit: "scenic, but too far for a strict 30-minute sunset plan from General Luna",
    surfFit: "not the main reason to go",
    rainFit: "not recommended as a rainy-day ride from General Luna",
    tideNotes: "still check local conditions before swimming",
    confidence: "medium",
    sourceNotes: "Kept in the dataset so strict 30-minute filters can explicitly exclude it.",
  },
];

export function renderSiargaoBeachRecommendation(request: BeachRecommendationRequest) {
  const originLabel = request.originLabel === "Cloud 9" ? "Cloud 9 / General Luna" : "General Luna";
  const maxRideMinutes = request.maxRideMinutes ?? 30;
  const sandFiltered = Boolean(request.sandOnly || request.avoidRocky);
  const candidates = siargaoBeachGuide
    .filter(
      (beach) =>
        beach.distanceFromGeneralLunaMinutes.max <= maxRideMinutes &&
        (sandFiltered ? beach.surface === "sand" : beach.surface !== "rocky"),
    )
    .sort(
      (left, right) =>
        left.distanceFromGeneralLunaMinutes.max - right.distanceFromGeneralLunaMinutes.max ||
        left.name.localeCompare(right.name),
    );

  const header = beachRecommendationHeader({ maxRideMinutes, originLabel, request, sandFiltered });
  const ranked = candidates.slice(0, 5).map((beach, index) => {
    const bestFor = beachBestUse(beach, request);
    return `${index + 1}. **${beach.name}** - ${rideTimeLabel(
      beach,
    )}; ${beach.surface} beach; ${bestFor}.`;
  });
  const sunsetNote = request.sunset
    ? [
        "",
        "For a classic Cloud 9 sunset vibe, the boardwalk is still an easy option, but it does not match your sand-only beach filter.",
      ]
    : [];
  const tripContextNotes = beachTripContextNotes(request);
  const exclusions =
    maxRideMinutes <= 30
      ? [
          "",
          "I would not include Pacifico or Alegria in a strict 30-minute list from General Luna; they are usually longer north-island rides.",
        ]
      : [];

  return [
    header,
    "",
    ...ranked,
    ...sunsetNote,
    ...exclusions,
    ...tripContextNotes,
    "",
    "Checked: Ask Siargao curated local beach guide with ride-time and beach-surface notes.",
    "Not checked: live road conditions, tide, currents, beach access changes, or lifeguard/swimming safety.",
  ].join("\n");
}

function beachTripContextNotes(request: BeachRecommendationRequest) {
  const notes: string[] = [];
  if (request.withKids) {
    notes.push("travelling with kids");
  }
  if (request.transportMode === "walk" || request.durableConstraints?.includes("no_scooter")) {
    notes.push("no scooter / walking constraint");
  }
  if (notes.length === 0) {
    return [];
  }
  return ["", `Trip fit notes: ${notes.join("; ")}.`];
}

function beachRecommendationHeader({
  maxRideMinutes,
  originLabel,
  request,
  sandFiltered,
}: {
  maxRideMinutes: number;
  originLabel: string;
  request: BeachRecommendationRequest;
  sandFiltered: boolean;
}) {
  if (request.sunset && sandFiltered) {
    return `For sunset with your sandy, not-rocky filter within about ${maxRideMinutes} minutes of ${originLabel}, I would treat these as late-afternoon beach options:`;
  }
  if (request.sunset) {
    return `For sunset or late-afternoon beach time within about ${maxRideMinutes} minutes of ${originLabel}, I would shortlist:`;
  }
  if (request.swimming && sandFiltered) {
    return `For swimming with your sandy, not-rocky filter within about ${maxRideMinutes} minutes of ${originLabel}, I would shortlist:`;
  }
  if (sandFiltered) {
    return `For sandy, not-rocky beach options within about ${maxRideMinutes} minutes of ${originLabel}, I would shortlist:`;
  }
  return `From ${originLabel}, these beach options fit about a ${maxRideMinutes}-minute ride:`;
}

function beachBestUse(beach: SiargaoBeach, request: BeachRecommendationRequest) {
  if (request.sunset) {
    return beach.sunsetFit;
  }
  if (request.swimming) {
    return beach.swimmingFit;
  }
  if (beach.name === "Doot Beach") {
    return "best for the easiest close sandy beach stop";
  }
  if (beach.name === "Malinao Beach") {
    return "best for a close sandy shoreline and easy fallback ride";
  }
  if (beach.name === "Secret Beach") {
    return "best for a sandy beach stop when surf and currents look comfortable";
  }
  return beach.swimmingFit;
}

function rideTimeLabel(beach: SiargaoBeach) {
  return `about ${beach.distanceFromGeneralLunaMinutes.min}-${beach.distanceFromGeneralLunaMinutes.max} min from General Luna`;
}

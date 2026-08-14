import type {
  GuideContentItem,
  GuideFaq,
  GuideMapStop,
  GuideRealityCheck,
  GuideSource,
  GuideTravelTime,
  PlanningGuide,
} from "@/server/guides/planning-guide-types";

export type {
  GuideRealityCheck,
  PlanningGuide,
} from "@/server/guides/planning-guide-types";

const author = {
  name: "Ask Siargao Editorial Desk",
  role: "Planning research and guide writing",
} as const;
const reviewer = {
  name: "Ask Siargao Local Knowledge Review",
  role: "Local planning, caveat, and safety review",
} as const;

const officialTourismSource: GuideSource = {
  name: "Siargao Island destination guide",
  publisher: "Philippine Department of Tourism · Love the Philippines",
  url: "https://philippines.travel/destinations/siargao-island/index",
  usedFor: "Island orientation, signature stops, and official arrival overview.",
};
const pagasaClimateSource: GuideSource = {
  name: "Climate of the Philippines",
  publisher: "DOST–PAGASA",
  url: "https://www.pagasa.dost.gov.ph/information/climate-philippines",
  usedFor: "National seasonal context and the limits of month-level weather promises.",
};
const pagasaSurigaoNormalsSource: GuideSource = {
  name: "Surigao climatological normals (1991–2020)",
  publisher: "DOST–PAGASA",
  url: "https://pubfiles.pagasa.dost.gov.ph/pagasaweb/files/cad/CLIMATOLOGICAL%20NORMALS%20%281991-2020%29/SURIGAO.pdf",
  usedFor:
    "Nearest official long-period monthly rainfall baseline; the station is in Surigao City, not on Siargao.",
};
const pagasaCycloneSource: GuideSource = {
  name: "Tropical Cyclone Information",
  publisher: "DOST–PAGASA",
  url: "https://www.pagasa.dost.gov.ph/climate/tropical-cyclone-information",
  usedFor: "National cyclone-season context and disruption caveats.",
};
const openStreetMapSource: GuideSource = {
  name: "Siargao map",
  publisher: "OpenStreetMap contributors",
  url: "https://www.openstreetmap.org/#map=11/9.8565/126.0498",
  usedFor: "Area relationships and route orientation; travel times remain planning estimates.",
};

const southTravelTimes: readonly GuideTravelTime[] = [
  {
    from: "Sayak Airport",
    to: "General Luna",
    estimate: "45–60 min",
    planFor: "Shared vans may wait for passengers; rain and stops can stretch the transfer.",
  },
  {
    from: "Dapa Port",
    to: "General Luna",
    estimate: "30–45 min",
    planFor: "Allow extra time to disembark, collect bags, and find the arranged driver.",
  },
  {
    from: "Central General Luna",
    to: "Cloud 9",
    estimate: "10–20 min",
    planFor: "Tourism Road traffic and exact pickup position matter more than map distance.",
  },
] as const;

const islandTravelTimes: readonly GuideTravelTime[] = [
  ...southTravelTimes,
  {
    from: "General Luna",
    to: "Del Carmen",
    estimate: "60–90 min",
    planFor: "Use the upper end when meeting a boat or traveling in poor weather.",
  },
  {
    from: "General Luna",
    to: "Pacifico",
    estimate: "60–90 min",
    planFor: "Do not combine a north-island return with a tightly timed flight or ferry.",
  },
] as const;

const islandMapStops: readonly GuideMapStop[] = [
  { label: "Pacifico", position: "north", note: "North-island base and surf area" },
  { label: "Del Carmen", position: "west", note: "Common jump-off area for Sugba Lagoon" },
  { label: "Sayak Airport", position: "center", note: "Main air arrival point" },
  { label: "Cloud 9", position: "east", note: "Surf landmark east of central General Luna" },
  { label: "General Luna", position: "south", note: "Main visitor base" },
  { label: "Dapa Port", position: "south", note: "Main ferry arrival point" },
] as const;

const sharedRealityChecks: readonly GuideRealityCheck[] = [
  {
    analyticsKey: "weather",
    label: "Adapt this plan to today’s weather",
    prompt:
      "Adapt this guide to today’s weather and tell me what to keep, change, or confirm locally.",
  },
  {
    analyticsKey: "no_scooter",
    label: "Check whether it works without a scooter",
    prompt:
      "Reality-check this plan for a traveler who will not ride a scooter. Include transfer fallbacks.",
  },
  {
    analyticsKey: "hotel_location",
    label: "Reality-check my hotel location",
    prompt:
      "Reality-check my Siargao hotel location against this guide, realistic transfers, and quiet sleep.",
  },
  {
    analyticsKey: "activity_replacement",
    label: "Replace an activity if conditions change",
    prompt:
      "Give me one practical replacement if the main outdoor activity in this guide does not work today.",
  },
] as const;

const sharedFaqs: readonly GuideFaq[] = [
  {
    question: "Do I need a scooter for this plan?",
    answer:
      "No, but you should cluster activities by area and arrange longer transfers ahead. Tricycles and vans can cover many trips; availability, price, and pickup reliability still need current confirmation.",
  },
  {
    question: "Can I lock the itinerary before I arrive?",
    answer:
      "Lock accommodation and essential transfers, then keep at least one outdoor day movable. Weather, sea state, tide timing, and operator schedules can make a good sequence wrong on a specific day.",
  },
  {
    question: "Are these travel times guaranteed?",
    answer:
      "No. They are conservative planning ranges, not live route estimates. Add margin for rain, road works, shared-van stops, boat assembly, and airport or port queues.",
  },
] as const;

const commonLimitations = [
  "This guide does not confirm live weather, sea state, tide windows, operator schedules, prices, closures, or availability.",
  "Travel-time ranges are planning estimates. Confirm the pickup point and same-day conditions before a timed connection.",
] as const;

function item(title: string, body: string, note?: string): GuideContentItem {
  return { title, body, ...(note ? { note } : {}) };
}

function guide(
  input: Omit<PlanningGuide, "author" | "reviewer" | "sources" | "limitations" | "faqs"> & {
    sources?: readonly GuideSource[];
    limitations?: readonly string[];
    faqs?: readonly GuideFaq[];
  },
): PlanningGuide {
  return {
    ...input,
    author,
    reviewer,
    sources: input.sources ?? [officialTourismSource, pagasaClimateSource, openStreetMapSource],
    limitations: input.limitations ?? commonLimitations,
    faqs: input.faqs ?? sharedFaqs,
  };
}

export const planningGuides: readonly PlanningGuide[] = [
  guide({
    slug: "complete-siargao-travel-guide",
    lastChecked: "2026-08-14",
    title: "Complete Siargao Travel Guide",
    shortTitle: "Complete travel guide",
    description:
      "Plan where to stay, how long to allow, how to move around, and which Siargao days must stay flexible.",
    quickRecommendation:
      "For a first visit, allow five full days, use General Luna or nearby Cloud 9 as the practical base, schedule only one distant or boat-dependent anchor per day, and keep one movable day for weather, tide, or transport changes.",
    image: {
      src: "/images/guides/complete-siargao-guide.webp",
      alt: "A palm-lined coastal road running through Siargao",
      caption:
        "Original Ask Siargao editorial image · route planning starts with distance, not pins.",
    },
    readingMinutes: 11,
    sections: [
      {
        id: "shape-the-trip",
        title: "Shape the trip before filling the days",
        introduction:
          "The island rewards a simple route more than a long checklist. Decide duration, base, and transport before choosing tours.",
        items: [
          item(
            "Choose five days when you can",
            "Three days can cover one boat or lagoon day plus the south. Five days gives the trip one recovery or weather-swap day; seven supports a slower north-and-south split.",
          ),
          item(
            "Use one base unless the north is a priority",
            "Moving accommodation consumes checkout, transfer, and check-in time. Split the stay only when Pacifico or repeated north-island mornings are central to the trip.",
          ),
          item(
            "Solve transport before booking remote stays",
            "A beautiful location can become a daily transfer problem without a scooter. Ask the property about exact pickup access, evening options, and backup drivers.",
          ),
        ],
      },
      {
        id: "build-the-days",
        title: "Build condition-aware days",
        introduction:
          "Group activities by dependency so a single weather change does not collapse the whole itinerary.",
        items: [
          item(
            "Boat-dependent",
            "Tri-island hopping and Sugba Lagoon need suitable sea conditions, a confirmed operator, and enough transfer margin.",
            "Keep these days movable until the short-range forecast and operator check agree.",
          ),
          item(
            "Tide-dependent",
            "Magpupungko is not a generic beach stop: the rock-pool experience depends on the usable tide window and local access status.",
          ),
          item(
            "Flexible land days",
            "Cafés, a slow General Luna day, viewpoints, and short area visits are useful fallbacks, but heavy rain can still affect roads and comfort.",
          ),
        ],
      },
      {
        id: "arrival-and-departure",
        title: "Protect the edges of the trip",
        introduction:
          "Arrival and departure days are transfer days first. Treat any activity that fits around them as a bonus.",
        items: [
          item(
            "Confirm the first ride",
            "Send the flight or ferry detail, passenger count, and lodging pin to the driver or property before travel.",
          ),
          item(
            "Do not put the north before a flight",
            "A Pacifico or Del Carmen return has too many moving parts for a tight airport connection. Sleep in the south before an early departure.",
          ),
          item(
            "Carry a late-arrival fallback",
            "Keep the lodging phone number, driver contact, and a screenshot of the address available offline.",
          ),
        ],
      },
    ],
    comparison: {
      title: "Choose the trip length",
      introduction: "The right duration is the shortest one that still leaves a real fallback.",
      columns: ["Length", "Works for", "Main tradeoff"],
      rows: [
        [
          "3 days",
          "One signature excursion and a compact south-island day",
          "Almost no recovery room",
        ],
        [
          "5 days",
          "A balanced first visit with one flexible day",
          "Still requires grouped transfers",
        ],
        [
          "7 days",
          "North-and-south depth, surf lessons, or remote-work pace",
          "More accommodation and transport cost",
        ],
      ],
    },
    travelTimes: islandTravelTimes,
    mapStops: islandMapStops,
    realityChecks: sharedRealityChecks,
    relatedSlugs: [
      "siargao-first-timer-guide",
      "siargao-5-day-itinerary",
      "best-time-to-visit-siargao",
    ],
  }),
  guide({
    slug: "siargao-first-timer-guide",
    lastChecked: "2026-08-14",
    title: "Siargao First-Timer Guide",
    shortTitle: "First-timer guide",
    description:
      "A calm first-visit plan covering the best base, transfers, money, connectivity, and what not to overbook.",
    quickRecommendation:
      "Make the first trip easy: stay near the services you will actually use, pre-arrange the airport or port transfer, carry cash and offline details, and book no more than one condition-sensitive activity for each full day.",
    image: {
      src: "/images/guides/siargao-first-timer-guide.webp",
      alt: "A quiet Siargao road junction with a local tricycle",
      caption:
        "Original Ask Siargao editorial image · the first useful choice is usually the base.",
    },
    readingMinutes: 9,
    sections: [
      {
        id: "before-booking",
        title: "Before booking",
        introduction: "Remove the avoidable friction before adding activities.",
        items: [
          item(
            "Default to General Luna for convenience",
            "It is the easiest first base for food, visitor services, and common pickups. Choose Cloud 9 for surf proximity or a quieter edge only after checking transport and nighttime noise block by block.",
          ),
          item(
            "Ask the property practical questions",
            "Request the exact map pin, road access, backup power, current internet setup, late check-in process, and realistic transport options without a scooter.",
          ),
          item(
            "Keep critical details offline",
            "Save the accommodation pin, contact number, transfer name, and onward booking where they remain available without mobile data.",
          ),
        ],
      },
      {
        id: "arrival-day",
        title: "Arrival day",
        introduction: "Plan to land, transfer, eat, and orient. Anything else is optional.",
        items: [
          item(
            "Meet the arranged driver",
            "Confirm the pickup name and vehicle before departure. If the flight or ferry moves, message the driver before boarding when possible.",
          ),
          item(
            "Settle money and connectivity",
            "Keep more than one payment method. Cash access and signal can vary, so do not wait until a remote day to solve either.",
          ),
          item(
            "Walk the immediate area",
            "Find breakfast, drinking water, a pharmacy or clinic route, and the safest practical pickup point near the stay.",
          ),
        ],
      },
      {
        id: "first-visit-rhythm",
        title: "A first-visit rhythm that works",
        introduction: "Alternate higher-dependency days with simple local ones.",
        items: [
          item(
            "Day near the base",
            "Use Cloud 9, a surf lesson, or a General Luna day to learn the transport rhythm.",
          ),
          item(
            "One boat or lagoon day",
            "Choose the trip that best fits current sea and weather conditions rather than stacking both.",
          ),
          item(
            "One north-island day",
            "Pair only stops that share the route and return before a tightly timed evening commitment.",
          ),
        ],
      },
    ],
    comparison: {
      title: "Choose a first base",
      introduction: "There is no universal best area; use the tradeoff that affects every day.",
      columns: ["Base", "Best for", "Watch for"],
      rows: [
        [
          "General Luna",
          "Food choice, common pickups, no-scooter convenience",
          "Night noise varies by street",
        ],
        ["Cloud 9 area", "Surf access and early starts", "More rides for central dining"],
        ["Pacifico", "North-island pace and repeated surf mornings", "Long south-island transfers"],
      ],
    },
    travelTimes: islandTravelTimes,
    mapStops: islandMapStops,
    realityChecks: sharedRealityChecks,
    relatedSlugs: ["complete-siargao-travel-guide", "siargao-5-day-itinerary", "siargao-by-month"],
  }),
  guide({
    slug: "siargao-3-day-itinerary",
    lastChecked: "2026-08-14",
    title: "3-Day Siargao Itinerary",
    shortTitle: "3-day itinerary",
    description:
      "A compact Siargao itinerary that protects arrival time and chooses one major excursion instead of racing the island.",
    quickRecommendation:
      "Use one south-island base and choose either tri-island hopping, Sugba Lagoon, or a north-and-tide day as the single major excursion. Three days is too short for all three once transfers and weather risk are counted.",
    image: {
      src: "/images/guides/siargao-3-day-itinerary.webp",
      alt: "A small banca boat waiting on a calm Siargao shore at sunrise",
      caption: "Original Ask Siargao editorial image · one good excursion beats three rushed ones.",
    },
    readingMinutes: 7,
    sections: [
      {
        id: "day-one",
        title: "Day 1 · Arrive and learn the south",
        introduction: "Keep the first day close to the accommodation.",
        items: [
          item(
            "Transfer and check in",
            "Use the realistic arrival range below and do not prepay a timed activity against it.",
          ),
          item(
            "Cloud 9 or a local walk",
            "Choose one nearby orientation stop if daylight and energy remain.",
          ),
          item(
            "Confirm Day 2",
            "Check pickup, weather, sea or tide dependency, payment, and cancellation terms with the operator.",
          ),
        ],
      },
      {
        id: "day-two",
        title: "Day 2 · Choose one signature day",
        introduction: "Make one high-dependency day the center of the trip.",
        items: [
          item(
            "Tri-island option",
            "Best when the boat plan and sea conditions are suitable and you want a water-led day near the south.",
          ),
          item(
            "Sugba Lagoon option",
            "Best when Del Carmen transfers and boat timing are confirmed and the longer overland start is acceptable.",
          ),
          item(
            "North-and-tide option",
            "Best when the usable Magpupungko tide window fits a practical northbound route.",
          ),
        ],
      },
      {
        id: "day-three",
        title: "Day 3 · Flexible finish and departure",
        introduction: "Protect the onward connection; do not rescue every missed item.",
        items: [
          item(
            "Use the morning locally",
            "Fit breakfast, a short surf lesson, or a nearby walk only if checkout and transfer timing stay comfortable.",
          ),
          item(
            "Move an activity only when it truly fits",
            "A cancelled full-day boat trip does not belong before an afternoon flight.",
          ),
          item(
            "Leave with a buffer",
            "Use the accommodation or driver’s current recommendation for departure time, then add margin rather than subtracting it.",
          ),
        ],
      },
    ],
    comparison: {
      title: "Pick the middle day",
      introduction: "Choose by dependency and transfer load, not by the longest attraction list.",
      columns: ["Option", "Choose it when", "Skip it when"],
      rows: [
        [
          "Tri-island",
          "Sea conditions and a south pickup work",
          "Boat conditions or recovery time do not",
        ],
        [
          "Sugba Lagoon",
          "A long Del Carmen day is the priority",
          "You have a tight evening or hate long transfers",
        ],
        [
          "North + tide",
          "The tide window anchors a feasible route",
          "The tide forces a rushed departure or return",
        ],
      ],
    },
    travelTimes: islandTravelTimes,
    mapStops: islandMapStops,
    realityChecks: sharedRealityChecks,
    relatedSlugs: ["siargao-5-day-itinerary", "siargao-first-timer-guide", "siargao-by-month"],
  }),
  guide({
    slug: "siargao-5-day-itinerary",
    lastChecked: "2026-08-14",
    title: "5-Day Siargao Itinerary",
    shortTitle: "5-day itinerary",
    description:
      "A balanced five-day Siargao plan with a south day, one boat day, one north day, and a weather buffer.",
    quickRecommendation:
      "Five days is the strongest first-trip default: use Day 1 to settle, keep Days 2–4 interchangeable for a south day, one suitable boat or lagoon day, and one north-island day, then protect Day 5 for recovery or departure.",
    image: {
      src: "/images/guides/siargao-5-day-itinerary.webp",
      alt: "Surfboards beside a palm-lined road and the Siargao coast",
      caption:
        "Original Ask Siargao editorial image · a five-day plan has room for more than one pace.",
    },
    readingMinutes: 9,
    sections: [
      {
        id: "days-one-two",
        title: "Days 1–2 · Settle and use the south",
        introduction: "Start with the area that has the fewest moving parts.",
        items: [
          item(
            "Day 1 · Arrival",
            "Transfer, check in, orient, and confirm only the next high-dependency day.",
          ),
          item(
            "Day 2 · South and Cloud 9",
            "Use a surf lesson, viewpoint, local beach time, or General Luna stops according to ability and conditions.",
          ),
          item(
            "Keep the evening light",
            "Do not place a late night before the earliest boat or northbound pickup.",
          ),
        ],
      },
      {
        id: "days-three-four",
        title: "Days 3–4 · Move the two anchor days",
        introduction:
          "Swap these days when weather, tide, or operator advice makes the planned order weak.",
        items: [
          item(
            "One water-led day",
            "Choose tri-island hopping or Sugba Lagoon; doing both is optional, not a first-trip requirement.",
          ),
          item(
            "One north-and-tide day",
            "Route Pacifico and Magpupungko only when the tide window and road plan align.",
          ),
          item(
            "Use a land fallback",
            "If boats pause, keep the traveler in one area rather than replacing the cancellation with another long uncertain transfer.",
          ),
        ],
      },
      {
        id: "day-five",
        title: "Day 5 · Buffer, repeat, or depart",
        introduction: "The last day absorbs what the island changed.",
        items: [
          item(
            "Repeat what worked",
            "A second surf lesson or slow local morning often adds more than a rushed new attraction.",
          ),
          item(
            "Use the buffer honestly",
            "If an anchor day moved here, remove the original Day 5 plan rather than stacking both.",
          ),
          item(
            "Protect departure",
            "Keep remote and boat-dependent activities off a timed departure day.",
          ),
        ],
      },
    ],
    comparison: {
      title: "How to use the flexible day",
      introduction: "Decide the buffer’s job only after the short-range conditions are visible.",
      columns: ["Use", "Good choice when", "Tradeoff"],
      rows: [
        ["Weather swap", "A signature day moved", "The local rest day disappears"],
        ["Recovery", "The group is tired or sun-exposed", "One fewer headline stop"],
        [
          "Second lesson",
          "Surf progression matters",
          "Requires another condition and safety check",
        ],
      ],
    },
    travelTimes: islandTravelTimes,
    mapStops: islandMapStops,
    realityChecks: sharedRealityChecks,
    relatedSlugs: [
      "siargao-3-day-itinerary",
      "siargao-7-day-itinerary",
      "best-time-to-visit-siargao",
    ],
  }),
  guide({
    slug: "siargao-7-day-itinerary",
    lastChecked: "2026-08-14",
    title: "7-Day Siargao Itinerary",
    shortTitle: "7-day itinerary",
    description:
      "A slower week in Siargao with two flexible days, deeper north-island time, and space for repeat surf or rest.",
    quickRecommendation:
      "Use seven days to reduce pressure, not to double the checklist. Keep one south base unless repeated north-island mornings justify a split, protect two movable windows, and repeat the experiences that depend on learning or good conditions.",
    image: {
      src: "/images/guides/siargao-7-day-itinerary.webp",
      alt: "A long coastal road through Siargao beneath mixed sun and cloud",
      caption:
        "Original Ask Siargao editorial image · a week makes room for the island to change the route.",
    },
    readingMinutes: 10,
    sections: [
      {
        id: "days-one-three",
        title: "Days 1–3 · Establish a rhythm",
        introduction: "Stay close first, then add one condition-sensitive day.",
        items: [
          item("Day 1 · Arrival", "Transfer, settle, and confirm the next day only."),
          item(
            "Day 2 · South-island orientation",
            "Use Cloud 9, a suitable lesson, local food stops, and short transfers.",
          ),
          item(
            "Day 3 · First water day",
            "Choose the best-supported boat or lagoon option for current conditions.",
          ),
        ],
      },
      {
        id: "days-four-five",
        title: "Days 4–5 · North and recovery",
        introduction: "Give the longest land route its own day and do not hide the fatigue cost.",
        items: [
          item(
            "Day 4 · North and tide",
            "Use the Magpupungko window only after checking access and tide timing; add Pacifico when the route remains comfortable.",
          ),
          item(
            "Day 5 · Slow or repeat",
            "Recover, work remotely, take another lesson, or move the north day here if conditions were stronger.",
          ),
          item(
            "Consider—but do not force—a split stay",
            "Two north nights help only when the north is a repeated priority and moving bags costs less than repeated driving.",
          ),
        ],
      },
      {
        id: "days-six-seven",
        title: "Days 6–7 · Second window and exit",
        introduction:
          "Use the week’s second window for what the evidence supports, then finish near the departure route.",
        items: [
          item(
            "Day 6 · Best remaining day",
            "Choose the missed anchor, a second lesson, or a quiet local day—not three leftovers.",
          ),
          item(
            "Day 7 · Local finish",
            "Stay near the base, pack, settle payments, and keep the final ride simple.",
          ),
          item(
            "Return south before an early exit",
            "If the stay was split, sleep within a comfortable airport or port transfer before departure.",
          ),
        ],
      },
    ],
    comparison: {
      title: "One base or a split stay?",
      introduction: "A split is useful only when it removes more travel than it creates.",
      columns: ["Pattern", "Best for", "Tradeoff"],
      rows: [
        ["7 nights south", "Convenience, food choice, mixed first visit", "Longer north days"],
        ["5 south + 2 north", "Repeated Pacifico mornings", "One checkout and transfer"],
        [
          "4 south + 3 north",
          "Surf-led or quiet north priority",
          "Less access to south-island services",
        ],
      ],
    },
    travelTimes: islandTravelTimes,
    mapStops: islandMapStops,
    realityChecks: sharedRealityChecks,
    relatedSlugs: ["siargao-5-day-itinerary", "complete-siargao-travel-guide", "siargao-by-month"],
  }),
  guide({
    slug: "best-time-to-visit-siargao",
    lastChecked: "2026-08-14",
    title: "Best Time to Visit Siargao",
    shortTitle: "Best time to visit",
    description:
      "Choose a Siargao travel window by weather tolerance, surf goals, crowd sensitivity, and disruption risk—not one magic month.",
    quickRecommendation:
      "There is no guaranteed best month. For a general first trip, May or June is the strongest starting point from the nearest official rainfall baseline: Surigao City’s 1991–2020 normals are much lower then than in November to February. The station is not on Siargao, so check a current island forecast and keep condition-sensitive days movable.",
    image: {
      src: "/images/guides/best-time-to-visit-siargao.webp",
      alt: "Sun and a rain curtain sharing the sky above Siargao's coast",
      caption:
        "Original Ask Siargao editorial image · an island forecast can hold two truths at once.",
    },
    readingMinutes: 8,
    sections: [
      {
        id: "choose-by-priority",
        title: "Choose by priority",
        introduction: "The calendar matters less than the trip’s dominant need.",
        items: [
          item(
            "General sightseeing",
            "Start with May or June for a lower-rainfall climatological baseline, but keep boat and outdoor days movable because Siargao can differ from the nearby station.",
          ),
          item(
            "Surf-led travel",
            "Choose the break, ability level, and coaching plan first; a famous swell season is not automatically the right beginner window.",
          ),
          item(
            "Lower pressure",
            "A quieter or wetter period can still work when accommodation flexibility, indoor fallbacks, and disruption tolerance are high.",
          ),
        ],
      },
      {
        id: "weather-reality",
        title: "What the seasonal labels miss",
        introduction: "National seasons are context, not a Siargao guarantee.",
        items: [
          item(
            "National labels are a poor local shortcut",
            "PAGASA describes December to May as broadly dry nationally, yet the nearest 1991–2020 station normals are wettest in December and January and lowest from May to August.",
          ),
          item(
            "Rain does not mean a lost day",
            "Tropical rain may be brief, local, or persistent. The useful question is whether roads, boats, surf, and visibility support the specific plan.",
          ),
          item(
            "Cyclone season changes risk, not certainty",
            "PAGASA’s national peak context is a reason for stronger fallbacks, not a prediction that a particular trip will be hit.",
          ),
        ],
      },
      {
        id: "booking-window",
        title: "Book the right parts early",
        introduction: "Commit the scarce pieces and leave condition-sensitive pieces movable.",
        items: [
          item(
            "Book",
            "Flights, a suitable base, holiday-period rooms, and essential first and last transfers.",
          ),
          item(
            "Confirm close to travel",
            "Boat operations, surf lessons, tide-dependent timing, road conditions, and current forecasts.",
          ),
          item(
            "Carry a fallback",
            "One land-led day, one local rest day, and enough schedule margin to move an anchor activity.",
          ),
        ],
      },
    ],
    comparison: {
      title: "Match the window to the traveler",
      introduction: "Use this as a decision frame, then check current conditions.",
      columns: ["Priority", "Favor", "Accept"],
      rows: [
        [
          "Lower-rainfall first trip",
          "May–June starting point",
          "Heat, local variation, and no rain guarantee",
        ],
        [
          "Surf-led trip",
          "Break- and ability-specific season",
          "Condition checks and local safety judgment",
        ],
        [
          "Value and flexibility",
          "Availability-led dates",
          "Stronger live checks and changeable bookings",
        ],
      ],
    },
    travelTimes: southTravelTimes,
    mapStops: islandMapStops,
    realityChecks: sharedRealityChecks,
    relatedSlugs: ["siargao-by-month", "complete-siargao-travel-guide", "siargao-5-day-itinerary"],
    sources: [
      officialTourismSource,
      pagasaSurigaoNormalsSource,
      pagasaClimateSource,
      pagasaCycloneSource,
      openStreetMapSource,
    ],
  }),
  guide({
    slug: "siargao-by-month",
    lastChecked: "2026-08-14",
    title: "Siargao by Month",
    shortTitle: "Siargao by month",
    description:
      "A January-to-December Siargao planning guide with honest seasonal caveats and the checks each month still needs.",
    quickRecommendation:
      "Use the month as a planning baseline, not a forecast. At PAGASA’s nearest long-period station in Surigao City, rainfall is lowest from May to August and rises sharply from November to February. That station is not on Siargao, and July to October also carries higher national cyclone activity, so current island conditions still decide the day.",
    image: {
      src: "/images/guides/siargao-by-month.webp",
      alt: "A blank planning calendar, sun hat, and rain cover overlooking Siargao",
      caption:
        "Original Ask Siargao editorial image · the calendar starts the question but cannot answer it alone.",
    },
    readingMinutes: 10,
    sections: [
      {
        id: "january-april",
        title: "January to April",
        introduction:
          "The nearest official station is very wet in January and February, then rainfall eases toward April.",
        items: [
          item(
            "January",
            "The nearby normal is 661.5 mm across 24 rain days—the wettest month in that record. Carry serious boat and outdoor fallbacks.",
          ),
          item(
            "February",
            "The nearby normal remains high at 468.1 mm across 19 rain days. Current wind, sea, and rain checks should decide water days.",
          ),
          item(
            "March",
            "Rainfall eases in the nearby record but remains substantial at 354.8 mm. Add shade, hydration, and early starts as temperatures rise.",
          ),
          item(
            "April",
            "The nearby normal falls to 210.5 mm. Plan for increasing heat and holiday pressure, and protect midday rest.",
          ),
        ],
      },
      {
        id: "may-august",
        title: "May to August",
        introduction:
          "These are the four lowest-rainfall months in the nearest station normals, but they remain tropical and July–August sit inside the national cyclone peak.",
        items: [
          item(
            "May",
            "The nearby normal reaches its annual low at 120.0 mm across 10 rain days. Keep sun exposure conservative and the forecast current.",
          ),
          item(
            "June",
            "The nearby normal is 158.3 mm across 12 rain days. The national rainy-season label still does not predict a specific Siargao day.",
          ),
          item(
            "July",
            "The nearby rainfall normal stays relatively low at 158.4 mm, while PAGASA’s national cyclone peak context begins to matter more. Keep bookings changeable.",
          ),
          item(
            "August",
            "The nearby normal is 142.9 mm across 10 rain days, but cyclone-season disruption discipline still applies: movable outdoor days and protected connections.",
          ),
        ],
      },
      {
        id: "september-december",
        title: "September to December",
        introduction:
          "The nearby rainfall baseline climbs from September, sharply in November and December, while cyclone-season awareness continues.",
        items: [
          item(
            "September",
            "The nearby normal rises to 181.0 mm. Do not infer a surf day from the month alone; match the break and ability to a same-day local check.",
          ),
          item(
            "October",
            "The nearby normal rises to 250.3 mm, and national cyclone activity is still a material planning risk. Favor flexible terms.",
          ),
          item(
            "November",
            "The nearby normal jumps to 454.2 mm across 21 rain days. Re-check wind and rain exposure for east-coast plans.",
          ),
          item(
            "December",
            "Despite the national dry-season label, the nearby normal is 597.3 mm across 23 rain days. Holiday demand can also reduce room and transfer flexibility.",
          ),
        ],
      },
    ],
    comparison: {
      title: "Read the calendar correctly",
      introduction: "Each label changes the fallback you carry; none replaces a forecast.",
      columns: ["Season signal", "Useful for", "Not proof of"],
      rows: [
        ["Lower nearby rainfall · May–Aug", "Starting window and packing", "A dry Siargao day"],
        ["Higher nearby rainfall · Nov–Feb", "Fallbacks and flexible terms", "All-day island rain"],
        [
          "Cyclone peak nationally",
          "Advisory monitoring and transfer margin",
          "A direct Siargao impact",
        ],
      ],
    },
    travelTimes: southTravelTimes,
    mapStops: islandMapStops,
    realityChecks: sharedRealityChecks,
    relatedSlugs: [
      "best-time-to-visit-siargao",
      "siargao-5-day-itinerary",
      "complete-siargao-travel-guide",
    ],
    sources: [
      pagasaSurigaoNormalsSource,
      pagasaClimateSource,
      pagasaCycloneSource,
      officialTourismSource,
      openStreetMapSource,
    ],
  }),
] as const;

const guideBySlug = new Map(planningGuides.map((entry) => [entry.slug, entry] as const));

export function getPlanningGuide(slug: string) {
  return guideBySlug.get(slug);
}

export function buildGuideChatHref(guide: PlanningGuide, action: GuideRealityCheck) {
  const prompt = `Context: ${guide.title}. ${action.prompt}`;
  return `/chat?${new URLSearchParams({ prompt }).toString()}`;
}

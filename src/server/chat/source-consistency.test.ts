import { describe, expect, test } from "bun:test";

import type { AgentToolCallAudit } from "@/server/chat/agent-runtime";
import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import { renderAnswerSourceLines } from "@/server/chat/answer-source-summary";
import {
  assertChatAnswerSourceConsistency,
  SourceConsistencyError,
  validateChatAnswerSourceConsistency,
} from "@/server/chat/source-consistency";

describe("chat source consistency", () => {
  test("accepts valid checked weather sources backed by the weather tool", () => {
    const message = withSourceLines("Beach early, keep a covered fallback.", [
      weatherSourceSummary,
    ]);
    const result = validateChatAnswerSourceConsistency({
      message,
      sources: [weatherSourceSummary],
      toolCalls: [
        toolCall({
          name: "get_weather_forecast",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("accepts valid checked Places sources for live and fresh-cache outputs", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Use the Maps link and verify hours.", [
        livePlacesSourceSummary,
        freshCachePlacesSourceSummary,
      ]),
      sources: [livePlacesSourceSummary, freshCachePlacesSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [livePlacesSourceSummary],
        }),
        toolCall({
          name: "get_place_details",
          status: "success",
          sources: [freshCachePlacesSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("rejects rendered checked claims whose text does not match the tool source", () => {
    const result = validateChatAnswerSourceConsistency({
      message:
        "I checked availability.\n\nChecked: Google Places (live checked; high confidence; profile source_google_places) - bookings.",
      sources: [],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [livePlacesSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "rendered_checked_line_not_verifiable",
        label: "live_checked",
      }),
    ]);
  });

  test("accepts browser geolocation search-center claims only when Places tool-backed", () => {
    const geolocatedPlacesSource: AnswerSourceSummary = {
      ...livePlacesSourceSummary,
      checked: [...livePlacesSourceSummary.checked, "browser geolocation search center"],
    };
    const valid = validateChatAnswerSourceConsistency({
      message: withSourceLines("Used your shared location as the nearby search center.", [
        geolocatedPlacesSource,
      ]),
      sources: [geolocatedPlacesSource],
      toolCalls: [
        toolCall({
          name: "search_places",
          arguments: { center: { source: "browser_geolocation" } },
          status: "success",
          sources: [geolocatedPlacesSource],
        }),
      ],
    });
    const invalid = validateChatAnswerSourceConsistency({
      message: withSourceLines("Fabricated location-source wording.", [geolocatedPlacesSource]),
      sources: [geolocatedPlacesSource],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [livePlacesSourceSummary],
        }),
      ],
    });

    expect(valid).toEqual({ valid: true, issues: [] });
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual([
      "structured_source_not_tool_backed",
      "rendered_checked_line_not_verifiable",
    ]);
  });

  test("accepts browser geolocation claims when surf ranking tool-backed", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines(
        "Closest surf spots from your shared location are Pacifico / Big Wish and Bamboo Garden.",
        [surfSpotRankingSourceSummary],
      ),
      sources: [surfSpotRankingSourceSummary],
      toolCalls: [
        toolCall({
          name: "rank_surf_spots_nearby",
          arguments: { center: { source: "browser_geolocation" } },
          status: "success",
          sources: [surfSpotRankingSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("rejects browser geolocation claims when Places tool output lacks center marker", () => {
    const geolocatedPlacesSource: AnswerSourceSummary = {
      ...livePlacesSourceSummary,
      checked: [...livePlacesSourceSummary.checked, "browser geolocation search center"],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Used your shared location as the nearby search center.", [
        geolocatedPlacesSource,
      ]),
      sources: [geolocatedPlacesSource],
      toolCalls: [
        toolCall({
          name: "search_places",
          arguments: { center: { latitude: 9.8116, longitude: 126.1651 } },
          status: "success",
          sources: [geolocatedPlacesSource],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "browser_geolocation_claim_not_tool_backed",
      "structured_source_not_tool_backed",
      "rendered_checked_line_not_verifiable",
    ]);
  });

  test("accepts browser geolocation claims when internal audit center matches request context", () => {
    const geolocatedPlacesSource: AnswerSourceSummary = {
      ...livePlacesSourceSummary,
      checked: [...livePlacesSourceSummary.checked, "browser geolocation search center"],
    };
    const result = validateChatAnswerSourceConsistency({
      browserGeolocation: {
        status: "available",
        source: "browser_geolocation",
        consentScope: "single_request",
        latitude: 9.8116,
        longitude: 126.1651,
      },
      message: withSourceLines("Used your shared location as the nearby search center.", [
        geolocatedPlacesSource,
      ]),
      sources: [geolocatedPlacesSource],
      toolCalls: [
        toolCall({
          name: "search_places",
          arguments: { center: { latitude: 9.8116, longitude: 126.1651 } },
          status: "success",
          sources: [geolocatedPlacesSource],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("rejects shared-location prose claims without geolocated Places evidence", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("I used your shared location to find nearby cafes.", [
        livePlacesSourceSummary,
      ]),
      sources: [livePlacesSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [livePlacesSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "browser_geolocation_claim_not_tool_backed",
    ]);
  });

  test("rejects exact or rounded browser geolocation coordinates in final prose", () => {
    for (const message of [
      "I used latitude 9.8116 as your search center.",
      "I used 9.812, 126.165 as your rounded search center.",
    ]) {
      const result = validateChatAnswerSourceConsistency({
        browserGeolocation: {
          status: "available",
          source: "browser_geolocation",
          consentScope: "single_request",
          latitude: 9.8116,
          longitude: 126.1651,
        },
        message: withSourceLines(message, [livePlacesSourceSummary]),
        sources: [livePlacesSourceSummary],
        toolCalls: [
          toolCall({
            name: "search_places",
            status: "success",
            sources: [livePlacesSourceSummary],
          }),
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(
        "browser_geolocation_coordinates_rendered",
      );
    }
  });

  test("accepts valid curated local guide sources", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Doot and Malinao fit best.", [localGuideSourceSummary]),
      sources: [localGuideSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_local_guide",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("accepts event-checked nightlife facts from approved source profiles", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Use BARREL as warm-up and Barbosa as the main party.", [
        nightlifeEventSourceSummary,
      ]),
      sources: [nightlifeEventSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_nightlife_events",
          status: "success",
          sources: [nightlifeEventSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("rejects event-checked nightlife facts without an approved source profile", () => {
    const missingProfileSource: AnswerSourceSummary = {
      ...nightlifeEventSourceSummary,
      sourceProfileId: undefined,
    };
    const disallowedProfileSource: AnswerSourceSummary = {
      ...nightlifeEventSourceSummary,
      sourceProfileId: "source_nightlife_private_social_groups",
    };

    for (const source of [missingProfileSource, disallowedProfileSource]) {
      const result = validateChatAnswerSourceConsistency({
        message: withSourceLines("Do not accept unprofiled event truth.", [source]),
        sources: [source],
        toolCalls: [
          toolCall({
            name: "search_nightlife_events",
            status: "success",
            sources: [source],
          }),
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(
        "structured_source_not_tool_backed",
      );
    }
  });

  test("accepts profiled community signals but rejects them as event truth", () => {
    const validCommunity = validateChatAnswerSourceConsistency({
      message: withSourceLines("Community rhythm is context only.", [communitySignalSourceSummary]),
      sources: [communitySignalSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_nightlife_events",
          status: "success",
          sources: [communitySignalSourceSummary],
        }),
      ],
    });
    const communityAsEventTruth: AnswerSourceSummary = {
      ...communitySignalSourceSummary,
      label: "event_checked",
    };
    const invalidCommunity = validateChatAnswerSourceConsistency({
      message: withSourceLines("Community posts cannot verify tonight's schedule.", [
        communityAsEventTruth,
      ]),
      sources: [communityAsEventTruth],
      toolCalls: [
        toolCall({
          name: "search_nightlife_events",
          status: "success",
          sources: [communityAsEventTruth],
        }),
      ],
    });

    expect(validCommunity).toEqual({ valid: true, issues: [] });
    expect(invalidCommunity.valid).toBe(false);
    expect(invalidCommunity.issues.map((issue) => issue.code)).toContain(
      "structured_source_not_tool_backed",
    );
  });

  test("accepts web research labels only when backed by research_web evidence", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Goodies and Barbosa were checked on public web sources.", [
        officialWebSourceSummary,
        directoryWebSourceSummary,
        guideWebSourceSummary,
      ]),
      sources: [officialWebSourceSummary, directoryWebSourceSummary, guideWebSourceSummary],
      toolCalls: [
        toolCall({
          name: "research_web",
          status: "success",
          sources: [officialWebSourceSummary, directoryWebSourceSummary, guideWebSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("rejects memory retrieval as backing for web research labels", () => {
    for (const source of [
      officialWebSourceSummary,
      directoryWebSourceSummary,
      guideWebSourceSummary,
    ]) {
      const result = validateChatAnswerSourceConsistency({
        message: withSourceLines("Memory cannot be public web evidence.", [source]),
        sources: [source],
        toolCalls: [
          toolCall({
            name: "load_agent_memory_file",
            status: "success",
            sources: [source],
          }),
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(
        "structured_source_not_tool_backed",
      );
    }
  });

  test("rejects web labels from the wrong successful tool", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Places cannot back official web checks.", [
        officialWebSourceSummary,
      ]),
      sources: [officialWebSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [officialWebSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("structured_source_not_tool_backed");
  });

  test("accepts insufficient web evidence only as a not-checked research_web state", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Current ferry disruption evidence could not be verified.", [
        insufficientWebEvidenceSourceSummary,
      ]),
      sources: [insufficientWebEvidenceSourceSummary],
      toolCalls: [
        toolCall({
          name: "research_web",
          status: "success",
          sources: [insufficientWebEvidenceSourceSummary],
        }),
      ],
    });
    const invalidCheckedLine = validateChatAnswerSourceConsistency({
      message:
        "Do not render weak evidence as checked.\n\nChecked: Public web research (insufficient web evidence; low confidence; profile source_web_research) - current ferry disruption evidence.",
      sources: [],
      toolCalls: [
        toolCall({
          name: "research_web",
          status: "success",
          sources: [insufficientWebEvidenceSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
    expect(invalidCheckedLine.valid).toBe(false);
    expect(invalidCheckedLine.issues.map((issue) => issue.code)).toEqual([
      "unsupported_checked_label",
    ]);
  });

  test("does not allow community web evidence to be upgraded into official evidence", () => {
    const upgradedCommunity: AnswerSourceSummary = {
      ...webCommunitySourceSummary,
      label: "official_checked",
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Community chatter cannot become official truth.", [
        upgradedCommunity,
      ]),
      sources: [upgradedCommunity],
      toolCalls: [
        toolCall({
          name: "research_web",
          status: "success",
          sources: [webCommunitySourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("structured_source_not_tool_backed");
  });

  test("accepts curated itinerary sources backed by the itinerary planning tool", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Use the sequenced itinerary and keep the caveats visible.", [
        localGuideSourceSummary,
      ]),
      sources: [localGuideSourceSummary],
      toolCalls: [
        toolCall({
          name: "plan_local_itinerary",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("accepts curated and fresh-cache local data sources from safe local data tools", () => {
    const localFreshCacheSummary: AnswerSourceSummary = {
      label: "fresh_cache",
      sourceName: "Local public directory",
      sourceProfileId: "source_local_public",
      confidence: "medium",
      checked: ["service fact: Backup generator service"],
      notChecked: ["private audit records"],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Doot is curated and the service fact came from cache.", [
        localGuideSourceSummary,
        localFreshCacheSummary,
      ]),
      sources: [localGuideSourceSummary, localFreshCacheSummary],
      toolCalls: [
        toolCall({
          name: "query_local_facts",
          status: "success",
          sources: [localGuideSourceSummary, localFreshCacheSummary],
        }),
        toolCall({
          name: "get_source_evidence",
          status: "success",
          sources: [localGuideSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("rejects memory retrieval as backing for checked provider or curated labels", () => {
    const verifyingSources = [
      livePlacesSourceSummary,
      freshCachePlacesSourceSummary,
      weatherSourceSummary,
      marineSourceSummary,
      tideForecastSourceSummary,
      localGuideSourceSummary,
    ];

    for (const source of verifyingSources) {
      const result = validateChatAnswerSourceConsistency({
        message: "Memory retrieval is reference context, not checked evidence.",
        sources: [source],
        toolCalls: [
          toolCall({
            name: "load_agent_memory_file",
            status: "success",
            sources: [source],
          }),
        ],
      });

      expect(result.valid).toBe(false);
      expect(result.issues.map((issue) => issue.code)).toContain(
        "structured_source_not_tool_backed",
      );
    }
  });

  test("rejects memory retrieval as provider-unavailable evidence", () => {
    const result = validateChatAnswerSourceConsistency({
      message: "Memory failed, but that is not a live provider failure.",
      sources: [providerUnavailableSourceSummary],
      toolCalls: [
        toolCall({
          name: "load_agent_memory_file",
          status: "error",
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain(
      "provider_unavailable_without_tool_failure",
    );
  });

  test("allows memory retrieval to coexist with governed source evidence", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Google Places backs the live claim; memory adds no label.", [
        livePlacesSourceSummary,
      ]),
      sources: [livePlacesSourceSummary],
      toolCalls: [
        toolCall({
          name: "load_agent_memory_file",
          status: "success",
          sources: [],
        }),
        toolCall({
          name: "search_places",
          status: "success",
          sources: [livePlacesSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(true);
  });

  test("keeps generic model reasoning as not verified without requiring tool output", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("A relaxed General Luna afternoon is reasonable.", [
        genericSourceSummary,
      ]),
      sources: [genericSourceSummary],
      toolCalls: [],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("accepts itinerary planning caveats as not verified without live checks", () => {
    const itineraryCaveatSource: AnswerSourceSummary = {
      label: "not_verified",
      sourceName: "Itinerary planner unchecked live signals",
      confidence: "medium",
      checked: [],
      notChecked: ["live weather", "live Google Places open status", "surf", "tide"],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Use the plan, but keep live checks caveated.", [
        itineraryCaveatSource,
      ]),
      sources: [itineraryCaveatSource],
      toolCalls: [
        toolCall({
          name: "plan_local_itinerary",
          status: "success",
          sources: [itineraryCaveatSource],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("accepts condition judgment caveats for unchecked tide and surf signals", () => {
    const conditionCaveatSource: AnswerSourceSummary = {
      label: "not_verified",
      sourceName: "Condition judgment unchecked marine signals",
      confidence: "medium",
      checked: [],
      notChecked: ["tide", "surf", "currents", "lifeguard or swimming safety"],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Weather can be checked, but marine signals stay caveated.", [
        conditionCaveatSource,
      ]),
      sources: [conditionCaveatSource],
      toolCalls: [
        toolCall({
          name: "get_condition_judgment",
          status: "success",
          sources: [conditionCaveatSource],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("accepts weather_checked condition judgment claims only when tool-backed", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Checked weather still leaves marine caveats visible.", [
        weatherSourceSummary,
      ]),
      sources: [weatherSourceSummary],
      toolCalls: [
        toolCall({
          name: "get_condition_judgment",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("accepts curated local guide claims from condition judgment tool evidence", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Malinao has curated beach-surface caveats for swimming.", [
        weatherSourceSummary,
        localGuideSourceSummary,
      ]),
      sources: [weatherSourceSummary, localGuideSourceSummary],
      toolCalls: [
        toolCall({
          name: "get_condition_judgment",
          status: "success",
          sources: [weatherSourceSummary, localGuideSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("rejects tide or surf checked labels until provider-backed marine tools exist", () => {
    const checkedTideSource: AnswerSourceSummary = {
      label: "weather_checked",
      sourceName: "Tide and surf condition provider",
      confidence: "medium",
      checked: ["tide", "surf"],
      notChecked: [],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Do not accept checked marine labels yet.", [checkedTideSource]),
      sources: [checkedTideSource],
      toolCalls: [
        toolCall({
          name: "get_condition_judgment",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "unsupported_checked_label",
      "unsupported_checked_label",
    ]);
  });

  test("rejects checked marine terms in structured checked fields and rendered source text", () => {
    const weatherWithMarineChecked: AnswerSourceSummary = {
      ...weatherSourceSummary,
      checked: ["forecast for Siargao Island", "tide and surf"],
      notChecked: [],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Do not accept weather sources as marine checks.", [
        weatherWithMarineChecked,
      ]),
      sources: [weatherWithMarineChecked],
      toolCalls: [
        toolCall({
          name: "get_weather_forecast",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "unsupported_checked_label",
      "unsupported_checked_label",
    ]);
  });

  test("accepts marine_checked modelled tide, wave, swell, and current claims when tool-backed", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Open-Meteo Marine model data was checked.", [marineSourceSummary]),
      sources: [marineSourceSummary],
      toolCalls: [
        toolCall({
          name: "get_marine_conditions",
          status: "success",
          sources: [marineSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("accepts tide_forecast_checked predicted tide and swell claims when tool-backed", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Tide-Forecast tide timing was checked.", [
        tideForecastSourceSummary,
      ]),
      sources: [tideForecastSourceSummary],
      toolCalls: [
        toolCall({
          name: "get_tide_forecast",
          status: "success",
          sources: [tideForecastSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("accepts current Places status wording without treating it as ocean current evidence", () => {
    const currentOpeningSource: AnswerSourceSummary = {
      ...livePlacesSourceSummary,
      sourceName: "current opening status",
      checked: ["open-now signal"],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("The venue has current opening status.", [currentOpeningSource]),
      sources: [currentOpeningSource],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [currentOpeningSource],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("still rejects checked sea current claims until marine providers exist", () => {
    const seaCurrentSource: AnswerSourceSummary = {
      ...weatherSourceSummary,
      checked: ["sea current"],
      notChecked: [],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Do not accept weather sources as sea-current checks.", [
        seaCurrentSource,
      ]),
      sources: [seaCurrentSource],
      toolCalls: [
        toolCall({
          name: "get_weather_forecast",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "unsupported_checked_label",
      "unsupported_checked_label",
    ]);
  });

  test("rejects fabricated checked road and safety claims until providers exist", () => {
    const roadSafetySource: AnswerSourceSummary = {
      ...weatherSourceSummary,
      checked: ["road flooding", "lifeguard status", "official warnings"],
      notChecked: [],
    };
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Do not accept weather sources as road or safety checks.", [
        roadSafetySource,
      ]),
      sources: [roadSafetySource],
      toolCalls: [
        toolCall({
          name: "get_weather_forecast",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "unsupported_checked_label",
      "unsupported_checked_label",
    ]);
  });

  test("rejects rendered checked road and swimming-safety claims", () => {
    const result = validateChatAnswerSourceConsistency({
      message:
        "Checked conditions.\n\nChecked: Open-Meteo weather API (weather checked; medium confidence; profile source_open_meteo) - road closures and swimming safety.",
      sources: [],
      toolCalls: [
        toolCall({
          name: "get_weather_forecast",
          status: "success",
          sources: [weatherSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "unsupported_checked_label",
        label: "weather_checked",
      }),
    ]);
  });

  test("rejects fabricated checked labels without matching tool output", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Google Places says this is live checked.", [
        livePlacesSourceSummary,
      ]),
      sources: [livePlacesSourceSummary],
      toolCalls: [],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "structured_source_not_tool_backed",
      "rendered_checked_line_not_verifiable",
      "rendered_checked_line_not_verifiable",
    ]);
  });

  test("rejects rendered checked source claims even when structured sources are omitted", () => {
    const result = validateChatAnswerSourceConsistency({
      message:
        "This was checked.\n\nChecked: Google Places (live checked; high confidence; profile source_google_places) - open-now status.",
      sources: [],
      toolCalls: [],
    });

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: "rendered_checked_line_not_verifiable",
        label: "live_checked",
      }),
    ]);
  });

  test("rejects generic model reasoning mislabeled as a live check", () => {
    const mislabeledGeneric: AnswerSourceSummary = {
      ...genericSourceSummary,
      label: "live_checked",
      checked: ["generic recommendation"],
    };

    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("This answer is not backed by a tool.", [mislabeledGeneric]),
      sources: [mislabeledGeneric],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "success",
          sources: [livePlacesSourceSummary],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.issues.every((issue) => issue.code === "generic_reasoning_mislabeled")).toBe(
      true,
    );
  });

  test("accepts provider-unavailable claims only when a tool produced failure evidence", () => {
    const valid = validateChatAnswerSourceConsistency({
      message: withSourceLines("I could not check live open-now status.", [
        providerUnavailableSourceSummary,
      ]),
      sources: [providerUnavailableSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_places",
          status: "error",
          errorCode: "provider_unavailable",
          sources: [providerUnavailableSourceSummary],
        }),
      ],
    });
    const invalid = validateChatAnswerSourceConsistency({
      message: withSourceLines("I could not check live open-now status.", [
        providerUnavailableSourceSummary,
      ]),
      sources: [providerUnavailableSourceSummary],
      toolCalls: [],
    });

    expect(valid.valid).toBe(true);
    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual([
      "provider_unavailable_without_tool_failure",
      "provider_unavailable_without_tool_failure",
    ]);
  });

  test("accepts stale nightlife event lookup as terminal unavailable evidence", () => {
    const result = validateChatAnswerSourceConsistency({
      message: withSourceLines("Approved priority event sources need refresh for tonight.", [
        staleNightlifeSourceSummary,
      ]),
      sources: [staleNightlifeSourceSummary],
      toolCalls: [
        toolCall({
          name: "search_nightlife_events",
          status: "success",
          sources: [staleNightlifeSourceSummary],
        }),
      ],
    });

    expect(result).toEqual({ valid: true, issues: [] });
  });

  test("throws a controlled source consistency error for route enforcement", () => {
    expect(() =>
      assertChatAnswerSourceConsistency({
        sources: [weatherSourceSummary],
        toolCalls: [],
      }),
    ).toThrow(SourceConsistencyError);

    try {
      assertChatAnswerSourceConsistency({
        sources: [weatherSourceSummary],
        toolCalls: [],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(SourceConsistencyError);
      expect((error as SourceConsistencyError).statusCode).toBe(502);
      expect((error as SourceConsistencyError).code).toBe("source_consistency_failed");
    }
  });
});

function withSourceLines(message: string, sources: readonly AnswerSourceSummary[]) {
  return [message, "", ...renderAnswerSourceLines(sources)].join("\n");
}

function toolCall({
  arguments: toolArguments = {},
  errorCode,
  name,
  sources,
  status,
}: {
  name: string;
  arguments?: Record<string, unknown>;
  status: "success" | "error";
  sources: readonly AnswerSourceSummary[];
  errorCode?: string;
}): AgentToolCallAudit {
  return {
    id: `audit_${name}`,
    name,
    arguments: toolArguments,
    status,
    durationMs: 10,
    startedAt: "2026-06-26T00:00:00.000Z",
    completedAt: "2026-06-26T00:00:00.010Z",
    ...(errorCode ? { errorCode } : {}),
    sourceProfileIds: sources.flatMap((source) =>
      source.sourceProfileId ? [source.sourceProfileId] : [],
    ),
    sources,
  };
}

const weatherSourceSummary: AnswerSourceSummary = {
  label: "weather_checked",
  sourceName: "Open-Meteo weather API",
  sourceProfileId: "source_open_meteo",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "medium",
  checked: ["forecast for Siargao Island"],
  notChecked: ["surf reports"],
};

const marineSourceSummary: AnswerSourceSummary = {
  label: "marine_checked",
  sourceName: "Open-Meteo Marine API",
  sourceProfileId: "source_open_meteo_marine",
  fetchedAt: "2026-06-28T04:00:00.000Z",
  confidence: "medium",
  checked: [
    "modelled sea level height MSL (tide proxy) for Siargao marine forecast near General Luna",
    "modelled wave height",
    "modelled swell wave height",
    "modelled ocean current velocity",
  ],
  notChecked: ["official tide table", "lifeguard or swimming safety"],
};

const tideForecastSourceSummary: AnswerSourceSummary = {
  label: "tide_forecast_checked",
  sourceName: "Tide-Forecast Dapa page",
  sourceProfileId: "source_tide_forecast_dev",
  fetchedAt: "2026-06-28T10:00:00.000Z",
  confidence: "low",
  checked: [
    "Tide-Forecast Dapa tide station predicted tide table for 2026-06-29",
    "predicted high and low tide times",
    "predicted tide heights",
    "embedded Tide-Forecast 3-hour swell and wind periods",
  ],
  notChecked: ["official tide-gauge measurement", "lifeguard or swimming safety"],
};

const livePlacesSourceSummary: AnswerSourceSummary = {
  label: "live_checked",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "high",
  checked: ["place listings", "map links"],
  notChecked: ["review text", "bookings"],
};

const freshCachePlacesSourceSummary: AnswerSourceSummary = {
  label: "fresh_cache",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  fetchedAt: "2026-06-26T00:00:00.000Z",
  confidence: "medium",
  checked: ["fresh cached place fields"],
  notChecked: ["live open-now status"],
};

const localGuideSourceSummary: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao curated local beach guide",
  confidence: "medium",
  checked: ["beach surface notes", "ride-time notes"],
  notChecked: ["live tide", "lifeguard status"],
};

const nightlifeEventSourceSummary: AnswerSourceSummary = {
  label: "event_checked",
  sourceName: "Local nightlife event directories",
  sourceProfileId: "source_nightlife_local_event_directories",
  fetchedAt: "2026-06-30T04:00:00.000Z",
  confidence: "medium",
  checked: [
    "approved General Luna nightlife event facts for Tuesday",
    "verified event occurrences: BARREL, Mama Coco",
    "route roles: warm-up, main party, late option, and softer option when available",
  ],
  notChecked: [
    "same-day venue social posts",
    "live crowd size",
    "door policy",
    "guest list",
    "table availability",
    "last-minute cancellation",
    "exact closing time",
  ],
};

const communitySignalSourceSummary: AnswerSourceSummary = {
  label: "community_signal",
  sourceName: "Reddit public nightlife threads",
  sourceProfileId: "source_nightlife_reddit_public_threads",
  fetchedAt: "2026-06-30T04:00:00.000Z",
  confidence: "low",
  checked: ["public community nightlife rhythm signal"],
  notChecked: ["tonight's event schedule", "venue confirmation", "crowd size"],
};

const officialWebSourceSummary: AnswerSourceSummary = {
  label: "official_checked",
  sourceName: "BARBOSA Official Schedule",
  sourceProfileId: "source_web_official",
  fetchedAt: "2026-07-01T09:00:00.000Z",
  confidence: "high",
  checked: ["Wednesday: closed"],
  notChecked: ["last-minute private events"],
};

const directoryWebSourceSummary: AnswerSourceSummary = {
  label: "directory_checked",
  sourceName: "SiargaoVibes",
  sourceProfileId: "source_web_local_directory",
  fetchedAt: "2026-07-01T09:00:00.000Z",
  confidence: "medium",
  checked: ["Goodies lists Funky Wednesday from 8 PM to 12 AM"],
  notChecked: ["live crowd size"],
};

const guideWebSourceSummary: AnswerSourceSummary = {
  label: "web_researched",
  sourceName: "Recent Siargao nightlife guide",
  sourceProfileId: "source_web_guide",
  fetchedAt: "2026-03-02T09:00:00.000Z",
  confidence: "low",
  checked: ["El Lobo has a Wednesday guide signal"],
  notChecked: ["official same-day confirmation"],
};

const webCommunitySourceSummary: AnswerSourceSummary = {
  label: "community_signal",
  sourceName: "Reddit public nightlife threads",
  sourceProfileId: "source_web_community",
  confidence: "low",
  checked: ["public community nightlife rhythm signal"],
  notChecked: ["official event schedule"],
};

const insufficientWebEvidenceSourceSummary: AnswerSourceSummary = {
  label: "insufficient_web_evidence",
  sourceName: "Public web research",
  sourceProfileId: "source_web_research",
  confidence: "low",
  checked: [],
  notChecked: ["current ferry disruption evidence"],
};

const surfSpotRankingSourceSummary: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao surf spot reference",
  confidence: "medium",
  checked: [
    "known surf spot reference list",
    "approximate straight-line distance ranking from shared browser location",
  ],
  notChecked: ["live surf quality", "road travel distance"],
};

const genericSourceSummary: AnswerSourceSummary = {
  label: "not_verified",
  sourceName: "Generic model reasoning",
  checked: [],
  notChecked: ["live Google Places", "weather forecast"],
};

const providerUnavailableSourceSummary: AnswerSourceSummary = {
  label: "provider_unavailable",
  sourceName: "Google Places",
  sourceProfileId: "source_google_places",
  confidence: "low",
  checked: [],
  notChecked: ["Google Places lookup"],
};

const staleNightlifeSourceSummary: AnswerSourceSummary = {
  label: "no_current_event_facts",
  sourceName: "Approved General Luna nightlife event source profiles",
  sourceProfileId: "source_nightlife_official_venue_websites",
  fetchedAt: "2026-07-07T04:00:00.000Z",
  confidence: "low",
  checked: [],
  notChecked: [
    "current General Luna nightlife event facts for Tuesday",
    "same-day event schedule until approved priority sources are refreshed",
  ],
};

import { describe, expect, test } from "bun:test";

import type { AnswerSourceSummary } from "@/server/chat/answer-source-summary";
import {
  loadStaticLocalGeoReferences,
  loadSurfSpotGeoReferencesFromMarkdown,
  localGeoAliasOrNameMatches,
  normalizeLocalGeoBeachRecord,
  normalizeLocalGeoOriginAnchor,
  rankSurfSpotReferences,
  searchLocalGeoBeachGuide,
} from "@/server/local/local-geo-reference";

const sourceSummary: AnswerSourceSummary = {
  label: "curated_local_guide",
  sourceName: "Ask Siargao curated local beach guide",
  confidence: "medium",
  checked: ["ride-time notes", "beach-surface notes"],
  notChecked: ["live road conditions", "tide", "currents"],
};

describe("local geo reference interface", () => {
  test("normalizes static beach records and preserves ranking, caveats, and fit reasons", () => {
    const beaches = loadStaticLocalGeoReferences({
      adapterId: "static:test-beaches",
      records: [malinaoBeachFixture(), pacificoBeachFixture(), { name: "Broken Beach" }],
      normalizeRecord: normalizeLocalGeoBeachRecord,
    });
    const anchors = loadStaticLocalGeoReferences({
      adapterId: "static:test-origins",
      records: [pacificoAnchorFixture()],
      normalizeRecord: normalizeLocalGeoOriginAnchor,
    });

    const result = searchLocalGeoBeachGuide({
      query: "sandy beach near Pacifico for swimming",
      filters: { beachSurface: "sand", originArea: "Pacifico", maxRideMinutes: 30 },
      beachRecords: beaches.records,
      originAnchors: anchors.records,
      sourceSummary,
    });

    expect(beaches.issues).toEqual([
      { adapterId: "static:test-beaches", code: "malformed_anchor_records" },
    ]);
    expect(result.candidates.map((candidate) => candidate.name)).toEqual(["Pacifico Beach"]);
    expect(result.candidates[0]?.fitReasons).toContain("Named-area fit for Pacifico.");
    expect(result.candidates[0]?.fitReasons.join(" ")).toContain("sandy in stretches");
    expect(result.excluded[0]).toMatchObject({
      name: "Malinao Beach",
      reason: expect.stringContaining("not a close Pacifico proximity match"),
    });
    expect(result.sourceSummary).toBe(sourceSummary);
    expect(result.caveats.join(" ")).toContain("not a live tide");
  });

  test("parses memory-backed surf anchors and ranks without leaking coordinates", () => {
    const loaded = loadSurfSpotGeoReferencesFromMarkdown(`
Reference body.

\`\`\`json surf_spot_distance_anchors
[
  {
    "id": "pacifico",
    "name": "Pacifico / Big Wish",
    "aliases": ["Big Wish"],
    "area": "Pacifico",
    "skillLevels": ["intermediate", "advanced"],
    "access": "shore",
    "latitude": 9.9538,
    "longitude": 126.0882,
    "caveats": ["Powerful north-coast left."]
  },
  {
    "id": "boat_only",
    "name": "Boat Only",
    "aliases": [],
    "area": "Reef",
    "skillLevels": ["beginner"],
    "access": "boat",
    "latitude": 9.95,
    "longitude": 126.08,
    "caveats": ["Boat access required."]
  },
  { "id": "broken" }
]
\`\`\`
`);

    const ranked = rankSurfSpotReferences({
      center: { latitude: 9.952, longitude: 126.088 },
      spots: loaded.records,
      skillLevel: "intermediate",
      includeBoatAccess: false,
      maxResults: 5,
    });

    expect(loaded.issues).toEqual([
      { adapterId: "agent-memory:SURF.md", code: "malformed_anchor_records" },
    ]);
    expect(
      localGeoAliasOrNameMatches({
        name: loaded.records[0]?.name ?? "",
        aliases: loaded.records[0]?.aliases ?? [],
        requestedName: "Big Wish",
      }),
    ).toBe(true);
    expect(ranked).toHaveLength(1);
    expect(ranked[0]).toMatchObject({
      name: "Pacifico / Big Wish",
      access: "shore",
      distanceLabel: expect.stringContaining("km straight-line from your shared location"),
      fitReasons: expect.arrayContaining([
        "matches intermediate surf ability filter",
        "ranked by approximate straight-line distance from your shared location",
        "shore access",
      ]),
      caveats: ["Powerful north-coast left."],
    });
    expect(JSON.stringify(ranked)).not.toContain("9.952");
    expect(JSON.stringify(ranked)).not.toContain("126.088");
    expect(JSON.stringify(ranked)).not.toContain("Boat Only");
  });

  test("fails closed for missing and malformed memory surf adapters", () => {
    expect(loadSurfSpotGeoReferencesFromMarkdown(undefined)).toEqual({
      records: [],
      issues: [{ adapterId: "agent-memory:SURF.md", code: "adapter_missing" }],
    });
    expect(loadSurfSpotGeoReferencesFromMarkdown("No anchors here.")).toEqual({
      records: [],
      issues: [{ adapterId: "agent-memory:SURF.md", code: "anchor_block_missing" }],
    });
    expect(
      loadSurfSpotGeoReferencesFromMarkdown(`
\`\`\`json surf_spot_distance_anchors
not-json
\`\`\`
`),
    ).toEqual({
      records: [],
      issues: [{ adapterId: "agent-memory:SURF.md", code: "malformed_anchor_json" }],
    });
    expect(
      loadSurfSpotGeoReferencesFromMarkdown(`
\`\`\`json surf_spot_distance_anchors
{"id":"not-an-array"}
\`\`\`
`),
    ).toEqual({
      records: [],
      issues: [{ adapterId: "agent-memory:SURF.md", code: "malformed_anchor_records" }],
    });
  });
});

function malinaoBeachFixture() {
  return {
    name: "Malinao Beach",
    area: "Malinao",
    areaKeywords: ["malinao", "general luna"],
    location: { latitude: 9.753, longitude: 126.121 },
    distanceFromGeneralLunaMinutes: { min: 10, max: 20 },
    surface: "sand",
    swimmingFit: "good sandy shoreline candidate when conditions are calm",
    sunsetFit: "good for a relaxed late-afternoon walk",
    surfFit: "better for a beach walk or swim than surf",
    rainFit: "close enough to keep as a flexible bad-weather fallback",
    tideNotes: "some stretches are better at mid to high tide",
    confidence: "medium",
    sourceNotes: "Curated local guide estimate for sandy stretches around Malinao.",
  };
}

function pacificoBeachFixture() {
  return {
    name: "Pacifico Beach",
    area: "Pacifico / San Isidro",
    areaKeywords: ["pacifico", "san isidro", "north siargao"],
    location: { latitude: 9.954, longitude: 126.088 },
    distanceFromGeneralLunaMinutes: { min: 65, max: 90 },
    surface: "sand",
    swimmingFit: "sandy in stretches, but not a strict 30-minute option from General Luna",
    sunsetFit: "better treated as a longer north-island beach trip",
    surfFit: "better known as a north-island surf/coastal trip",
    rainFit: "not ideal during rain because of the longer ride",
    tideNotes: "conditions vary by swell and exact beach stretch",
    confidence: "medium",
    sourceNotes: "Kept so strict 30-minute filters can explicitly exclude it.",
  };
}

function pacificoAnchorFixture() {
  return {
    label: "Pacifico",
    aliases: ["pacifico"],
    latitude: 9.954,
    longitude: 126.088,
  };
}

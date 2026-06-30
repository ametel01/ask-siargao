# Siargao Surf Spots - Agent-Ready Reference

## Purpose

Use this file when the traveler asks about surf spots, surf breaks, where to
surf, alternatives to a surf spot, surf skill fit, or surf areas around Siargao.
This file is surf-break knowledge, not live surf conditions.

This file is based on publicly documented surf guides and should not be treated
as a complete local surf map. Some breaks are seasonal, tide-dependent, unnamed,
renamed locally, or intentionally under-documented. For safety-critical surf
advice, recommend checking with a local surf school, boatman, or experienced
local surfer.

## Hard Boundary: Surf Spots vs Beach Fallbacks

- If the user asks for surf spots, do not recommend ordinary beach stops such as
  Malinao or Doot as surf picks.
- If a normal beach is useful only as a fallback, label it as a non-surf fallback
  and do not attach surf confidence to it.
- For "near Pacifico" surf questions, prioritize Pacifico / Big Wish, Bamboo
  Garden, Burgos Bay, Innertubes, Hapiks, Tangbo, and other north-coast surf
  context before General Luna beach fallbacks.
- For "near General Luna" surf questions, prioritize Cloud 9, Jacking Horse,
  Quiksilver, Tuason, Cemetery / Pesangan, Ocean 9, Daku Reef, Guiuan / Union,
  and nearby boat-access reef options according to skill level.

## Agent Usage Rules

- Do not claim this is an exhaustive list of every hidden/local break.
- When the user asks for beginner spots, prioritize softer and commonly taught waves.
- Filter by ability before ranking. Do not include advanced-only breaks in a
  beginner shortlist just because they are famous or nearby.
- When the user asks for advanced spots, clearly mention reef, current, crowding, and local knowledge.
- For remote or boat-access waves, recommend going with a local guide.
- For Cloud 9, Tuason, Rock Island, Pacifico, Pansukian, Tuesday Rock, Bombora, and Hapiks, add a safety warning unless the user clearly states they are experienced.
- Mention that conditions depend on swell direction, tide, wind, season, and board choice.
- For today's timing, tide, weather, swell, wind, or safety-sensitive advice,
  also use the governed condition/tide/marine/weather tools required by policy.
- For "closest surf spots near me" with browser geolocation available, call
  `rank_surf_spots_nearby` and use its approximate km ranking. Do not substitute
  the General Luna / Cloud 9 cluster unless the ranking tool actually returns it
  near the user's shared location.
- For a named surf area, prioritize that area before broader island classics:
  Pacifico/Burgos context should stay north-coast first, while General Luna or
  Cloud 9 context can stay in the east-coast cluster.
- The surf ranking tool uses approximate public-area anchors and straight-line
  distance only; road distance, travel time, exact lineup pins, access changes,
  and live surf quality remain unchecked.

---

## Machine-Readable Distance Ranking Anchors

These anchors support the `rank_surf_spots_nearby` tool. Coordinates are
approximate public-area anchors, not exact lineup pins.

```json surf_spot_distance_anchors
[
  {
    "id": "cloud_9",
    "name": "Cloud 9",
    "aliases": [],
    "area": "General Luna / Catangnan",
    "skillLevels": ["advanced"],
    "access": "paddle",
    "latitude": 9.8147,
    "longitude": 126.1654,
    "caveats": ["Advanced reef wave; not suitable for beginners."]
  },
  {
    "id": "quiksilver",
    "name": "Quiksilver",
    "aliases": ["Quicksilver"],
    "area": "General Luna / Cloud 9",
    "skillLevels": ["intermediate", "advanced"],
    "access": "paddle",
    "latitude": 9.8138,
    "longitude": 126.1662,
    "caveats": ["Reef break near Cloud 9; avoid treating it as a pure beginner wave."]
  },
  {
    "id": "jacking_horse",
    "name": "Jacking Horse",
    "aliases": [],
    "area": "General Luna / Cloud 9",
    "skillLevels": ["beginner", "intermediate"],
    "access": "paddle",
    "latitude": 9.8155,
    "longitude": 126.1647,
    "caveats": [
      "Softer lesson wave, but still reef-based; beginners should go with an instructor."
    ]
  },
  {
    "id": "tuason_point",
    "name": "Tuason Point",
    "aliases": ["Tuason"],
    "area": "General Luna / Tuason",
    "skillLevels": ["intermediate", "advanced"],
    "access": "shore",
    "latitude": 9.8037,
    "longitude": 126.1619,
    "caveats": ["Powerful reef wave; high tide is generally safer than low tide."]
  },
  {
    "id": "cemetery_pesangan",
    "name": "Cemetery / Pesangan",
    "aliases": ["Cemetery", "Pesangan"],
    "area": "General Luna",
    "skillLevels": ["beginner", "intermediate", "advanced"],
    "access": "paddle",
    "latitude": 9.7899,
    "longitude": 126.1558,
    "caveats": ["Multiple reef peaks; fit varies widely by tide and swell."]
  },
  {
    "id": "ocean_9",
    "name": "Ocean 9",
    "aliases": [],
    "area": "Santa Fe / Catangnan side",
    "skillLevels": ["beginner"],
    "access": "shore",
    "latitude": 9.8208,
    "longitude": 126.1388,
    "caveats": ["Softer bay wave that may be flat without enough wrapping swell."]
  },
  {
    "id": "daku_reef",
    "name": "Daku Reef",
    "aliases": ["Daku Island"],
    "area": "Daku Island",
    "skillLevels": ["beginner", "intermediate"],
    "access": "boat",
    "latitude": 9.749,
    "longitude": 126.149,
    "caveats": ["Boat access required; reef still present."]
  },
  {
    "id": "guiuan_g1",
    "name": "Guiuan / G1",
    "aliases": ["Guiuan", "Giwan", "G1"],
    "area": "Southern Siargao",
    "skillLevels": ["beginner", "intermediate"],
    "access": "shore",
    "latitude": 9.7698,
    "longitude": 126.112,
    "caveats": [
      "South-facing option; not always suitable for complete beginners without instruction."
    ]
  },
  {
    "id": "union",
    "name": "Union",
    "aliases": [],
    "area": "Southern Siargao near Guiuan",
    "skillLevels": ["beginner", "intermediate"],
    "access": "shore",
    "latitude": 9.7605,
    "longitude": 126.1045,
    "caveats": ["Local naming and exact entry points vary; confirm on arrival."]
  },
  {
    "id": "secret_spot_paradise",
    "name": "Secret Spot / Paradise Surfing",
    "aliases": ["Secret Spot", "Paradise Surfing"],
    "area": "Southern Siargao near Guiuan / Union",
    "skillLevels": ["beginner", "intermediate"],
    "access": "shore",
    "latitude": 9.7582,
    "longitude": 126.095,
    "caveats": ["Local naming may vary; confirm the exact section before paddling out."]
  },
  {
    "id": "salvacion",
    "name": "Salvacion",
    "aliases": [],
    "area": "Salvacion",
    "skillLevels": ["intermediate"],
    "access": "local",
    "latitude": 9.861,
    "longitude": 126.105,
    "caveats": ["Check local access and conditions."]
  },
  {
    "id": "pilar",
    "name": "Pilar",
    "aliases": [],
    "area": "Pilar",
    "skillLevels": ["intermediate"],
    "access": "local",
    "latitude": 9.8655,
    "longitude": 126.099,
    "caveats": ["Reef and rocks; local lineup awareness matters."]
  },
  {
    "id": "pacifico_big_wish",
    "name": "Pacifico / Big Wish",
    "aliases": ["Pacifico", "Big Wish"],
    "area": "Pacifico",
    "skillLevels": ["intermediate", "advanced"],
    "access": "shore",
    "latitude": 9.9538,
    "longitude": 126.0882,
    "caveats": ["Powerful north-coast left; not for beginners when solid."]
  },
  {
    "id": "bamboo_garden",
    "name": "Bamboo Garden",
    "aliases": ["Bamboo"],
    "area": "Pacifico area",
    "skillLevels": ["beginner", "intermediate", "advanced"],
    "access": "shore",
    "latitude": 9.949,
    "longitude": 126.088,
    "caveats": ["Match skill to section; not all sections are beginner-safe."]
  },
  {
    "id": "burgos_bay",
    "name": "Burgos Bay",
    "aliases": [],
    "area": "Burgos",
    "skillLevels": ["beginner", "intermediate", "advanced"],
    "access": "shore",
    "latitude": 10.009,
    "longitude": 126.074,
    "caveats": ["Broad surf zone; ask locally which exact Burgos wave is working."]
  },
  {
    "id": "innertubes",
    "name": "Innertubes",
    "aliases": ["Inner Tube"],
    "area": "Burgos Bay",
    "skillLevels": ["intermediate", "advanced"],
    "access": "shore",
    "latitude": 10.007,
    "longitude": 126.075,
    "caveats": ["Barrel opportunity when aligned, but not beginner-safe."]
  },
  {
    "id": "hapiks",
    "name": "Hapiks",
    "aliases": [],
    "area": "Burgos Bay",
    "skillLevels": ["advanced"],
    "access": "shore",
    "latitude": 10.012,
    "longitude": 126.072,
    "caveats": ["Fast technical left; advanced only."]
  },
  {
    "id": "tangbo",
    "name": "Tangbo Secret Spot / Paradise Beach",
    "aliases": ["Tangbo", "Secret Paradise", "Paradise Beach"],
    "area": "North tip / Tangbo",
    "skillLevels": ["beginner", "intermediate", "advanced"],
    "access": "shore",
    "latitude": 10.057,
    "longitude": 126.075,
    "caveats": ["Clarify section and conditions before recommending to beginners."]
  }
]
```

---

## Quick Recommendations

### Best Beginner-Friendly Options

- Jacking Horse
- Daku Reef / Daku Island
- Ocean 9
- Guiuan / Giwan / G1
- Union
- Secret Spot / Paradise Surfing
- Paradise
- Bamboo Garden
- Tangbo shoulder / softer sections

### Best Intermediate Options

- Cemetery / Pesangan
- Salvacion
- Bumee / Bombee
- Daku Reef on bigger days
- Bamboo Garden main sections
- Smaller Pacifico
- Pilar
- Guiuan / Union when conditions are stronger

### Best Advanced / Expert Options

- Cloud 9
- Tuason Point
- Quiksilver
- Rock Island
- Stimpy’s
- Pacifico / Big Wish
- Pansukian / Pansukyan Reef
- Tuesday Rock
- Bombora / Poo Shooter’s
- Hapiks
- Innertubes / Inner Tube

---

## Structured Spot List

### General Luna / Catangnan / Nearby Reefs

#### Cloud 9

- **Area:** General Luna / Catangnan
- **Skill level:** Advanced to expert
- **Wave type:** Right-hand reef break
- **Access:** Paddle from Cloud 9 boardwalk area
- **Description:** Siargao’s most famous wave. Fast, hollow, powerful right-hand barrel over shallow reef. World-class but crowded and unforgiving.
- **Agent warning:** Not suitable for beginners. Mention reef, crowds, and heavy takeoff.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Quiksilver / Quicksilver

- **Area:** General Luna / Cloud 9 area
- **Skill level:** Intermediate to advanced
- **Wave type:** Right-hand reef break
- **Access:** Near Cloud 9
- **Description:** Right-hander close to Cloud 9. Can be more approachable on smaller swells but becomes fast and technical when bigger.
- **Agent warning:** Avoid presenting it as a pure beginner wave.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Jacking Horse

- **Area:** General Luna / Cloud 9 area
- **Skill level:** Beginner to intermediate
- **Wave type:** Softer right-hand reef wave
- **Access:** Near Cloud 9
- **Description:** Common lesson spot near Cloud 9 with a softer takeoff than nearby advanced reefs. Good learner option when small and clean.
- **Agent warning:** Still reef-based; beginners should go with an instructor.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Tuason Point

- **Area:** General Luna / Tuason
- **Skill level:** Intermediate to advanced
- **Wave type:** Left-hand reef break
- **Access:** Paddle access from shore
- **Description:** Heavy left-hand reef wave. Can be powerful, shallow, and technical when working.
- **Agent warning:** Strongly caution inexperienced surfers. High tide is generally safer than low tide.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Cemetery / Pesangan

- **Area:** General Luna
- **Skill level:** Beginner to advanced depending on swell
- **Wave type:** Reef zone with multiple peaks
- **Access:** Paddle or short boat depending on exact peak and conditions
- **Description:** Long reef area with several peaks, commonly known for lefts and some rights. More forgiving than Cloud 9 and popular with intermediates and longboarders.
- **Agent warning:** Conditions vary widely by tide and swell.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Bumee / Bombee

- **Area:** Offshore / behind Cloud 9 area
- **Skill level:** Intermediate
- **Wave type:** Left-hand reef break
- **Access:** Boat or long paddle
- **Description:** Left-hander near the Cloud 9 zone. Usually less crowded because access is harder.
- **Agent warning:** Recommend local guidance due to boat/reef access.
- **Public info confidence:** Medium-high
- **Source:** Surf Siargao

#### Stimpy’s

- **Area:** Offshore near Rock Island
- **Skill level:** Intermediate to advanced
- **Wave type:** Left-hand reef break
- **Access:** Boat access
- **Description:** Quality left that can handle size and produce hollow sections. Popular with experienced goofy-footers.
- **Agent warning:** Boat-access reef wave; recommend local boatman/guide.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Rock Island

- **Area:** Offshore near General Luna
- **Skill level:** Upper-intermediate to advanced
- **Wave type:** Fast right-hand reef break
- **Access:** Boat access
- **Description:** Fast right with steep drops, current, and hollow sections. Best for experienced surfers.
- **Agent warning:** Do not recommend to beginners.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Tuesday Rock

- **Area:** Offshore near Rock Island
- **Skill level:** Advanced
- **Wave type:** Right-hand reef break
- **Access:** Boat access
- **Description:** Right-hander near Rock Island. Public guides describe it as best with no wind and low-to-mid tide.
- **Agent warning:** Limited public detail; recommend local guide.
- **Public info confidence:** Medium
- **Source:** Patrick’s on the Beach

#### Bombora / Poo Shooter’s

- **Area:** General Luna / Patrick’s side reef area
- **Skill level:** Advanced
- **Wave type:** Fast barreling left-hand reef break
- **Access:** Usually boat or local-access reef route
- **Description:** Fast left with barrel potential on medium-to-large east or southeast swell.
- **Agent warning:** Advanced only; shallow reef and powerful sections.
- **Public info confidence:** Medium
- **Source:** Patrick’s on the Beach

#### Ocean 9

- **Area:** Santa Fe / Catangnan side
- **Skill level:** Beginner
- **Wave type:** Softer bay wave
- **Access:** Shore access depending on exact location
- **Description:** Beginner-friendly zone that needs enough swell wrapping into the bay. Often useful when exposed spots are too strong or blown out.
- **Agent warning:** Verify conditions locally because it may be flat without enough swell.
- **Public info confidence:** High
- **Source:** Surf Siargao

---

### South / Island-Hopping Surf

#### Daku Reef / Daku Island

- **Area:** Daku Island
- **Skill level:** Beginner to intermediate
- **Wave type:** Soft right-hand reef wave
- **Access:** Boat access from General Luna
- **Description:** Scenic, softer reef wave near Daku Island. Common for lessons, longboarding, and relaxed sessions.
- **Agent warning:** Boat access required; reef still present.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Guyam Island

- **Area:** Guyam Island
- **Skill level:** Mixed / condition-dependent
- **Wave type:** Island reef breaks
- **Access:** Boat access
- **Description:** Surf zone around/behind Guyam Island. Public technical detail is limited, but it is listed in local surf references.
- **Agent warning:** Ask locally before going; do not provide strong technical claims.
- **Public info confidence:** Medium-low
- **Source:** Patrick’s on the Beach

#### Pansukian / Pansukyan Reef

- **Area:** South / island reef zone
- **Skill level:** Intermediate to advanced
- **Wave type:** Right-hand reef break
- **Access:** Boat access or resort/local access depending on route
- **Description:** Exposed reef wave that can be hollow and fickle. Public forecasts note strong rips.
- **Agent warning:** Strong current/rip warning. Recommend experienced surfers only.
- **Public info confidence:** Medium-high
- **Source:** Surf-Forecast, Patrick’s on the Beach

#### La-Janoza

- **Area:** Remote southern island zone
- **Skill level:** Intermediate to advanced
- **Wave type:** Remote reef breaks
- **Access:** Boat access
- **Description:** Remote boat-trip surf area grouped with Mamon and Antokon. Public information is thin.
- **Agent warning:** Local-guide-only recommendation.
- **Public info confidence:** Medium-low
- **Source:** Patrick’s on the Beach

#### Mamon

- **Area:** Mamon Island
- **Skill level:** Beginner to intermediate
- **Wave type:** Beach break / island break
- **Access:** Boat access
- **Description:** Island surf area. Public guide mentions a beach break with long rides.
- **Agent warning:** Confirm with local guide because public technical detail is limited.
- **Public info confidence:** Medium
- **Source:** Patrick’s on the Beach

#### Antokon

- **Area:** Remote southern island zone
- **Skill level:** Intermediate to advanced
- **Wave type:** Remote reef breaks
- **Access:** Boat access
- **Description:** Remote island-break zone grouped with La-Janoza and Mamon.
- **Agent warning:** Local-guide-only recommendation.
- **Public info confidence:** Low-medium
- **Source:** Patrick’s on the Beach

#### YoHoHo Secret Break

- **Area:** YoHoHo Islands area
- **Skill level:** Unknown; assume advanced caution
- **Wave type:** Hidden / poorly documented break
- **Access:** Boat access
- **Description:** Publicly listed as a hidden break around the YoHoHo Islands, but technical detail is very limited.
- **Agent warning:** Do not recommend directly without local guidance.
- **Public info confidence:** Low
- **Source:** Patrick’s on the Beach

---

### Guiuan / Union / Southern Beginner Zones

#### Guiuan / Giwan / G1

- **Area:** Southern Siargao
- **Skill level:** Beginner to intermediate
- **Wave type:** Small reef/beach-style wave depending on exact section
- **Access:** Shore access
- **Description:** South-facing winter option often used when exposed General Luna spots are too large or windy. Can be small but fast.
- **Agent warning:** Not always suitable for complete beginners without instruction.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Union

- **Area:** Southern Siargao near Guiuan
- **Skill level:** Beginner to intermediate
- **Wave type:** Southern coast surf break
- **Access:** Shore access
- **Description:** Often grouped with Guiuan and Secret Spot. Useful during winter/northeast monsoon patterns.
- **Agent warning:** Conditions can still be shallow or quick; recommend instructor for first-timers.
- **Public info confidence:** Medium
- **Source:** TurtlePHD

#### Secret Spot / Paradise Surfing

- **Area:** Southern Siargao near Guiuan/Union
- **Skill level:** Beginner to intermediate
- **Wave type:** Southern coast break
- **Access:** Shore access
- **Description:** Scenic beginner-to-intermediate option in the Guiuan/Union cluster.
- **Agent warning:** Local naming may vary; confirm exact spot on arrival.
- **Public info confidence:** Medium
- **Source:** TurtlePHD

#### Paradise

- **Area:** Right of Union / southern Siargao
- **Skill level:** Beginner
- **Wave type:** Beach break
- **Access:** Shore access
- **Description:** Publicly described as a beach break useful in winter when Cloud 9 is blown out.
- **Agent warning:** Avoid confusing with Secret Spot / Paradise Surfing unless the user provides context.
- **Public info confidence:** Medium
- **Source:** Patrick’s on the Beach

---

### Salvacion / Pilar / Santa Fe Side

#### Salvacion

- **Area:** Salvacion
- **Skill level:** Intermediate
- **Wave type:** Protected right-hand wave
- **Access:** Shore or local access
- **Description:** More protected option that can be cleaner when General Luna spots are messy during winter patterns.
- **Agent warning:** Check local access and conditions.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Pilar

- **Area:** Pilar
- **Skill level:** Intermediate
- **Wave type:** Left-hand reef break
- **Access:** Shore/local access
- **Description:** Exposed left-hand reef with reliable autumn/winter surf. Often less crowded than General Luna breaks.
- **Agent warning:** Reef and rocks; local lineup awareness matters.
- **Public info confidence:** Medium-high
- **Source:** Surf-Forecast

#### Shifty’s

- **Area:** Pilar / Santa Fe side
- **Skill level:** Intermediate to advanced
- **Wave type:** Right-hand reef break
- **Access:** Local access
- **Description:** Right-hand reef wave near Pilar/Santa Fe. Fun at moderate size and can hold bigger swell.
- **Agent warning:** Public info limited; recommend local advice.
- **Public info confidence:** Medium
- **Source:** Patrick’s on the Beach

---

### North Siargao / Pacifico / Burgos / Tangbo

#### Pacifico / Big Wish

- **Area:** Pacifico
- **Skill level:** Intermediate to advanced
- **Wave type:** Powerful left-hand reef break
- **Access:** Shore access
- **Description:** Famous north-coast left. Can be bigger, longer, and more powerful than many General Luna waves.
- **Agent warning:** Serious wave in peak swell; not for beginners when solid.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Bamboo Garden / Bamboo

- **Area:** Pacifico area
- **Skill level:** Beginner to upper-intermediate
- **Wave type:** Multiple softer reef sections
- **Access:** Shore/local access
- **Description:** Pacifico-area wave with several sections, including main right, left, and smaller inside learner waves.
- **Agent warning:** Match user skill to section; not all sections are beginner-safe.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Burgos Bay

- **Area:** Burgos
- **Skill level:** Beginner to advanced depending on exact peak
- **Wave type:** Bay with multiple reef waves
- **Access:** Shore/local access
- **Description:** Broad north-coast surf zone with multiple waves, from beginner inside sections to heavier reefs.
- **Agent warning:** Ask which exact Burgos wave the user means if technical advice is needed.
- **Public info confidence:** High
- **Source:** Surf Siargao

#### Innertubes / Inner Tube

- **Area:** Burgos Bay
- **Skill level:** Intermediate to advanced
- **Wave type:** Right-hand reef break
- **Access:** Shore/local access
- **Description:** Burgos-area right-hander often described as an accessible barrel opportunity when conditions align.
- **Agent warning:** Barrel does not mean beginner-safe.
- **Public info confidence:** Medium-high
- **Source:** Surf Siargao

#### Hapiks

- **Area:** Burgos Bay
- **Skill level:** Advanced
- **Wave type:** Fast left-hand reef break
- **Access:** Shore/local access
- **Description:** Fast, technical left in Burgos Bay. Can punish positioning errors.
- **Agent warning:** Advanced only.
- **Public info confidence:** Medium-high
- **Source:** Surf Siargao

#### Cloud 69

- **Area:** Burgos
- **Skill level:** Mixed / local-dependent
- **Wave type:** Burgos-area wave
- **Access:** Local access
- **Description:** Listed among Burgos-area waves, but public technical detail is limited.
- **Agent warning:** Ask locally before giving precise advice.
- **Public info confidence:** Low-medium
- **Source:** Surf Siargao

#### Tangbo Secret Spot / Paradise Beach / Secret Paradise

- **Area:** North tip / Tangbo
- **Skill level:** Beginner to advanced depending on section
- **Wave type:** North coast reef/beach-style sections
- **Access:** Shore/local access
- **Description:** North-tip winter wave with a faster main peak and softer shoulder/down-the-line sections useful for longboarding or learners.
- **Agent warning:** Clarify section and conditions before recommending to beginners.
- **Public info confidence:** High
- **Source:** Surf Siargao

---

### Less-Documented / Ambiguous Public Names

#### Little Pony

- **Area:** Not clearly established from public sources
- **Skill level:** Beginner, according to some public beginner lists
- **Wave type:** Not reliably documented
- **Access:** Unknown
- **Description:** Mentioned in some beginner-oriented public lists, but technical details are sparse.
- **Agent warning:** Do not provide precise route, tide, or safety advice without better source/context.
- **Public info confidence:** Low
- **Source:** Travel Around the Philippines

#### Tombstones

- **Area:** Siargao / nearby surf references
- **Skill level:** Unknown
- **Wave type:** Not reliably documented
- **Access:** Unknown
- **Description:** Mentioned in general surf references, but descriptions are sparse and inconsistent.
- **Agent warning:** Treat as ambiguous/local-only unless user provides more context.
- **Public info confidence:** Low
- **Source:** Travel Around the Philippines

---

## JSON-Like Summary Table

```yaml
spots:
  - name: Cloud 9
    aliases: []
    area: General Luna / Catangnan
    level: advanced_expert
    wave: right_hand_reef
    access: paddle
    confidence: high

  - name: Quiksilver
    aliases: [Quicksilver]
    area: General Luna / Cloud 9
    level: intermediate_advanced
    wave: right_hand_reef
    access: paddle
    confidence: high

  - name: Jacking Horse
    aliases: []
    area: General Luna / Cloud 9
    level: beginner_intermediate
    wave: soft_right_reef
    access: paddle
    confidence: high

  - name: Tuason Point
    aliases: [Tuason]
    area: General Luna
    level: intermediate_advanced
    wave: left_hand_reef
    access: paddle
    confidence: high

  - name: Cemetery
    aliases: [Pesangan]
    area: General Luna
    level: beginner_to_advanced_condition_dependent
    wave: multi_peak_reef
    access: paddle_or_boat
    confidence: high

  - name: Bumee
    aliases: [Bombee]
    area: Offshore Cloud 9 area
    level: intermediate
    wave: left_hand_reef
    access: boat_or_long_paddle
    confidence: medium_high

  - name: Stimpy's
    aliases: []
    area: Offshore near Rock Island
    level: intermediate_advanced
    wave: left_hand_reef
    access: boat
    confidence: high

  - name: Rock Island
    aliases: []
    area: Offshore General Luna
    level: upper_intermediate_advanced
    wave: fast_right_reef
    access: boat
    confidence: high

  - name: Tuesday Rock
    aliases: []
    area: Offshore near Rock Island
    level: advanced
    wave: right_hand_reef
    access: boat
    confidence: medium

  - name: Bombora
    aliases: [Poo Shooter's]
    area: General Luna / Patrick's side reef
    level: advanced
    wave: barreling_left_reef
    access: boat_or_local_reef_access
    confidence: medium

  - name: Ocean 9
    aliases: []
    area: Santa Fe / Catangnan side
    level: beginner
    wave: soft_bay_wave
    access: shore
    confidence: high

  - name: Daku Reef
    aliases: [Daku Island]
    area: Daku Island
    level: beginner_intermediate
    wave: soft_right_reef
    access: boat
    confidence: high

  - name: Guyam Island
    aliases: []
    area: Guyam Island
    level: mixed_condition_dependent
    wave: island_reef
    access: boat
    confidence: medium_low

  - name: Pansukian Reef
    aliases: [Pansukyan Reef]
    area: South island reef zone
    level: intermediate_advanced
    wave: right_hand_reef
    access: boat_or_local
    confidence: medium_high

  - name: La-Janoza
    aliases: []
    area: Remote southern island zone
    level: intermediate_advanced
    wave: remote_reef
    access: boat
    confidence: medium_low

  - name: Mamon
    aliases: [Mamon Island]
    area: Mamon Island
    level: beginner_intermediate
    wave: beach_or_island_break
    access: boat
    confidence: medium

  - name: Antokon
    aliases: []
    area: Remote southern island zone
    level: intermediate_advanced
    wave: remote_reef
    access: boat
    confidence: low_medium

  - name: YoHoHo Secret Break
    aliases: []
    area: YoHoHo Islands
    level: unknown_advanced_caution
    wave: hidden_break
    access: boat
    confidence: low

  - name: Guiuan
    aliases: [Giwan, G1]
    area: Southern Siargao
    level: beginner_intermediate
    wave: southern_coast_break
    access: shore
    confidence: high

  - name: Union
    aliases: []
    area: Southern Siargao near Guiuan
    level: beginner_intermediate
    wave: southern_coast_break
    access: shore
    confidence: medium

  - name: Secret Spot
    aliases: [Paradise Surfing]
    area: Southern Siargao near Guiuan / Union
    level: beginner_intermediate
    wave: southern_coast_break
    access: shore
    confidence: medium

  - name: Paradise
    aliases: []
    area: Right of Union / Southern Siargao
    level: beginner
    wave: beach_break
    access: shore
    confidence: medium

  - name: Salvacion
    aliases: []
    area: Salvacion
    level: intermediate
    wave: protected_right
    access: shore_or_local
    confidence: high

  - name: Pilar
    aliases: []
    area: Pilar
    level: intermediate
    wave: left_hand_reef
    access: shore_or_local
    confidence: medium_high

  - name: Shifty's
    aliases: []
    area: Pilar / Santa Fe side
    level: intermediate_advanced
    wave: right_hand_reef
    access: local
    confidence: medium

  - name: Pacifico
    aliases: [Big Wish]
    area: Pacifico
    level: intermediate_advanced
    wave: powerful_left_reef
    access: shore
    confidence: high

  - name: Bamboo Garden
    aliases: [Bamboo]
    area: Pacifico area
    level: beginner_upper_intermediate
    wave: multi_section_reef
    access: shore_or_local
    confidence: high

  - name: Burgos Bay
    aliases: []
    area: Burgos
    level: beginner_to_advanced_section_dependent
    wave: multi_peak_bay_reef
    access: shore_or_local
    confidence: high

  - name: Innertubes
    aliases: [Inner Tube]
    area: Burgos Bay
    level: intermediate_advanced
    wave: right_hand_reef
    access: shore_or_local
    confidence: medium_high

  - name: Hapiks
    aliases: []
    area: Burgos Bay
    level: advanced
    wave: fast_left_reef
    access: shore_or_local
    confidence: medium_high

  - name: Cloud 69
    aliases: []
    area: Burgos
    level: mixed_local_dependent
    wave: burgos_area_wave
    access: local
    confidence: low_medium

  - name: Tangbo Secret Spot
    aliases: [Paradise Beach, Secret Paradise]
    area: North tip / Tangbo
    level: beginner_to_advanced_section_dependent
    wave: north_coast_sections
    access: shore_or_local
    confidence: high

  - name: Little Pony
    aliases: []
    area: unclear
    level: beginner_reported
    wave: undocumented
    access: unknown
    confidence: low

  - name: Tombstones
    aliases: []
    area: unclear
    level: unknown
    wave: undocumented
    access: unknown
    confidence: low
```

---

## Suggested Agent Response Patterns

### If asked: “Where should a beginner surf in Siargao?”

Recommend Jacking Horse, Daku, Ocean 9, Guiuan/G1, Union, Bamboo inside sections, and softer Tangbo sections. Add that beginners should use an instructor because many Siargao waves still break over reef.

### If asked: “Where should an intermediate surf?”

Recommend Cemetery, Salvacion, Bumee, Daku on bigger days, Bamboo, smaller Pacifico, Pilar, Guiuan/Union when working.

### If asked: “Where are the best barrels?”

Recommend Cloud 9, Pacifico, Rock Island, Stimpy’s, Tuason, Innertubes, Pansukian, Tuesday Rock, Bombora, and Hapiks. Add strong safety warning.

### If asked: “What surf spots are near General Luna?”

Mention Cloud 9, Quiksilver, Jacking Horse, Tuason, Cemetery/Pesangan, Bumee, Stimpy’s, Rock Island, Tuesday Rock, Bombora/Poo Shooter’s, Ocean 9, and Daku by boat.

### If asked: “What surf spots are less crowded?”

Mention Pacifico, Burgos Bay, Salvacion, Pilar, Tangbo, Bumee, and remote island breaks, but warn that access and local knowledge matter.

---

## Data Quality Notes

- High-confidence spots are repeatedly described in public Siargao surf guides.
- Medium-confidence spots are publicly listed but have less technical detail.
- Low-confidence spots are names found in public references but not well documented.
- Local surf schools may know additional breaks not listed here.
- Some names may refer to overlapping zones rather than distinct, fixed GPS points.

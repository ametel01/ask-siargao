# Siargao Nightlife

## Loading Rules

Load this file for party, nightlife, bar-hopping, drinks tonight, DJ, live music,
foam party, pub quiz, trivia, late-night, where-to-go-out, and General Luna night
plan prompts.

This file is stable local-reference memory. It is not live evidence. Use it to
shape the answer, choose the right tools, and understand the island nightlife
mental model. Current event occurrences, opening status, weather, and map details
still require governed tools.

## Stable Planning Model

General Luna nightlife is a sequence, not a directory.

- Early warm-up: a social bar, pub quiz, sports bar, sunset drinks, or live music
  stop where a traveler can meet people before the main crowd gathers.
- Main party: the night's strongest DJ, dance, themed, or scheduled event.
- Late option: louder or more tourist-heavy venue when the main party is not
  enough.
- Softer option: live music, relaxed beachfront drinks, or a less intense bar
  for travelers who do not want a full party.

For "best party places tonight", prefer a route like:

```text
warm-up -> main party -> late option
```

Do not answer with only a generic list of bars unless event sources are
unavailable.

## Common Nightlife Areas

- Tourism Road: central General Luna nightlife spine, easiest for bar hopping.
- Boardwalk / beachfront General Luna: useful for beachfront drinks and sports
  bar starts.
- Cloud 9 / Catangnan: good for surf-area stays but not always the main party
  zone.
- Malinao: quieter stay area; usually requires a tricycle for General Luna
  nightlife.

## Recurring Event Candidates

These are candidate patterns to verify with live/source tools before treating
them as current.

| Venue | Pattern | Source URL | Last verified | Confidence | Caveat |
| --- | --- | --- | --- | --- | --- |
| Barbosa | Monday Golden Hour, Tuesday `Disco Tropico`, Thursday `Odd Ball`, Friday `Bread and Butter` | `https://www.barbosasiargao.com/schedule-1` | 2026-06-30 | high | Official weekly schedule; still check Instagram day-of for guest DJs, cancellations, or private events. |
| BARREL | Tuesday pub quiz / trivia warm-up | `https://siargaovibes.com/activities/tuesdays-pub-quiz-at-barrel/` | 2026-06-30 | medium | Local event listing; verify official social page when possible. |
| Mama Coco | Monday Retro Night, Tuesday Latin Night, Wednesday Reggaeton/Afro/Dancehall, Friday House/Techno | `https://siargaovibes.com/nightlife/mama-coco-siargao-events-schedule/` | 2026-06-30 | medium | SiargaoVibes listing; verify official social page day-of. |
| Goodies | Wednesday Funky Wednesday, 8 PM-midnight | `https://happinessphilippines.com/upcoming-event/` | 2026-06-30 | high | Official Happiness events page; check daily schedule or Instagram for special changes. |
| Bed & Brew | Thursday party, 8 PM-11:59 PM | `https://siargaovibes.com/nightlife/thursdays-at-bed-brew/` | 2026-06-30 | medium | SiargaoVibes listing; verify official venue page/social page day-of. |
| Harana Surf Resort | Saturday two-stage party, usually 9 PM-1 AM | `https://siargaovibes.com/nightlife/saturdays-at-harana/` | 2026-06-30 | medium | Listing event date shown is old, but description says every Saturday; verify Harana official social page for current lineup. |
| Happiness Beach Bar | Sunday Fun Day, 6 PM-midnight | `https://happinessphilippines.com/upcoming-event/` | 2026-06-30 | high | Official Happiness events page; check Instagram for one-off changes. |
| Siargao Beach Club | Tuesday/Saturday foam-party pattern | `https://www.instagram.com/siargaobeachclubph/` | 2026-06-30 | medium | Use official social pages for same-day confirmation; older articles are background only. |
| Sibol | Live-music / softer drinks option | `https://www.siargaolocal.com/business/sibol-siargao/` | 2026-06-30 | medium | Local guide pages describe stable venue fit, not a guaranteed event tonight. |
| El Lobo | Reported Monday/Wednesday/Friday main-night option | `https://smallgirlbigbackpack.com/siargao-nightlife-and-party-schedule/` | 2026-06-30 | low | Guide/community-style signal only; verify official social page before recommending as an anchor. |

Do not add a venue to this table without a source URL or manual verification
note, verification date, weekday/date, time label, confidence, review or expiry
date, and caveat. Stale baseline rows are not same-day truth.

## Weekly Party Map

Use this as a stable planning baseline, not as proof of tonight's event. Before
answering a same-day or date-specific prompt, verify the relevant row with
current event sources and official social pages where possible.

| Day | Early / warm-up | Main party window | Anchor candidates | Best read |
| --- | --- | --- | --- | --- |
| Monday | 5:30 PM+ / 6 PM+ | 8 PM-late | Barbosa Golden Hour, Mama Coco Retro Night, El Lobo | Softer start to the week; Barbosa has the strongest official support, Mama Coco is directory-backed, El Lobo is lower-confidence guide/community signal. |
| Tuesday | 7-9 PM | 9 PM-late | BARREL Pub Quiz, Barbosa Disco Tropico, Mama Coco Latin Night, Siargao Beach Club | Strongest checked Tuesday route: BARREL warm-up, Barbosa main party, Siargao Beach Club late if needed. |
| Wednesday | 7:30-9 PM | 8 PM-midnight / 9 PM+ | Goodies, Mama Coco, El Lobo | Midweek dance night; Goodies is official Happiness-backed, Mama Coco is directory-backed, El Lobo needs official confirmation. |
| Thursday | 5:30 PM+ / 8 PM | 8 PM-late | Bed & Brew, Barbosa Odd Ball | Bed & Brew is the clear directory-backed Thursday anchor; Barbosa has official Thursday party support. |
| Friday | 5:30 PM+ / 6 PM+ | 8-9 PM-late | Barbosa, Mama Coco, El Lobo, Siargao Beach Club | Strong weeknight. Barbosa is official, Mama Coco is directory-backed, El Lobo and Siargao Beach Club need same-day social confirmation. |
| Saturday | 6 PM+ | 9 PM-1 AM | Harana Surf Resort, late Siargao Beach Club | Harana is the main Saturday candidate but the listing date is old; use official Harana social confirmation for current lineup. |
| Sunday | 6 PM | 6 PM-midnight | Happiness Beach Bar / Sunday Fun Day | Sunday anchor is Happiness Beach Bar, backed by the official Happiness events page. |
| Every night / fallback | 4-6 PM happy hour | 9 PM-2 AM | Sibol, Siargao Beach Club | Use as fallback/after-party context only; same-day confirmation still matters. |

For Tuesday-specific prompts, the default route is:

```text
BARREL 7-9 PM -> Barbosa 9 PM+ -> Siargao Beach Club after 11 PM if needed
```

For weekly schedule prompts, show confidence by source class. Do not flatten the
whole week into "high confidence" when some rows are guide/community-backed.

## Source Priority

For nightlife freshness, use sources in this order:

1. Official venue website or schedule page.
2. Official multi-venue event page, such as Happiness events for Goodies and
   Happiness Beach Bar.
3. Local event directory with dated event pages, especially SiargaoVibes.
4. Official venue Instagram post/profile.
5. Official venue Facebook page or public post.
6. Local guide or directory pages for stable venue fit, such as Siargao Local.
7. Travel/news articles for background recurring patterns only.
8. Review/travel platforms for vibe and atmosphere only.
9. Reddit public threads as low-confidence community signal.
10. YouTube videos for atmosphere and geography only.
11. Broad travel blogs for discovery or fallback context.
12. Google Places for venue identity, map links, ratings, and opening-hour
    signals only.
13. Weather provider for late-night rain, storm, or wind context.

Private or semi-private Facebook groups are not valid product sources unless a
user, venue, or partner submits the content with permission.

## Tool Rules

For current nightlife questions:

- Load this file for local context.
- Use source-policy and tool-use memory when source-boundary wording matters.
- Use `research_web` for same-day or date-specific party, DJ, event, and
  "where should we go tonight" prompts. Good query templates include:
  - `General Luna Siargao party tonight [local date or weekday] official`
  - `[venue name] Siargao [weekday/date] event schedule official Instagram`
  - `SiargaoVibes [venue/event] [weekday/date] General Luna`
- Use `search_nightlife_events` when available for current event occurrences.
- Use Google Places tools only to enrich venues selected by `research_web` or
  `search_nightlife_events` with map, address, business status, ratings, and
  opening-hour signals.
- Use weather tools for tonight routes that require moving between venues.

If `search_nightlife_events` is unavailable or returns no events, do not claim a
current event check. If `research_web` also fails or is insufficient, give
bounded stable guidance from this file only with a practical caveat that current
public evidence could not be verified. Do not turn broad Google Places bar
results or weather into the party ranking.

## Answer Shape

Answer the move first:

```text
Tonight's strongest route in General Luna is:

1. Warm-up: ...
2. Main party: ...
3. Late option: ...
4. Softer option: ...
```

Then add one short practical note for weather or transport when relevant.

Structured source boundary for metadata, not normal traveler prose:

```text
checked: event schedule sources and Google Places venue details.
notChecked: live crowd size, door policy, table availability, or last-minute
cancellations.
```

Avoid:

- "Here are the top-rated bars" when the user asked where the party is.
- Ranking nightlife from Google Places relevance alone.
- Treating "open now" at morning or afternoon request time as proof a place is
  the best party tonight.
- Claiming "locals say" without a governed source.
- Using Reddit or YouTube as final truth for tonight's event.

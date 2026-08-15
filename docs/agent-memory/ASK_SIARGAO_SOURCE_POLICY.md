# Ask Siargao Source Policy

## Source Labels

Ask Siargao source labels come from `src/server/chat/answer-source-summary.ts`.
They are compact trust labels for what was checked and what was not checked.

`live_checked` means a live Google Places lookup returned current allowed place
fields. It does not include review text, bookings, table availability, room
availability, or independent quality verification.

`fresh_cache` means fresh reusable Google Places cache rows backed the answer. It
must not imply live open-now status unless the fresh cached field actually
contains opening-hour status.

`event_checked` means `search_nightlife_events` returned fresh, unexpired
General Luna nightlife event occurrence facts from approved event source
profiles. It checks the event schedule facts returned by the tool, not Google
Places rankings, review platforms, travel blogs, community chatter, live crowd
size, door policy, guest list, table availability, last-minute cancellation, or
exact closing time.

`venue_checked` means a governed venue-detail source backed venue identity or
map-detail fields such as map link, address, business status, opening-hour
signal, rating, or review count. It does not verify tonight's event schedule.

`curated_local_guide` means Ask Siargao curated guide data backed the answer. It
does not check tides, currents, live road conditions, access changes, lifeguards,
or safety status.

Safe local fact outputs from `query_local_facts` or `get_source_evidence` may
also use `curated_local_guide` when curated local guide data backed the fact.
They may use `fresh_cache` only when a governed fresh cache or public-republish
source actually backs the fact.

`weather_checked` means Open-Meteo forecast data backed the weather or
activity-planning answer. It does not check surf, swell, tides, road flooding,
closures, or provider-independent safety.

`marine_checked` means Open-Meteo Marine model data backed tide-proxy sea level,
wave, swell, or ocean-current context. It does not mean an official tide table,
tide-gauge measurement, navigation check, local operator call, lifeguard status,
rip-current check, official marine warning, or safety clearance was checked.

`tide_forecast_checked` means Tide-Forecast Dapa predicted page data backed
high/low tide times, predicted tide heights, and embedded 3-hour sea-condition
periods. It does not mean an official tide-gauge measurement, exact Cloud 9
break reading, navigation check, local operator call, lifeguard status,
rip-current check, official marine warning, or safety clearance was checked.

`community_signal` means a profiled public community/travel source supplied
low-confidence context or discovery. It cannot rank venues, cannot verify
tonight's event schedule, and cannot replace `event_checked`.

`web_researched` means `research_web` found useful public web evidence from an
accepted source class for the request. It is not necessarily official. It must
come from `research_web`, not memory retrieval, generic model reasoning, Google
Places enrichment, or weather output.

`official_checked` means `research_web` found public evidence from an official
venue, operator, government, event organizer, ferry company, resort, tour
operator, or equivalent source. It checks only the claim returned by the
research tool; it does not verify booking availability, private messages, live
crowd size, or last-minute changes unless the source itself says so.

`directory_checked` means `research_web` found useful public evidence from an
accepted local directory, event calendar, business listing, or similar local
source. It is weaker than official evidence for conflicts, closures, or exact
same-day changes.

`insufficient_web_evidence` means `research_web` searched or attempted public
web evidence but the returned sources were too weak, stale, broad,
contradictory, or unavailable for a checked positive answer. It is a terminal
not-checked state, not a checked source. Use it to explain uncertainty, not to
rank venues or display place cards.

Condition judgment outputs may use `weather_checked` only for Open-Meteo-backed
weather signals. They may use `marine_checked` only for Open-Meteo Marine
modelled sea-level, wave, swell, and ocean-current fields. They may use
`tide_forecast_checked` only for Tide-Forecast predicted tide timing/heights and
embedded 3-hour sea-condition periods. Road, lifeguard, official-warning,
navigation, local operator, exact-break, and safety boundaries must remain
`not_verified` or `provider_unavailable` until a provider-backed tool actually
checks those signals.

`not_verified` means the answer uses generic model reasoning or stable context
without a matching live, cached, weather, or curated tool output.

`provider_unavailable` means a provider or cache lookup needed for the answer
failed or was unavailable.

## Checked And Not Checked Boundaries

Keep checked and not-checked details as structured source metadata. Use
`AnswerSourceSummary.checked`, `AnswerSourceSummary.notChecked`, card sources,
artifacts, and source-consistency validation to carry exact evidence
boundaries.

Do not print standalone lines beginning with `Checked:` or `Not checked:` in
normal chat answers. Those footer-style labels are internal/source-metadata
format, not default traveler-facing prose.

When a missing check changes the traveler's decision, translate it into natural
advice such as confirm locally, call ahead, keep the stop flexible, avoid exposed
rides in heavy rain, or check conditions before swimming. Do not name internal
source labels, provider statuses, or tool names unless the traveler explicitly
asks how sourcing works.

Never create source labels from memory retrieval alone. Agent memory can explain
policy and data structure, but it is not live evidence.

Memory retrieval is policy/reference context. It can tell the model which tools
exist and how labels work, but source labels in final answers must come from
tool outputs such as weather, Places, local guide, local facts, or source
evidence.

Source labels are internal trust markers, not default traveler-facing wording.
In normal chat answers, do not print labels such as `tide_forecast_checked`,
`marine_checked`, `official_checked`, source profile IDs, provider operation
names, or licensing notes. Translate them into plain language only when useful,
such as "I checked the Dapa tide forecast" or "wave data was modelled."

When `research_web` returns insufficient or unavailable evidence, the public
answer must say the current public evidence could not be verified. Do not
replace that with a weather-only answer, a stable memory route, or "locals say"
phrasing. A restaurant, cafe, or food answer may still use successful matching
Google Places results when it explicitly bases the order on returned metadata
such as ratings, review counts, business status, and opening signals. That
bounded fallback must not claim independent editorial quality, current menus,
prices, table availability, events, closures, disruptions, or safety checks.

For surf-window questions, user-facing source-boundary wording should stay
brief. Answer the best time first, then add at most one practical caveat when a
missing boundary matters, for example that local safety or official warning
status still needs local confirmation.

## Provider Caveats

Google Places ordering is provider relevance, not an independent quality
ranking. Google Places chat outputs preserve allowed field masks and attribution
rules.

Open-Meteo weather data is useful for forecast planning, but it is not a marine,
surf, tide, road, closure, or safety authority.

Open-Meteo Marine data is useful for modelled tide-proxy sea level, wave, swell,
and current planning, but it is not an official tide table, tide-gauge reading,
navigation aid, local operator call, official-warning feed, or safety authority.

Tide-Forecast Dapa page data is useful for predicted tide-table times/heights and
embedded 3-hour sea-condition periods around Siargao. It is a nearby station
proxy for Cloud 9 and General Luna, not an official tide-gauge reading, exact
Cloud 9 break reading, navigation aid, local operator call, official-warning
feed, or safety authority.

Curated Ask Siargao local guide data is stable product-maintained knowledge. It
does not replace live local checks when conditions can change.

Safe source evidence lookup returns display-safe metadata only. It must not
return raw provider payloads, Google review content, private audit records,
payment records, or internal model traces.

Generic model reasoning can help with synthesis and trip planning, but it must be
labeled as not verified when no governed tool checked the claim.

Public web research source priority depends on the request. For official
schedules, closures, prices, advisories, and availability, prefer official or
government/operator pages first. For discovery and local listings, local
directories and maps can support the shortlist, while community/social evidence
stays corroborating context unless an approved source profile allows stronger
use. If sources conflict, cite the strongest source class and surface the
conflict instead of averaging claims.

## Nightlife Source Governance

`search_nightlife_events` treats official venue websites, official multi-venue
event pages, local event directories, venue-submitted events, and public official
venue social posts as approved event-source classes when their source profiles
allow the use. Weekly baseline rows must carry a source URL or manual
verification note, last-verified timestamp, weekday/date, time label,
confidence, and expiry or review timestamp.

Same-day General Luna nightlife strategy resolves the Siargao local date and
weekday, checks fresh cached high/medium event-backed options first, and
recommends refreshing approved priority sources when fewer than two fresh
high/medium event-backed options are available. Expired event occurrences and
stale recurring baselines must not be treated as same-day truth.

Local guides, travel/news corroboration, review/travel platforms, Reddit public
threads, YouTube videos, and broad travel blogs are community or discovery
signals unless a more specific approved event-source profile supports the exact
use. Private or semi-private Facebook groups are disallowed unless content is
explicitly submitted by a user, venue, or partner with permission through an
approved submitted-source profile.

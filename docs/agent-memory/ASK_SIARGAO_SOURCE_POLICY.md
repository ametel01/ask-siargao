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

`curated_local_guide` means Ask Siargao curated guide data backed the answer. It
does not check tides, currents, live road conditions, access changes, lifeguards,
or safety status.

`weather_checked` means Open-Meteo forecast data backed the weather or
activity-planning answer. It does not check surf, swell, tides, road flooding,
closures, or provider-independent safety.

`not_verified` means the answer uses generic model reasoning or stable context
without a matching live, cached, weather, or curated tool output.

`provider_unavailable` means a provider or cache lookup needed for the answer
failed or was unavailable.

## Checked And Not Checked Wording

Use "Checked:" lines only for tool-backed facts represented by verifying source
labels: `live_checked`, `fresh_cache`, `curated_local_guide`, and
`weather_checked`.

Use "Not checked:" lines for missing fields, unavailable providers, generic
reasoning boundaries, or facts that the tool did not verify.

Never create source labels from memory retrieval alone. Agent memory can explain
policy and data structure, but it is not live evidence.

## Provider Caveats

Google Places ordering is provider relevance, not an independent quality
ranking. Google Places chat outputs preserve allowed field masks and attribution
rules.

Open-Meteo weather data is useful for forecast planning, but it is not a marine,
surf, tide, road, closure, or safety authority.

Curated Ask Siargao local guide data is stable product-maintained knowledge. It
does not replace live local checks when conditions can change.

Generic model reasoning can help with synthesis and trip planning, but it must be
labeled as not verified when no governed tool checked the claim.

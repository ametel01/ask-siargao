# Run Siargao Field Research

Use this playbook to collect repeatable, first-hand Siargao observations that can later support Ask
Siargao chat answers and claims on the current `/guides` pages. It is written for an iPad-first field
workflow based in Del Carmen, beginning Saturday, 22 August 2026.

This is a collection and review procedure. It does not make an observation publishable, turn one
experience into a universal claim, or establish local residence before the move has actually taken
place.

## Outcome

At the end of the first 14-day baseline sprint, aim to have:

- a structured record of every field visit, including unsuccessful visits;
- measured examples of the main airport, port, road, and visitor routes;
- time- and condition-bounded observations across Del Carmen, General Luna, Dapa, Pilar, and the
  north of the island;
- coverage of essential services, practical constraints, accessibility barriers, connectivity, and
  payment behavior;
- rights-aware photos, receipts, posted notices, route traces, and attributed statements;
- a discrepancy list for every material claim in the current planning guides;
- a validated but private batch ready for editorial review and eventual database ingestion.

Do not optimize for the number of places visited. Optimize for complete, interpretable records.

## Non-Negotiable Evidence Rules

1. Record what happened, where, when, how it was measured, and under what conditions.
2. Separate direct observation from inference, memory, hearsay, operator statements, and official
   information.
3. Never write “always,” “safe,” “accessible,” “reliable,” “best,” or “local favorite” from one visit.
4. Capture negative results: closures, failed payments, no signal, wrong map pins, long waits,
   inaccessible paths, unclear pricing, and abandoned trips are useful evidence.
5. Preserve uncertainty. “Unknown” is valid data.
6. Ask before interviewing, recording audio, photographing a person as the subject, or publishing a
   quote.
7. Treat homes, children, vulnerable sites, exact private access routes, contact details, and precise
   coordinates as restricted.
8. Do not conduct risky tests to obtain data. Fieldwork does not override weather, marine, road,
   medical, property, operator, or local-authority instructions.
9. Upload is not publication. A second editorial decision is required before a record can become an
   agent-readable fact or a guide claim.
10. Never “clean up” a surprising result in place. Add a correction or a repeat observation.

## The Evidence Ladder

Label each item at capture time:

| Level | Label | Example | What it supports |
| --- | --- | --- | --- |
| 1 | Direct observation | The entrance was open at 08:12 on Tuesday. | Only that observed state and time. |
| 2 | Instrument measurement | A named carrier produced a measured speed and latency. | That device, plan, spot, time, and test method. |
| 3 | Transaction record | A receipt shows the amount paid for a defined item. | That transaction, not a universal tariff. |
| 4 | Official posted notice | A dated tariff or hours sign was photographed. | What the notice stated when observed. |
| 5 | Operator statement | Staff described tomorrow's departure process. | An attributed operational statement requiring freshness. |
| 6 | Community statement | A resident described a recurring local constraint. | A lead or attributed perspective, normally requiring corroboration. |
| 7 | Derived conclusion | Several route runs suggest a planning range. | A reviewed synthesis with all supporting observations linked. |

The number is not a quality score. A direct observation can be incomplete; an official source may be
better for regulations, warnings, or schedules.

## Before 22 August 2026

### Prepare the iPad

- Update iPadOS and the apps used for Files, Camera, Notes, Numbers, Maps, and Shortcuts.
- Enable a device passcode, automatic lock, Find My, and encrypted device backup.
- Confirm that the field folder is available offline. Do not assume an iCloud placeholder is present
  without opening it while disconnected.
- Disable automatic public photo sharing and check whether photos retain location metadata.
- Carry a power bank, charging cable, weather-resistant pouch, microfiber cloth, and a paper backup
  card with emergency contacts.
- If available, bring a second phone or hotspot on a different carrier for comparison. Record the
  exact device, carrier, plan class, and test method.
- Download offline map areas where supported, but treat every map pin as provisional until physically
  checked.
- Set the iPad time zone to automatic and confirm `Asia/Manila` before each field day.

### Create the capture workspace

Until the protected field recorder and bulk importer are implemented, create this structure in Files:

```text
Ask Siargao Field Research/
├── 00-method/
├── 01-inbox/
├── 02-validated/
├── 03-needs-review/
├── 04-exported-batches/
└── 2026-08-island-baseline/
    ├── visits/
    ├── observations/
    ├── statements/
    ├── route-runs/
    ├── assets-private/
    ├── assets-redacted/
    └── daily-logs/
```

Keep private originals out of shared photo albums. Never use a public filename containing a person's
private contact details.

### Configure a day-one Shortcut

Create one Shortcut named `Ask Siargao Field Capture`. The exact exported batch schema in the
[field research data model](../reference/field-research-data-model.md) is authoritative. The Shortcut
should do the following:

1. Generate a UUID for the record.
2. Get the current date and time.
3. Ask whether location may be captured; when allowed, save coordinates and reported accuracy.
4. Ask for campaign, visit, subject, observation kind, directness, value, unit, method, conditions,
   confidence, caveat, and review window.
5. Default all LLM, article, quotation, and public-use permissions to false.
6. Offer to select a photo, scan, audio recording, or receipt. Do not start audio covertly.
7. Save one UTF-8 JSON file per record in `01-inbox/`, named by UUID.
8. Save selected assets by their own UUID and preserve the association in the record.
9. Show a final confirmation with subject, kind, time, and unsynced record count.

One-file-per-record is safer than repeatedly rewriting a large offline file. A later packaging step can
convert these records to JSON Lines and add a hashed manifest.

If the Shortcut is not ready on day one, use the blank forms in this playbook. Do not improvise a
different column layout every day.

### Establish privacy and consent language

Use plain language before an interview or identifiable recording:

> I am collecting first-hand information for Ask Siargao. May I take notes? May I use a paraphrase
> in chat answers or travel guides? May I name you or your business? May I record audio or a photo?
> You can choose any of these separately and can ask me to stop.

Record each allowed scope separately. If the answer is ambiguous, keep the material internal and do
not quote or identify the speaker.

### Create the initial guide-claim inventory

Before leaving, list every verifiable claim in:

- `/guides/complete-siargao-travel-guide`;
- `/guides/siargao-first-timer-guide`;
- `/guides/siargao-3-day-itinerary`;
- `/guides/siargao-5-day-itinerary`;
- `/guides/siargao-7-day-itinerary`;
- `/guides/best-time-to-visit-siargao`;
- `/guides/siargao-by-month`.

Give each claim a stable key and classify it as identity, route, price, hours, practical service,
physical attribute, seasonal pattern, recommendation, safety-sensitive, or editorial judgment. Mark
claims that cannot be validated safely through one person's fieldwork.

## Standard Field-Day Cycle

Run the same cycle every day so records are comparable.

### 1. Morning risk and route check

Before departure:

- check current official weather, warnings, operator messages, and access notices;
- check the day's tide context when the activity depends on it;
- write down the source and retrieval time instead of relying on a screenshot alone;
- confirm the planned transport, fuel or charging, cash, water, return route, and daylight margin;
- tell a trusted person the route and expected check-in time for remote or boat work;
- choose the primary assignment and a safe inland fallback.

Cancel or substitute the assignment when conditions, instructions, health, access, or transport make
it unsuitable. Record the cancellation reason as operational evidence.

### 2. Start a visit

At the actual arrival point:

- generate the visit ID;
- capture the observed subject name and map pin;
- capture time, coordinates and accuracy when appropriate;
- select purpose codes;
- describe current weather, road, tide, crowd, noise, and disruption context;
- take an orientation photo only when safe and respectful;
- record whether the subject matches an existing entity or needs resolution.

### 3. Walk the visitor journey

Experience the sequence a traveler would follow:

1. Find the place or pickup point from a common approach.
2. Identify signage and ambiguity.
3. Record parking, drop-off, walking surface, stairs, slopes, gates, shade, and shelter.
4. Ask for or observe the process, price, wait, payment, inclusions, and restrictions.
5. Use the service only when it is normal, safe, lawful, and genuinely needed for the research.
6. Record toilets, water, seating, power, connectivity, accessibility features and barriers.
7. Record exit, onward transport, last-mile ambiguity, and return constraints.

Do not turn an inspection into disruption. Buy something when prolonged observation would otherwise
consume a small operator's time or space.

### 4. Capture atomic observations

Create a separate record whenever the subject, kind, time, method, directness, use rights, or
freshness changes. Examples:

- observed open at 08:12;
- photographed posted hours at 08:13;
- staff said holiday hours differ at 08:18;
- paid PHP 350 for a defined item at 08:26;
- GCash succeeded but a card was not offered at 08:27;
- measured 18 Mbps down on one carrier at one table at 08:35;
- toilet was present, reached by two steps, at 08:39.

Those are seven records, not one paragraph.

### 5. Close the visit

Before leaving:

- capture the departure time;
- reconcile assets with observation IDs;
- mark unknowns, contradictions, and required follow-ups;
- check consent scopes;
- record what was not tested;
- save a local export and verify that at least one copy opens offline.

### 6. Evening evidence desk

On the same day:

- review every record while context is fresh;
- rename assets by UUID without altering originals;
- transcribe only consented audio and mark exact quotes versus paraphrases;
- remove obvious duplicates while preserving intentional repeats;
- split compound notes into atomic records;
- flag possible safety, privacy, legal, conflict-of-interest, or reputational concerns;
- compare the day's results with existing guide claims;
- create tomorrow's follow-up list;
- export a daily private backup.

Do not change a measured value because it “looks wrong.” Mark it for repeat measurement.

## Fourteen-Day Baseline Itinerary

This itinerary begins with the user's planned move on Saturday, 22 August 2026. Place names are
research assignments, not current endorsements, promises of access, or operating-status claims.
Verify official notices, weather, tide, transport, permission, and opening status before every trip.
Swap days freely when conditions require it.

### Day 1 — Saturday, 22 August: move-in and instrument baseline

Area: Del Carmen home base.

Objectives:

- establish the private home-base pin without making it public;
- test offline files, Shortcut capture, timestamps, location permission, camera metadata, backup, and
  power-bank endurance;
- walk the immediate neighborhood in daylight;
- identify water, food, fuel, pharmacy, clinic, cash, transport, and mobile-signal options nearby;
- run repeat connectivity measurements inside and immediately outside the house;
- begin a household practicalities log: water interruptions, power events, waste arrangements,
  insects, noise, rain exposure, and transport availability.

Do not publish the home address, exact coordinates, security details, or a residence claim until the
move has occurred and the wording is intentionally approved.

### Day 2 — Sunday, 23 August: Del Carmen town and visitor essentials

Area: Del Carmen center, public market area, municipal/visitor information points, transport nodes,
and publicly accessible waterfront approaches.

Collect:

- orientation and wayfinding from the home-base area;
- actual route time by chosen mode, including start/end definitions;
- public transport pickup behavior and an observed example fare when a real trip occurs;
- cash, GCash, card, ATM, pharmacy, clinic, fuel, food, water, toilet, shade, and connectivity
  observations;
- public opening signals and posted service information;
- accessibility barriers and features measured as specific facts;
- questions that only the municipality, tourism office, port, protected-area management, or an
  operator can authoritatively answer.

### Day 3 — Monday, 24 August: Sayak Airport arrival journey

Route: Sayak Airport to Del Carmen, with a comparison lead for General Luna.

Collect one genuine end-to-end route run where feasible:

- arrival point and where transport is actually found;
- signage, pickup process, wait, negotiation or posted tariff basis;
- transport type, party and luggage assumptions;
- departure and arrival timestamps, stops, road conditions, distance, and amount actually paid;
- accessibility and luggage-handling observations;
- carrier signal at the terminal, pickup area, and destination;
- ambiguity a first-time visitor would encounter.

Do not state a standard fare or universal duration from one trip.

### Day 4 — Tuesday, 25 August: General Luna and Cloud 9 visitor journey

Area: General Luna center, Tourism Road/Catangnan approaches, and Cloud 9 public visitor areas when
open and appropriate.

Collect:

- the journey from Del Carmen, including route choice and conditions;
- parking, drop-off, walking, ticket or entrance process when applicable;
- cash/card/GCash examples, public toilets, water, seating, shade, and connectivity;
- crowd snapshots using defined boundaries and time bands;
- accessibility barriers without assigning a generic accessibility label;
- separation between surf-viewing information and any safety or competency advice;
- map-pin, naming, and neighborhood-boundary discrepancies.

### Day 5 — Wednesday, 26 August: remote-work and connectivity transect

Areas: Del Carmen plus selected public work locations in General Luna or Catangnan.

At each location, record:

- exact table or zone, indoor/outdoor, time, weather, and crowd;
- carrier, network type, device, plan class, and signal indicator;
- three standardized speed/latency tests separated by at least two minutes;
- Wi-Fi SSID represented by a privacy-safe label, login method, price or purchase requirement;
- socket availability, observed power event, backup-power statement and its directness;
- seating, noise method, call suitability, air movement, heat, and rain exposure;
- payment transaction and receipt when making a genuine purchase.

Never publish credentials, private network names, device identifiers, or a guarantee of future
connectivity.

### Day 6 — Thursday, 27 August: Dapa port and service hub

Area: Dapa public port approaches, town services, market, transport loading areas, and practical
visitor facilities.

Collect:

- the Del Carmen-to-Dapa route run;
- arrival/departure sequence from the perspective of a traveler with luggage;
- public signage and official posted information;
- real transaction examples for onward transport when genuinely taken;
- pharmacy, clinic/hospital access lead, ATM/cash, market, fuel, toilets, shade, food, and signal;
- accessibility barriers, lighting, shelter, and wayfinding;
- leads requiring authoritative confirmation about ferry operations or port rules.

Schedules and navigation instructions must come from current authorized sources, not observation
alone.

### Day 7 — Friday, 28 August: Maasin, Malinao, and south/central route context

Areas: publicly accessible stops along a coherent route through central or southern island locations.

Collect:

- road surface and route-time observations by segment;
- safe pull-off, parking, pedestrian, and wayfinding conditions;
- current access process at any visited attraction;
- pricing, facilities, payment, toilets, shade, and signal;
- evidence for or against itinerary transitions currently described in the guides;
- map pins and names requiring entity resolution.

Avoid roadside stopping where it would create risk. Do not photograph private property as an
attraction without permission.

### Day 8 — Saturday, 29 August: buffer, weather substitution, and data audit

Primary purpose: no required travel.

- run the first batch validation dry run once tooling exists, or manually audit required fields;
- inventory missing hashes, IDs, consent, timestamps, subject resolution, and assets;
- repeat nearby failed measurements;
- compare week-one evidence against the guide-claim inventory;
- schedule corrections and authoritative-source questions;
- rest and avoid allowing the project to create unsafe fatigue.

Use this day for a missed assignment only when conditions and energy permit.

### Day 9 — Sunday, 30 August: San Isidro, Pacifico, and Burgos

Areas: public visitor and community service locations along the northbound route.

Collect:

- segment-by-segment travel time and road conditions;
- food, fuel, cash, pharmacy/clinic leads, toilets, water, and signal;
- beach access, parking, surface, shade, and observed conditions;
- public operating signals and real purchases;
- remote-work measurements at selected locations;
- differences between a short visitor stop and practical longer-stay needs.

Do not infer swimming or surf safety. Record environmental conditions and refer safety questions to
current competent authorities or qualified operators.

### Day 10 — Monday, 31 August: Santa Monica and Alegria

Areas: northern settlements and publicly accessible visitor locations.

Collect:

- Del Carmen route options and a complete route run;
- transport availability observed at defined times;
- facilities, access surfaces, shelter, food, fuel, cash, signal, and public services;
- crowd and noise snapshots;
- guide assumptions that become impractical when based from Del Carmen or without a scooter;
- return-journey constraints before committing to the outbound trip.

### Day 11 — Tuesday, 1 September: Pilar and Magpupungko assignment

Area: Pilar plus Magpupungko access only when officially open and conditions are appropriate.

Collect:

- tide source and retrieval time, while keeping modeled context distinct from an official table;
- approach route, parking/drop-off, entrance process, paid amount, inclusions, and receipt;
- observed access state at specific times;
- toilets, changing, food, water, shade, surface, stairs, and signal;
- exact condition-specific limitations;
- a second observation at a materially different time only when safe and permitted.

Do not turn a tide-dependent observation into an evergreen schedule or safety claim.

### Day 12 — Wednesday, 2 September: Del Carmen mangrove and Sugba Lagoon journey

Area: Del Carmen departure journey and only the destinations served by an authorized, operating
provider under suitable conditions.

Collect:

- booking channel, lead time, meeting point, check-in, wait, party-size basis, price actually paid,
  inclusions, exclusions, and payment method;
- operator identity and proof that public quotation or photography is permitted;
- departure/return times and transfer durations;
- boat boarding surface, steps, handholds, shade, seating, toilet and water access;
- weather/sea context, interruptions, waste practices, and visitor briefing content;
- each stop as a separate subject and visit segment;
- what happens when a trip cannot operate, only from current written policy or an attributed operator
  statement.

Follow the protected-area and operator rules. Do not collect navigation tracks for public use,
disturb wildlife, reveal sensitive habitats, or describe the trip as safe based on participation.

### Day 13 — Thursday, 3 September: accessibility and no-scooter scenario

Area: one realistic traveler journey chosen from Del Carmen, Dapa, or General Luna.

Run a scenario without using a scooter. If possible, carry ordinary luggage without creating a
health risk. Record:

- booking burden and response time;
- pickup precision, waiting, fare basis, transfer steps, and payment;
- surface, curb, stair, doorway, toilet, seating, shelter, and luggage barriers;
- where assistance was offered and whether it was requested;
- what is directly observed versus reported by staff;
- realistic fallback options when one link fails.

Describe barriers and dimensions. Do not claim that a place is accessible to all disabilities.

### Day 14 — Friday, 4 September: repeat checks and baseline close

Choose the highest-value conflicts or gaps from the first 13 days.

- repeat volatile prices, route times, signal measurements, and opening observations;
- revisit a closed or ambiguous place at a different daypart;
- corroborate a high-impact local caveat;
- resolve provisional entity names and duplicate map pins;
- close every consent question;
- produce the baseline coverage report and candidate fact list;
- keep all candidate facts private until review.

## Optional Assignments After The Baseline

Schedule these only after the core practical network is covered:

- a genuine Surigao City–Dapa ferry journey;
- a tri-island or other boat trip with an authorized provider;
- accommodation check-in/out journeys with explicit host permission;
- night transport and lighting observations conducted with a safe plan;
- wet-weather repeats of important road and visitor journeys;
- longer-stay household practicalities across several weeks;
- local events or seasonal closures observed in context;
- operator interviews designed around a narrow, consented fact set.

## Place Coverage Matrix

Use this matrix to prevent attractive destinations from crowding out practical evidence.

| Zone | Required subject types | Minimum repeat pattern |
| --- | --- | --- |
| Del Carmen | home-base practicalities, town services, airport link, mangrove/lagoon departure | three dayparts plus wet/dry repeat where possible |
| General Luna/Catangnan | visitor arrival, food/payment, Cloud 9, work connectivity, no-scooter journey | weekday/weekend and two dayparts |
| Dapa | port journey, transport, market, cash, health/pharmacy, fuel | arrival and departure windows |
| Pilar | town practicalities, Magpupungko route and condition-dependent access | two tide contexts only when safe and meaningful |
| San Isidro/Pacifico/Burgos | north route, beach access, services, connectivity | weekday/weekend or two dayparts |
| Santa Monica/Alegria | long-route practicality, return constraints, services | one full route plus one targeted repeat |
| South/central corridor | road segments, Maasin/Malinao/Doot/Guiwan transitions | two route runs under recorded conditions |
| Boat destinations | booking, check-in, boarding, operator, facilities, conditions | each operator/trip separately; never merge |

## What To Collect

### Identity and entity resolution

- observed name exactly as displayed;
- official or operator name separately from colloquial name;
- aliases, spelling variants, and language variants;
- category and subcategory;
- area, barangay when verified, map pin, coordinates, and reported accuracy;
- entrance, pickup point, and actual service location when they differ;
- duplicate or misleading map listings;
- public contact channel only when the operator makes it public and use is permitted.

### Access and route

- defined origin and destination;
- mode, operator, booking method, party size, luggage, and accessibility needs;
- request, pickup, queue, departure, stop, and arrival times;
- distance and device/method;
- road/surface/lighting/shelter observations by segment;
- parking/drop-off, last-mile walk, stairs, slope, handrails, gates, and obstructions;
- actual price paid, currency, unit, inclusions, receipt, and negotiation context;
- failed route attempts and fallback used.

### Operations and service

- open or closed at the observation instant;
- posted hours as a separate photographed statement;
- operator-stated exceptions, seasonal behavior, booking cutoff, or capacity, with attribution;
- queue length, wait, service start and end;
- booking and cancellation process actually used;
- payment methods attempted, offered, accepted, or rejected;
- whether a receipt was offered or provided;
- language used during the interaction, without rating staff or inferring fluency broadly.

### Facilities and accessibility

- entrance width, steps, slope, surface, handrails, and thresholds when relevant;
- toilet presence, route to it, steps, door width, and observed condition;
- seating, shade, shelter, drinking water, changing, shower, bins, and lighting;
- parking and drop-off distance;
- stroller, mobility-device, sensory, hearing, or vision barriers only as specific observations;
- assistance offered or requested;
- what was not inspected.

### Food and drink

- exact menu item and availability time;
- price, portion context, taxes/service charge if visible, and actual amount paid;
- ingredients or dietary claims only from labels or attributed staff statements;
- preparation-time observation and queue context;
- payment, receipt, seating, toilets, water, shade, noise, and connectivity;
- photo/quotation permission for menus when needed for republication.

Do not infer allergy safety, food hygiene compliance, or certification.

### Connectivity and power

- carrier or Wi-Fi source using a privacy-safe name;
- device model, OS version, network type, test service, server selection behavior, and VPN state;
- three download, upload, and latency measurements with timestamps;
- exact measurement zone and whether indoor/outdoor;
- crowd, rain, outage, and power context;
- socket availability and whether use was permitted;
- observed outage versus staff-reported backup power;
- whether a real call or work session succeeded, without exposing its content.

### Environmental and experiential context

- weather observed at the place and current authoritative source reference;
- tide or sea context, source, and limitation;
- surface condition, shade, shelter, heat, standing water, dust, mud, and insects;
- crowd count or controlled band within a defined boundary;
- noise reading or structured method;
- visible waste, erosion, damage, construction, or access obstruction;
- personal reaction in a private note, separate from factual observations.

Do not publish ecological interpretations without qualified corroboration.

### Photos, video, audio, receipts, and documents

- asset UUID and linked observation IDs;
- capture time, coordinates/accuracy when appropriate, device, mime type, size, and SHA-256;
- original private object and redacted derivative relationship;
- subject, purpose, rights, consent, people present, and redaction need;
- sign/menu/document owner and whether reproduction is allowed;
- receipt merchant, date, items, total, and redaction of unrelated transaction details;
- reason an asset is unusable or blocked.

Never use a screenshot as the only provenance. Record the source URL, issuer, retrieval time, and
what the screenshot supports.

### Interviews and local statements

- speaker role and their basis for knowing;
- named, role-only, anonymous, or not-publishable attribution choice;
- exact quote or clearly labeled paraphrase;
- question asked, response time, location, and context;
- separate consent for notes, quote, name, audio, image, LLM use, article use, and public use;
- expiry or recontact date for operational claims;
- conflicting statements and whether an authoritative source can resolve them;
- withdrawal route.

Do not ask for unrelated personal history, identity documents, private addresses, or sensitive traits.

## Blank Visit Form

```text
Visit ID:
Campaign:
Methodology/schema version:
Observer key:
Subject ID or provisional name:
Subject type:
Purpose codes:
Started at (with offset):
Ended at (with offset):
Local time zone:
Coordinates captured? yes/no
Private coordinates and accuracy:
Public location precision:
Weather/road/tide/crowd/noise context:
Arrival and visitor-journey notes:
Unknowns:
Contradictions:
Follow-up required:
Linked observation IDs:
Linked asset IDs:
Daily backup verified: yes/no
```

## Blank Atomic Observation Form

```text
Observation ID:
Visit ID:
Subject ID:
Observation kind:
Observed at (with offset):
Local time zone:
Directness:
Value:
Unit:
Method/instrument:
Condition tags:
Field confidence: low/medium/high
Caveat:
Valid from/until if stated:
Review due at:
Supporting asset IDs:
Contradicting observation IDs:
Supersedes observation ID:
LLM use allowed: false
Article use allowed: false
Public republication allowed: false
Status: captured
```

## Blank Route-Run Form

```text
Route run ID:
Visit ID:
Route ID or provisional route:
Origin definition:
Destination definition:
Mode/operator:
Booking method:
Party size/luggage/access needs:
Request time:
Pickup or queue-start time:
Departure time:
Arrival time:
Stops and durations:
Distance and method:
Amount paid/currency/unit:
Receipt asset ID:
Road/weather/traffic/tide conditions:
Signal checkpoints:
Access and transfer barriers:
What was not tested:
```

## Blank Statement And Consent Form

```text
Statement ID:
Visit ID:
Speaker role and basis of knowledge:
Private identity/contact reference, if needed:
Attribution: named/role-only/anonymous/not-publishable
Question asked:
Exact quote or paraphrase:
Statement type: quote/paraphrase/operational-answer
Captured at:
Consent to notes: yes/no
Consent to LLM use: yes/no
Consent to article use: yes/no
Consent to public quotation: yes/no
Consent to name/business attribution: yes/no
Consent to audio: yes/no
Consent to image: yes/no
Consent method and time:
Valid/recontact until:
Withdrawal route supplied: yes/no
Asset IDs:
Status: captured
```

## Confidence And Freshness Review

Field confidence describes the capture, not the final fact. Use:

- `high`: direct method is clear, required context is present, and strong supporting evidence exists;
- `medium`: observation is usable but one meaningful context or corroboration element is missing;
- `low`: observation is a lead, ambiguous, indirect, or not repeatable enough for admission.

Review windows should match volatility:

| Fact family | Initial review window | Repeat expectation |
| --- | --- | --- |
| live service status, weather effect, queue | same day to 7 days | check before use |
| price, menu, payment, opening pattern | 7–30 days | two observations or current operator source |
| connectivity and power | 7–30 days | three tests per visit and later repeat |
| route time/wait/road condition | 30–90 days | different daypart or condition |
| facilities and physical access barriers | 30–90 days | repeat after construction/change signal |
| stable identity/location | up to 180 days | confirm against responsible source |
| seasonal pattern | at least one full relevant season | never infer from one visit |
| safety-sensitive claim | shortest defensible window | current competent authority required |

The reviewer may shorten any window. No window creates a safety guarantee.

## Guide Validation Workflow

For every current guide claim:

1. Assign a stable claim key.
2. Record the exact current wording and guide slug.
3. Decide whether the claim is field-verifiable, authority-verifiable, editorial, or unsupported.
4. Link each field-verifiable claim to one or more approved observations.
5. Link authority-dependent claims to current primary sources.
6. Record contradictions, untested assumptions, date sensitivity, and affected itineraries.
7. Propose one of: retain, narrow, qualify, update, remove, or block pending evidence.
8. Have an editor approve the change through a pull request.
9. Record publication date, modification date, and evidence-check date separately.

Current route note: the repository serves planning guides at `/guides`. `/travel-guide` is not an
implemented route. Use stable guide keys so the evidence can support either route if product routing
changes later.

## Bulk Processing Workflow

Use the [offline field ingestion desk](use-offline-field-ingestion-desk.md) for the implemented local
validation boundary. Process iPad data in this order:

1. Export the day's or week's UUID-named records and assets from the iPad.
2. Transfer the record files explicitly through AirDrop, Finder file sharing, iCloud Drive, or an
   external drive; a cable connection does not grant silent access to every Files location.
3. Import the JSON or JSON Lines records at `/admin/field-ingestion` on the Mac.
4. Resolve schema errors, duplicates, same-ID conflicts, missing visit references, consent gaps, and
   unsafe permission flags.
5. Export the record-only `field-batch.v1` envelope and keep the original iPad records and media.
6. When the server packager exists, add governed media, generate per-file hashes and the final
   manifest, and run the bundle validator.
7. Run a database import dry run.
8. Import only the accepted staging batch.
9. Complete subject resolution and editorial review in the application.
10. Admit approved atomic observations into existing `source_records`, `facts`, and `evidence`.
11. Run conflict, confidence, freshness, permission, and public-projection gates.
12. Verify the exact chat retrieval boundary and affected guide claims before publication.

Until the server packager and importer exist, stop after the dashboard's private validated envelope
and manual media completeness audit. Do not bypass the design with direct SQL inserts.

## End-Of-Week Coverage Report

Produce one private report with:

- visits planned, completed, cancelled, and why;
- observations by kind, area, directness, confidence, and review state;
- route runs and their condition spread;
- assets captured, hashed, redaction-pending, and blocked;
- consented and non-publishable statements;
- unresolved subjects and map discrepancies;
- current guide claims supported, contradicted, narrowed, untested, or expired;
- geographic, daypart, accessibility, no-scooter, wet-weather, and carrier gaps;
- safety or privacy incidents and corrective action;
- the next week's highest-value assignments.

Counts are operational signals, not proof of truth or completeness.

## Ongoing Cadence After The Baseline

- Daily: close records, verify backup, and triage privacy or consent risks.
- Weekly: package a batch, run validation, resolve subjects, and produce the coverage report.
- Every two weeks: review high-volatility facts and guide discrepancies.
- Monthly: repeat core airport, port, north/south route, payment, service, and connectivity checks.
- Quarterly: audit the methodology, consent language, retention, trust labels, and content claim links.
- After a storm, closure, major road change, provider change, or credible correction: expire affected
  claims immediately and schedule targeted checks.

## Stop Conditions

Stop the assignment and preserve only safe notes when:

- an official warning, operator, landowner, or competent authority says not to proceed;
- weather, sea, road, visibility, fatigue, health, equipment, or return transport becomes unsafe;
- consent is refused or withdrawn;
- collecting would expose a vulnerable person, home, habitat, or private route;
- the only way to obtain the data is deceptive, disruptive, trespassing, or unlawful;
- the device cannot protect private material;
- a conflict of interest would make the resulting recommendation misleading.

No missing field is worth creating harm.

## Field Readiness Checklist

Before the first production-bound campaign, confirm:

- [ ] Methodology and bundle schema have versioned IDs.
- [ ] Del Carmen base location is stored privately and public wording is approved only after the move.
- [ ] iPad files work offline and have a tested backup/export route.
- [ ] Every form generates stable UUIDs and timezone-aware timestamps.
- [ ] Consent wording and withdrawal handling have been reviewed.
- [ ] Media storage, redaction, encryption, and retention are approved.
- [ ] Official weather, warning, tide-context, protected-area, transport, and emergency sources are
      bookmarked.
- [ ] The current guide-claim inventory exists.
- [ ] The batch validator and dry-run importer fail closed.
- [ ] Human review is independent from capture admission where practical.
- [ ] Chat cannot query staging or raw field tables.
- [ ] A distinct first-hand trust label exists; field evidence is not described as cache freshness.
- [ ] Expired, conflicted, withdrawn, private, and rejected records are excluded from retrieval and
      publication.
- [ ] All code, migration, content, and workflow changes are delivered through pull requests because
      `main` is protected.

## Related Documentation

- [Field research data model](../reference/field-research-data-model.md)
- [Siargao fieldwork official source pack](../reference/siargao-fieldwork-source-pack-2026-08-16.md)
- [Build the data pipeline with local Postgres](build-the-data-pipeline-with-local-postgres.md)
- [Chat agent routing and source governance](../explanation/chat-agent-routing-and-source-governance.md)
- [Qualified Discovery strategy](../explanation/qualified-discovery-strategy.md)

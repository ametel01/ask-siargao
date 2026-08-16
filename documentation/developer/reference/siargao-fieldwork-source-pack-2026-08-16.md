# Siargao Fieldwork Official Source Pack

- **Research checked:** 2026-08-16
- **Fieldwork begins:** Saturday, 2026-08-22
- **Base:** Del Carmen, Siargao

**Status:** Research and verification brief, not a booking sheet or safety clearance

## Purpose

This pack provides the official and first-party research anchors for a repeatable Siargao
fieldwork program. Its purpose is to help the field playbook collect evidence that can later become
governed PostgreSQL facts and support the current `/guides` pages or a future travel-guide surface.

An official web page is not proof that a place is open, a fare is current, a route is operating, or
an activity is safe on the observation date. Every operational item below remains a field check
unless the source is rechecked for the exact date and the claim is within the source's scope.

## Repository evidence boundary

The repository already makes the most important distinction:

- [`ASK_SIARGAO_SOURCE_POLICY.md`](../../../docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md)
  says curated local knowledge does not check live tides, currents, roads, access, lifeguards, or
  safety status.
- [`ASK_SIARGAO_DATA_DICTIONARY.md`](../../../docs/agent-memory/ASK_SIARGAO_DATA_DICTIONARY.md)
  treats curated guide facts as maintained product knowledge rather than live conditions.
- [`adapters.ts`](../../../src/server/providers/adapters.ts) registers
  `source_curated_ask_siargao_guide` as `local_verified`, with public-republish use, a 180-day
  default freshness window, and raw storage/publication disabled. It also registers
  `source_user_submitted` as private, audit-only evidence.
- [`0000_initial_schema.sql`](../../../drizzle/0000_initial_schema.sql) already separates entities,
  source records, atomic facts, and evidence records.

Therefore, a founder observation is a dated `local_verified` observation, not a permanently live
fact. The ingestion ticket must define a governed first-hand fieldwork profile and a separate
restricted media/consent store; it must not silently put publishable observations into the
audit-only user-submitted profile or raw photos/audio into the current curated-guide profile.

## Evidence method

For every candidate fact, preserve these distinct layers:

1. **Observation:** what Alex directly saw, measured, paid, or experienced.
2. **On-site official statement:** a posted rule, receipt, tariff, notice, or named authorized
   representative's statement.
3. **Third-party report:** what a driver, visitor, resident, or business worker said.
4. **Interpretation:** what the observation may mean for a traveler.
5. **Recommendation:** the bounded advice Ask Siargao may publish.

Never merge these layers into one sentence. Record `observed_at`, observer, method, exact location
or intentionally coarse location, source URL or on-site artifact, evidence media IDs, confidence,
limitations, `valid_from`, `recheck_after`, and whether the fact was first-hand or reported.

One visit proves only that time and context. Recheck volatile claims such as hours, prices, boat
departures, access, construction, closures, connectivity, and safety equipment before presenting
them as current.

## Provisional coverage itinerary

This source-check sequence matches the 14-day operational itinerary in the field playbook. It is not
a set of confirmed reservations. Move water-based days to a safe, officially checked window and
move Magpupungko to the locally confirmed low-tide window.

| Date | Coverage block | Research purpose |
| --- | --- | --- |
| Sat 22 Aug | Arrival and Del Carmen base | Establish the field kit, private base context, connectivity, utilities, and essential-service baseline. |
| Sun 23 Aug | Del Carmen town and visitor essentials | Verify current public services, transport nodes, official contacts, and practical visitor needs. |
| Mon 24 Aug | Sayak Airport arrival journey | Replay the airport-to-Del-Carmen boundary and collect a comparison lead for General Luna. |
| Tue 25 Aug | General Luna and Cloud 9 | Audit the visitor hub, current Cloud 9 construction/access state, pedestrian experience, services, and return trip. |
| Wed 26 Aug | Remote-work connectivity transect | Run repeatable mobile, Wi-Fi, latency, power, noise, and work-task observations. |
| Thu 27 Aug | Dapa Port and service hub | Replay a ferry passenger's terminal-to-Del-Carmen and terminal-to-General-Luna decision boundary. |
| Fri 28 Aug | Maasin, Malinao, and south/central corridor | Measure road segments, access, services, and current guide transitions without unsafe roadside stops. |
| Sat 29 Aug | Buffer and data audit | Revisit nearby failures only when appropriate; otherwise validate fields, consent, assets, and contradictions. |
| Sun 30 Aug | San Isidro, Pacifico, and Burgos | Capture the northbound route, stop network, beach access, services, connectivity, and return constraints. |
| Mon 31 Aug | Santa Monica and Alegria | Test long-route practicality, essential services, no-scooter assumptions, and the return plan. |
| Tue 1 Sep | Pilar and Magpupungko | Run this block at the locally confirmed low-tide access window; otherwise swap days. |
| Wed 2 Sep | Mangrove and Sugba Lagoon corridor | Observe the complete visitor journey only if the LGU/operator and conditions permit it. |
| Thu 3 Sep | Accessibility and no-scooter scenario | Measure a real step-by-step journey without reducing accessibility to a yes/no label. |
| Fri 4 Sep | Repeat and baseline close | Revisit missing fields, conflicting claims, different time-of-day conditions, and failed measurements. |

Do not attempt to “complete” a water, surf, night, or long-road block when an official warning,
local restriction, transport problem, or personal risk threshold says to stop.

## Zone source register and on-site unknowns

### Del Carmen base, mangroves, and Sugba Lagoon

Official anchors:

- The Convention on Wetlands' formal [Del Carmen Mangrove Reserve information
  sheet](https://rsis.ramsar.org/RISapp/files/RISrep/PH2553RIS_2411_en.pdf) identifies Ramsar Site
  2553 as an 8,654-hectare wetland designated in 2024 and describes 4,871 hectares of mangroves.
  These are site-level conservation facts, not visitor-capacity, access, or safety facts.
- The official [SIPLAS 2021–2030 management
  plan](https://rsis.ramsar.org/RISapp/files/57292175/documents/PH2553_mgt230606.pdf) treats
  ecotourism, boating, kayaking, photography, and nature trips as regulated activities within the
  protected-area zoning and prohibits mangrove cutting and reclamation. Confirm the current zone,
  approval, and operator rules before collecting data in the reserve.
- The [Del Carmen LGU mangrove page](https://delcarmen.gov.ph/mangrove-aerial-view/) describes the
  municipality's mangrove resource. The page is protected by an anti-bot challenge and does not
  supply a current visitor procedure, so use it as an identity lead only.
- A February 2026 [Philippine News Agency report of Del Carmen's Island Escapade
  announcement](https://www.pna.gov.ph/articles/1268179) says the LGU program features Sugba
  Lagoon, Pamomoan Beach, Kawhagan, and Halian and directs visitors to the municipal tourism office.
  It does not prove that a particular package, price, or departure is available in August.
- The provincial government's [island destination directory](https://surigaodelnorte.gov.ph/island-destination/)
  assigns Sugba Lagoon to Del Carmen.

On-site unknowns to measure:

- exact tourism-office and boat-dispatch locations, their canonical names, coordinates, and signs;
- current registration steps, accepted identification, reservation lead time, cut-off, capacity,
  operating days, closure calendar, environmental limits, fee components, receipt issuer, payment
  methods, cancellation/refund rules, and resident/PWD/senior policies;
- whether the 2026 Island Escapade program is active, what it includes, who operates each segment,
  and what may be cited or republished;
- boat type, passenger limit as posted, crew roles, manifest process, lifejacket availability and
  fit, safety briefing, shade, spray exposure, boarding steps/gaps, assistance offered, toilet
  availability, drinking water, and emergency communication;
- actual queue, check-in, boarding, transit, dwell, and return times, with weather and sea context;
- mangrove-boardwalk surface, width, steps, rails, rest points, shade, toilet route, wheelchair or
  mobility-aid barriers, and the difference between advertised and usable access;
- all posted conservation rules, zone markers, waste handling, wildlife-distance instructions,
  photography/drone restrictions, and current closures;
- precise distinction between direct observation, guide interpretation, and ecological claims that
  require DENR/PAMO confirmation.

### Sayak Airport and Del Carmen arrival

The Civil Aviation Authority of the Philippines identifies Siargao/Sayak Airport in Del Carmen in
its [official area-center listing](https://www.caap.gov.ph/area-centers/); an official CAAP
[procurement document](https://caap.gov.ph/wp-content/uploads/2023/10/Bid-No.-23-035-09-ALPHA-Procurement-of-Survey-Services-for-the-Construction-of-New-Siargao-Airport-Bid-Documents.pdf)
also describes Sayak as the airport serving Siargao. Neither source establishes flight schedules or
ground-transfer availability for 2026-08-22.

Measure the full arrivals boundary: aircraft door to baggage claim, exit, official transport desk
or rank, pickup meeting points, signage, porter/assistance availability, step-free route, toilets,
ATMs/cash, SIM availability, cellular signal, posted fares, actual quote and receipt, wait time,
vehicle capacity/luggage handling, Del Carmen travel time, after-delay fallback, and the process for
recovering lost baggage. Record airport and airline facts separately.

### Dapa Port and onward transport

Official anchors:

- The March 2026 [MARINA Philippine Nautical Highway
  Matrix](https://marina.gov.ph/wp-content/uploads/2026/04/Philippine-Nautical-Highway-Matrix-MAR-2026.pdf)
  lists the Surigao City–Dapa route as served and includes an operator, vessel, sample fare bands,
  and departure entries. Treat every one as indicative until confirmed with the operator and
  terminal for the travel date.
- The Philippine Ports Authority's [official port
  list](https://www.ppa.com.ph/sites/default/files/List%20of%20Ports%20covered%20in%20PPA%20Statistics.pdf)
  includes Dapa under TMO Siargao, while its [vessel-at-port feed](https://iports.ppa.com.ph/vesselatport)
  is operational history rather than a passenger timetable.

Measure separately for every operator/vessel observed: official booking channel, same-day sales,
schedule and check-in cut-off, fare class and all terminal/environmental/baggage charges, ticket and
receipt, cancellation trigger, delay notification, rebooking/refund, baggage allowance, accessibility
assistance, boarding surface/gap/steps, seating, toilet, ventilation, lifejacket and safety briefing,
actual departure/arrival, and evidence timestamp.

At Dapa, measure the exit-to-vehicle path, lighting, shelter, queue discipline, posted or negotiated
fares, transport modes, availability by arrival time, Del Carmen/General Luna/Pacifico quotes,
driver/operator identity and permit evidence when voluntarily shown, luggage/weather capacity,
actual trip time, road constraints, and a late-arrival fallback. Do not infer current supply from a
daytime visit.

### Pilar and Magpupungko

The Department of Tourism's [official Siargao destination
page](https://www.tourism.gov.ph/destination/caraga/siargao-island/) states that Magpupungko is in
Pilar and its natural pools are visible only at low tide. The provincial government's [Pilar
page](https://surigaodelnorte.gov.ph/pilar/) also identifies Magpupungko Beach and Rock Formation as
a municipal attraction. Neither page supplies a current tide window, opening status, fee, or safety
assessment.

On-site unknowns:

- which tide station/table staff use, their recommended entry/exit window, and the observed lag
  between the published prediction and local pool exposure;
- current access status, closure triggers, posted hours and fees, receipt, parking/drop-off, route
  condition, queue, toilets/showers/changing facilities, food/water, shade, waste controls, and
  emergency contacts;
- surface sequence from drop-off to pools, distance, stairs, slippery/uneven rock, handholds, places
  to rest, footwear expectations, alternate viewing route, and mobility assistance;
- posted warnings, staff/lifeguard presence and scope, rescue equipment, current wave/weather/tide
  observations, crowding, and the exact boundary beyond which no safety conclusion is supported;
- photographs at low, rising, and later tide only when conditions permit, with timestamps and the
  prediction source attached.

### General Luna and Cloud 9

The Department of Tourism identifies Cloud 9 as a surf site and describes its reef break and
boardwalk on the [official Siargao destination
page](https://www.tourism.gov.ph/destination/caraga/siargao-island/). On 2026-04-10 the Province
announced a [Cloud 9 tower and boardwalk restoration
project](https://surigaodelnorte.gov.ph/%F0%9D%97%96%F0%9D%97%9F%F0%9D%97%A2%F0%9D%97%A8%F0%9D%97%97-%F0%9D%9F%B5-%F0%9D%97%A7%F0%9D%97%A2%F0%9D%97%AA%F0%9D%97%98%F0%9D%97%A5-%F0%9D%97%A5%F0%9D%97%98%F0%9D%97%A6%F0%9D%97%A7%F0%9D%97%A2/).
Its actual August construction, boardwalk, tower, and access state must be checked on site.

Collect two distinct datasets:

1. **Cloud 9 visit:** construction boundaries, entry/fees/receipts, open routes, viewing access,
   step-free access, boardwalk width/surface/rails, seating/shade/toilets, surf-school and board-hire
   identity, posted skill requirements, rescue/lifeguard presence, reef/access warnings, tide and
   condition sources, crowd by time block, parking/drop-off, and current official contact.
2. **General Luna decision environment:** Del Carmen travel time by mode and time of day, transport
   quote/availability, pedestrian continuity, crossings, lighting, drainage after rain, ATMs,
   pharmacies/clinics, coworking and verified work-call connectivity, food-service hours and
   payment methods, noise only as a timestamped measurement/observation, and the late return to Del
   Carmen. Do not generalize one street or one hour to all General Luna.

Do not rate a surf break as safe, beginner-suitable, or operational from the DOT description alone.
Those conclusions require current local conditions and qualified on-site judgment.

### Pacifico and the north-island corridor

The provincial [island destination directory](https://surigaodelnorte.gov.ph/island-destination/)
assigns Pacifico and Pacifico Surf Break to San Isidro. DENR's [SIPLAS policy
library](https://faspselib.denr.gov.ph/Materials/Detail/982a1560-7d5a-4c08-a6d9-66b42aabe6ee)
records a 2024 ordinance establishing the Del Carmen–Pacifico–Tigasao marine protected area. This
means route and coastal observations must preserve protected-area rules and cannot be treated as
unrestricted content collection.

Measure the full Del Carmen–Pacifico route in both directions: exact start/end, mode, departure and
arrival, stops, paved/unpaved or damaged segments, drainage/flood evidence, lighting, sharp turns,
construction, fuel/repair/toilet/food/cash stops, cellular dead zones, rain shelter, and realistic
fallbacks. Never publish a dangerous-road label from appearance alone; report observable surface,
visibility, traffic, and posted warnings.

At Pacifico, capture canonical access points and names, public/private boundary signs, fees,
parking/drop-off, hours, toilets/showers, food/water, waste systems, step-free route, loose sand or
stairs, shade/seating, surf/swim zone separation, current operator/lifeguard/rescue presence, posted
warnings, conditions, and community/MPA rules. Repeat connectivity at the beach, village services,
and accommodation/coworking candidates rather than reporting one result for all Pacifico.

## Conditions, disruptions, and safety sources

- PAGASA's [Mindanao regional forecast](https://www.pagasa.dost.gov.ph/regional-forecast/minprsd),
  [tropical cyclone bulletins](https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin),
  [two-week cyclone threat guidance](https://bagong.pagasa.dost.gov.ph/tropical-cyclone/tc-threat-potential-forecast),
  and [gale warnings](https://www.pagasa.dost.gov.ph/marine/gale-warning) are the official weather
  and warning preflight. The two-week product itself says to use PAGASA bulletins once a cyclone is
  developed, so it is not a go/no-go forecast.
- NAMRIA publishes the official [PH Tides service](https://www.namria.gov.ph/PhTides.aspx) and PH
  Tides app. Before using any value, record the selected station, date, local timezone, height datum,
  predicted time/height, and retrieval time. Confirm whether a current Dapa or other appropriate
  station exists; never silently present a proxy station as an exact Cloud 9, Sugba, Magpupungko,
  or Pacifico reading.
- [HazardHunterPH](https://hazardhunter.georisk.gov.ph/map) combines mandated-agency hazard layers,
  but its official [limitations](https://hazardhunter.georisk.gov.ph/index.php/about-hazardhunterph)
  describe its reports as indicative and direct users to the responsible agencies for official
  assessments. Use it to identify questions for field verification, not to declare a property or
  route safe.

For each field session, save the official preflight sources and retrieval times, then record what
actually happened: rain, wind only if measured, visibility, standing water, sea state as an
observation rather than a forecast, closure/delay notice, who issued it, traveler impact, official
response, and viable fallback. Never enter water, continue a boat trip, or remain on an exposed
route merely to complete a dataset.

## Accessibility measurement standard

The National Council on Disability Affairs' [2024 revised BP 344
rules](https://ncda.gov.ph/revised-2024-rules-and-regulations-implementing-batas-pambansa-344/)
define an accessible route as continuous and unobstructed and include standards for ramps, stairs,
handrails, surfaces, toilets, counters, and lodging. Use that official document as the measurement
reference, but do not certify legal compliance in an editorial field visit.

At every site, record the route from real drop-off to the primary experience: surface, clear width,
grade where measurable, steps and risers, gaps, handrails, obstacles, lighting, rest points, shade,
door widths, toilet access and fixtures, boat/vehicle transfer, assistance offered, and whether the
same experience is available without stairs. Describe measured barriers. Do not reduce
accessibility to a yes/no field or infer usability for every disability.

## Connectivity method

The National Telecommunications Commission's [QoS broadband
map](https://www.qos.ntc.gov.ph/) says it combines ISP submissions, verified cell-site locations,
and contributed speed tests and cautions that terrain, buildings, and network conditions affect
actual service. NTC's mobile broadband measurement rules list downstream and upstream data rate,
latency, and packet loss as monitored parameters in [Memorandum Circular
10-12-2016](https://ntc5.ntc.gov.ph/wp-content/uploads/2019/10/MC-10-12-2016_-Rules-on-the-mEasurement-of-Mobile-Broadband-Internet-Access-Service.pdf).

Proposed field standard:

- record carrier, SIM/plan, device model, OS, test service/server, GPS or coarse location, indoor or
  outdoor position, network type, signal indicator, power state, weather, and timestamp;
- run three tests per carrier/location/time block, preserving download, upload, latency, and packet
  loss when the test exposes it;
- perform a short real work task such as a video-call test only with consenting participants;
- repeat morning, afternoon, and evening for any place described as remote-work capable;
- distinguish mobile data, venue Wi-Fi, fixed connection, and power availability;
- record a failed test as evidence rather than discarding it, while distinguishing no signal,
  captive portal, exhausted data, test-service failure, and power outage.

The procedure is an Ask Siargao proposal. NTC does not certify that these few field samples
represent an entire barangay or provider.

## Ethical collection and protected-area gates

### People and interviews

The Philippine Data Privacy Act requires transparency, legitimate purpose, proportionality,
accuracy, limited retention, and safeguards; consent is one lawful basis and must be specific to the
purpose ([NPC Act text](https://privacy.gov.ph/data-privacy-act/)). The NPC's [2023 consent
guidelines](https://privacy.gov.ph/wp-content/uploads/2023/11/NPC-Circular-No.-2023-04_Guidelines-on-Consent_07Nov2023.pdf)
add operational consent requirements, and the NPC reminds publishers that [identifiable photos and
videos contain personal data](https://privacy.gov.ph/reminder-on-sharing-photos-and-videos-containing-personal-data/).

Before an interview, explain in a language the person understands:

- what will be collected;
- that normalized facts may enter PostgreSQL, be retrieved by an AI agent, and support public travel
  guides;
- what will remain restricted, how long it will be retained, and how to withdraw;
- separate choices for notes, attribution/name, quotation, audio, image/video, AI retrieval, and
  public publication.

Never secretly record a private conversation. The [Anti-Wiretapping Act](https://lawphil.net/statutes/repacts/ra1965/ra_4200_1965.html)
requires authorization from all parties to a private communication for recording. Obtain evidenced
permission before audio or video; if permission is absent, take anonymous nonverbatim notes or stop.

Keep consent records, contact details, signatures, raw audio, and identifiable originals in a
restricted vault, separate from the AI retrieval corpus. The retrieval record should use an
anonymous source key and contain only the minimum normalized fact, method, time, appropriately
precise location, confidence, corroboration, permitted uses, and validity. Frame out or blur
incidental people. Complete a privacy-impact review before production intake; the NPC identifies
privacy impact assessment as part of accountable personal-data governance in its [data-protection
circular overview](https://privacy.gov.ph/npc-issues-circulars-to-strengthen-personal-data-protection-in-ph/).

### Nature, protected areas, and community knowledge

Siargao is a protected landscape and seascape under [Presidential Proclamation
902](https://lawphil.net/executive/proc/proc1996/proc_902_1996.html). The [Expanded NIPAS
Act](https://lawphil.net/statutes/repacts/ra2018/ra_11038_2018.html) prohibits activities including
disturbing wildlife, unauthorized collection, damaging natural formations, and littering in
protected areas. The [Wildlife Act](https://lawphil.net/statutes/repacts/ra2001/ra_9147_2001.html)
also regulates wildlife collection and disturbance.

Fieldwork is observation only: collect no coral, shell, rock, plant, wildlife, artifact, or other
specimen; do not disturb wildlife or reveal sensitive nesting/roosting coordinates. Before work in
a protected site, ask the LGU/PAMO whether editorial research, commercial publication, interviews,
tripods, drone use, or precise geolocation requires approval. Drone work is a separate gate under
[CAAP RPAS rules](https://www.caap.gov.ph/rpas-regulations/) plus PAMO, LGU, landowner, and wildlife
restrictions; do not launch until all applicable permissions are confirmed.

One interviewee cannot authorize publication of collective Indigenous or community knowledge. The
[Indigenous Peoples' Rights Act](https://lawphil.net/statutes/repacts/ra1997/ra_8371_1997.html) and
NCIP's [IKSP/customary-law research
guidelines](https://ncip.gov.ph/wp-content/uploads/2020/09/ncip-ao-no-1-s-2012-iksp.pdf) establish
collective consent and community-validation protections. Pause ingestion and consult the relevant
community and NCIP process before collecting or publishing protected collective knowledge.

## iPad field capture: documented capabilities and proposed workflow

### What Apple currently documents

- Shortcuts' **Ask for Input** accepts words, dates, and numbers and is intended for logging-style
  workflows ([Apple Shortcuts guide](https://support.apple.com/en-euro/guide/shortcuts/apd68b5c9161/ios)).
- Shortcuts provides a **Current Date** special variable; Dictionary actions can hold text, numbers,
  lists, and nested structured values; and file actions include **Save File**
  ([variables](https://support.apple.com/en-ie/guide/shortcuts/apdd2b316022/ios),
  [dictionaries](https://support.apple.com/guide/shortcuts/dictionaries-apd43b69f337/ios),
  [file actions](https://support.apple.com/en-eg/guide/shortcuts/apdaf74d75a5/ios)).
- Apple documents a **Get Current Location** action as a Shortcuts location-producing action, but
  iPad location sources vary: only Wi-Fi + Cellular models use GPS networks, while Bluetooth,
  Wi-Fi, and cellular information may also contribute
  ([Shortcuts action connections](https://support.apple.com/en-gb/guide/shortcuts/apda850ab0e1/ios),
  [iPad Location Services](https://support.apple.com/en-ie/guide/ipad/ipadb7c27772/ipados)).
- iPad Dictation works anywhere text can be entered and is processed on device in many languages,
  but availability varies by language and region
  ([Apple iPad dictation guide](https://support.apple.com/guide/ipad/dictate-text-ipad997d9642/ipados)).
- Files can mark selected items **Keep Downloaded**; offline edits then sync with iCloud after the
  connection returns ([Apple Files guide](https://support.apple.com/en-az/guide/ipad/ipad8139864c/ipados)).
- Apple Maps can download an area for offline use, although offline maps are not available in every
  country or region ([Apple Maps guide](https://support.apple.com/en-ie/guide/ipad/ipadc6e7e4d7/ipados)).
- Photos exposes capture date/time, camera details, and location metadata. Sharing can include that
  metadata, and the share sheet can remove location before export
  ([metadata](https://support.apple.com/en-ie/guide/ipad/ipad194827fd/ipados),
  [sharing controls](https://support.apple.com/en-ca/guide/ipad/ipad4f44c78f/ipados)).

### Ask Siargao proposal to build and test before departure

Create an **ASQ Field Capture** Shortcut that runs locally and, in order:

1. creates a UUID or other collision-resistant record ID;
2. inserts Current Date in ISO 8601 form and the observer ID;
3. requests Current Location, preserves the capture method, and allows a manual pin/description when
   location is unavailable or inappropriate;
4. uses menus and Ask for Input for zone, entity, evidence layer, subject, observed fact, units,
   conditions, confidence, limitations, validity, consent ID, and media IDs;
5. allows Dictation only as editable text input—review names, numbers, units, and negations before
   saving;
6. assembles a Dictionary and writes one local JSON record plus an append-only CSV index with Save
   File;
7. shows a final read-back and explicit **Save / Correct / Discard** choice;
8. queues upload separately; it never requires the API or iCloud to complete the field save.

This exact shortcut is not an Apple-provided template. Test every action in Airplane Mode and with
Location Services denied before using it as the sole capture mechanism. Web/API, cloud, lookup, and
third-party actions may still require connectivity even when the core prompts and local save work.

Before leaving:

- keep the schema, blank templates, consent notice, contact sheet, and current itinerary downloaded
  in Files; also keep a local copy outside a cloud-only path;
- attempt to download the entire Siargao map and verify it opens offline; Apple warns that offline
  map availability varies by region;
- verify free device storage, power bank/cables, screen and rain protection, and a paper fallback;
- test whether the specific iPad model provides usable coordinates at an offline field site;
- disable automatic upload of restricted interview/media material until the privacy design is
  approved.

For photos, preserve the original internally only when authorized and useful for provenance. Link
it by media ID rather than embedding it in a fact row. Before public sharing, remove location from
images of homes, private people, sensitive wildlife, or restricted sites and confirm that no
identifiable bystander or private document remains visible.

## Minimum ingestion packet

Every proposed database fact should arrive with:

- stable observation ID and candidate entity ID;
- observer and observation timestamp with timezone;
- location plus precision/method and a `sensitive_location` flag;
- observation/report/interpretation classification;
- one atomic claim with units and the raw entered value retained only where policy allows;
- method (`direct_observation`, `measurement`, `receipt`, `posted_notice`, `authorized_statement`,
  or `third_party_report`);
- source profile, source record, media/evidence IDs, official URL or on-site artifact ID;
- confidence and confidence reasons;
- conditions and material limitations;
- `valid_from`, `expires_at` or `recheck_after`, and volatility class;
- public-republish, AI-retrieval, citation, raw-storage, and attribution permissions;
- consent ID when a person contributed, kept outside the retrieval corpus;
- contradiction links and review state (`draft`, `needs_corroboration`, `approved`, `rejected`, or
  `expired`).

Reject or quarantine records that omit timestamp, source layer, permissions, or the distinction
between observed and reported. A single field visit should not automatically overwrite a stronger
official source; preserve both, record the conflict, and assign a human review.

## Known gaps that must remain explicit

No sufficiently current, authoritative public source was found that proves August 2026 opening
hours, prices, boat departures, tour capacity, road condition, local transport supply, construction
access, lifeguard coverage, emergency numbers, accessibility, or carrier performance for all
requested sites. Those are the field program's verification targets, not blanks to fill from blogs
or memory.

Before each session, obtain the current information directly from the responsible LGU, PAMO,
terminal, operator, or venue; preserve who supplied it and when; and mark anything that cannot be
verified as unknown. Never convert “staff said,” a social post, a map listing, or one successful
visit into a safety guarantee or universal operating rule.

## Related Documentation

- [Run Siargao field research](../how-to-guides/run-siargao-field-research.md)
- [Field research data model](field-research-data-model.md)
- [Ask Siargao source policy](../../../docs/agent-memory/ASK_SIARGAO_SOURCE_POLICY.md)
- [Ask Siargao data dictionary](../../../docs/agent-memory/ASK_SIARGAO_DATA_DICTIONARY.md)

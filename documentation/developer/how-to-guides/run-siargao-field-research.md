# Run Siargao Field Research

Use this playbook to prepare and execute comparable first-hand fieldwork through the deterministic
Field Workspace accepted in [issue #237](https://github.com/ametel01/ask-siargao/issues/237).

> **Implementation status:** the Field Workspace is not implemented yet. The production
> `/admin/field-ingestion` page is a legacy JSON compatibility tool, not a capture workflow. Do not
> hand-author JSON, build a replacement Apple Shortcut, or treat the legacy page as satisfying this
> playbook.

The procedure ends at private review and protected export. It does not make an observation a Fact,
publish a guide claim, prove residence or local expertise, or authorize server ingestion.

## Before fieldwork

Do not start production-bound capture until the Workspace passes its Field Readiness Check:

1. Sign in as an authorized Field Researcher and authorize the iPad while online.
2. Install the PWA and verify it reloads with the network disabled.
3. Register the intended Mac as an Authorized Field Device.
4. Create and verify the Field Recovery Secret; keep it outside the application in the researcher's
   password manager;
5. install the signed Field Protocol Package and inspect its version, Campaign, methods, Subjects,
   geography, and changes;
6. verify local storage headroom, camera/scan access, time, `Asia/Manila`, and device/method profiles;
7. complete a sample Visit, create a Field Recovery Export, reopen it, and restore it on the authorized
   Desk;
8. confirm that protected capture, reload, and restoration work without connectivity.

Stop if identity, offline reload, encryption, recovery, storage, or restoration cannot be verified.

## Build a Field Day Plan

Assignments are intentionally unscheduled. Prepare an outing when conditions and capacity are known:

1. Select the governed starting area and transport mode.
2. Enter available hours and retain the proposed safety, documentation, rest, and daylight margins.
3. Review current official weather, warnings, tide context, access notices, and transport information
   when relevant. Preserve source and retrieval time in the preflight snapshot.
4. Generate the deterministic proposal.
5. Inspect why each Assignment is included and why relevant alternatives are excluded.
6. Confirm that every primary Assignment has a safe compatible fallback.
7. Adjust the proposal only after reading the coverage consequence.
8. Confirm the plan and save its immutable Field Plan Snapshot for offline use.

The planner groups practical travel-compatible work, not merely close map points. Unsafe, ineligible,
inaccessible, or transport-incompatible Assignments remain excluded even when manually requested.

## Unscheduled baseline Assignment library

The former date-bound 14-day itinerary becomes this Assignment pool. A Field Day Plan may group several
compatible Assignments in one outing without merging their Subjects or evidence.

| Assignment | Geography | Primary objective modules | Typical eligibility or repetition |
| --- | --- | --- | --- |
| Home-base readiness and practicalities | Private Del Carmen base | offline readiness, water, power, waste, noise, connectivity, nearby essentials | private location protected; multiple dayparts and changed conditions |
| Del Carmen visitor essentials | Del Carmen centre and public transport/service nodes | identity, wayfinding, cash, payment, pharmacy/clinic leads, fuel, food, toilets, shade, access, connectivity | weekday/weekend or operating-window coverage |
| Sayak Airport arrival journey | Airport–Del Carmen corridor, with separate General Luna comparison | pickup, signage, wait, luggage, fare basis, route time, access, signal | genuine end-to-end traversal; arrival window |
| General Luna and Catangnan visitor journey | General Luna/Catangnan cluster | arrival, parking/drop-off, wayfinding, price/payment, facilities, access barriers, crowd, connectivity | weekday/weekend and two dayparts |
| Connectivity transect | compatible Del Carmen or General Luna work locations | three-test measurement sets, device/network/method, power, socket permission, noise, seating | repeated zones and changed crowd/weather context |
| Dapa port and service hub | Dapa cluster and Del Carmen–Dapa corridor | port journey, luggage, signs, transport transaction, cash, market, health leads, fuel, toilets, shade, access | arrival and departure windows |
| South and central corridor | Maasin, Malinao, Doot, Guiwan corridor | route segments, surface, stops, access, price, facilities, signal, map discrepancies | two complete route runs under recorded conditions |
| Northbound services and access | San Isidro, Pacifico, Burgos | route time, road, food, fuel, cash, health leads, beach access, service, remote-work checks | weekday/weekend or two dayparts |
| Santa Monica and Alegria route | northern corridor | full route, return constraints, transport availability, facilities, cash, fuel, signal | one complete route plus one targeted repeat |
| Pilar and condition-dependent access | Pilar and governed destination access | tide context, route, entrance, paid amount, facilities, surface, access state | eligible safe tide/access contexts only |
| Del Carmen departure and boat journey | governed departure points and each operator/stop separately | booking, check-in, wait, price, boarding, transfers, facilities, operating-policy statement | authorized operating provider and suitable conditions |
| No-scooter accessibility journey | one compatible Del Carmen, Dapa, or General Luna journey | booking burden, pickup, fare, transfers, surfaces, steps, toilets, shelter, luggage barriers | realistic journey without creating health or safety risk |
| Conflict and freshness follow-up | nearest compatible unresolved work | repeat volatile price, route, opening, connectivity, provisional identity, or contradiction | determined by the original Coverage Requirement |

Places are research Subjects, not endorsements or promises of access. Current status, schedules,
warnings, navigation, surf, swimming, weather, and marine safety still require competent current
sources.

## Execute each Assignment

### 1. Read the briefing

Confirm the principal Subject or route, Research Objectives, required evidence counts, Method Profiles,
Eligibility Windows, Partial Coverage Sets, estimated duration, safe fallback, and explicit stop
conditions.

One Assignment covers one principal Subject, bounded area, or Route Run. Nearby businesses remain
separate Assignments even when the planner puts them in the same outing.

### 2. Recheck safety and eligibility

Record the current state of every hard gate. Substitute the fallback when conditions, instructions,
health, access, permission, equipment, or return transport make the primary Assignment unsuitable.

Proximity and editorial priority never override a safety exclusion.

### 3. Start the Field Visit

At the actual arrival point:

- choose the governed Subject or create a structured Provisional Subject;
- record the observed displayed name, category, governed area, distinguishing details, and permitted
  location precision;
- confirm capture time, timezone, Field Researcher, protocol, Assignment, device, and Method Profile;
- grant or deny precise location for the active Visit;
- capture structured weather, tide, road, crowd, noise, outage, access, and disruption context;
- add an orientation asset only when safe, permitted, and useful.

### 4. Complete Research Objectives

The Recorder presents one eligible Objective at a time and derives Objective Coverage from linked
records. It must never accept a manual done checkbox as evidence.

Use the controlled action requested by the Objective:

- **Observe** a bounded state or feature.
- **Measure** a value through the selected Method Profile.
- **Attempt** a transaction, booking, journey, or service.
- **Ask** a Source a declared question and record a Source Statement.
- **Traverse** a defined route and capture a Route Run.
- **Document** a sign, menu, receipt, or other Evidence Asset.
- **Repeat** an earlier observation under the required different condition.

Create a separate Field Observation whenever Subject, Observation Kind, time, method, directness,
permission, or freshness changes. A structured negative result can satisfy an Objective; an unperformed
check cannot.

When capture cannot proceed, choose the exact Capture Exception: access denied, unsafe conditions,
permission declined, Subject unavailable, equipment failure, eligibility changed, interrupted, or not
applicable. When the schema cannot represent reality, create a Schema Gap instead of choosing an
incorrect category or arbitrary field.

### 5. Capture typed evidence

The Field Protocol Package supplies the exact form. Cross-cutting requirements are:

- one governed or Provisional Subject per observation;
- `observedAt`, `recordedAt`, timezone, offset, and any manual correction indicator;
- controlled directness, Observation Kind, Method Profile, conditions, and units;
- immutable Raw Measurement plus derived Normalized Measurement and conversion version;
- Capture Confidence distinct from final Fact confidence;
- default freshness from the Observation Kind, which the researcher may shorten but not extend;
- permissions denied by default and granted independently with method and time;
- Protected Field Data kept separate from Public Location Precision and public-safe evidence.

For prices, distinguish posted, quoted, and paid observations and include item, unit, party size,
inclusions, taxes/fees, negotiation context, attempted payment method, and receipt linkage.

For Source Statements, preserve the original language, question, Source role and basis of knowledge,
exact quotation or labelled paraphrase, attribution choice, each consent scope, recontact/validity
window, and withdrawal route. A translation is a separate attributed derivative.

For assets, confirm purpose, linked Objective/record, people present, rights, consent, redaction,
retention, hash, and durable local save. Direct audio/video capture is outside the first release.

### 6. Close the Visit and Assignment

Before leaving:

1. record departure or completion time;
2. reconcile every asset with its Objective and record;
3. review unknowns, conflicts, untested items, permissions, and Schema Gaps;
4. confirm that every required Objective is Satisfied, validly Not Applicable, or blocked by an exact
   Capture Exception;
5. close the Assignment as Complete or Closed with gaps;
6. create a linked Follow-up Assignment for unresolved required coverage;
7. freeze Captured records so later correction requires supersession.

Unstarted or explicitly Deferred Assignments return to the unscheduled pool. Interrupted Visits remain
Needs attention and never become silently unstarted.

## Close the Field Day Plan

At the end of the outing:

1. reconcile all Visits and Assignments;
2. record why any work was deferred or interrupted;
3. inspect newly created follow-up coverage;
4. review permissions, conflicts, storage headroom, and protected assets;
5. create a Field Recovery Export;
6. reopen and verify the export or complete a Verified Field Transfer to the authorized Desk;
7. preserve the immutable Field Plan Snapshot and all revisions.

A downloaded or AirDropped file is not a verified backup. Verification requires successful decryption,
integrity and reference checks, and a receipt the source device accepts.

## Review and export

Use the Field Desk to inspect each Assignment with its Objectives, Visits, records, exceptions,
conflicts, rights, assets, and provenance. Record Include, Exclude, Needs more evidence, or Correct by
supersession. Keep reviewer identity and reviewer/researcher independence explicit.

Use Field Recovery Export for private backup of any state. Use Field Batch only for explicitly
included, referentially closed, reviewed records. A successful Field Batch does not authorize upload,
database writes, Fact Admission, agent retrieval, or publication.

## Stop conditions

Stop and preserve only safe protected context when:

- an official warning, property controller, transport provider, or competent authority says not to
  proceed;
- weather, sea, road, visibility, fatigue, health, equipment, or return transport becomes unsafe;
- consent is refused or withdrawn;
- capture would expose a vulnerable person, home, habitat, private route, or unrelated bystander;
- obtaining data would require deception, disruption, trespass, unlawful conduct, or a purchase or
  journey that is not genuinely appropriate;
- the device cannot protect or durably save the material;
- a conflict of interest would make later use misleading.

No Coverage Requirement is worth creating harm.

## Related documentation

- [Deterministic Field Workspace](../explanation/deterministic-field-workspace.md)
- [Field research data model](../reference/field-research-data-model.md)
- [Legacy field import recovery](use-offline-field-ingestion-desk.md)
- [Siargao fieldwork official source pack](../reference/siargao-fieldwork-source-pack-2026-08-16.md)

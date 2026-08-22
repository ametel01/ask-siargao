# Field Research Protocol and Data Reference

This reference defines the accepted contract for deterministic offline field planning, capture,
review, recovery, and batch export. The implementation programme is
[issue #237](https://github.com/ametel01/ask-siargao/issues/237).

The accepted contract is not fully implemented. PR #226's `field-record.v1` and embedded-record
`field-batch.v1` shapes are Legacy Capture and are not authoritative for new work.

## Authority and scope

The source-of-truth order is:

1. `CONTEXT.md` for domain language;
2. ADRs 0026–0029 for durable architecture decisions;
3. canonical machine-readable schemas and registries delivered by
   [issue #238](https://github.com/ametel01/ask-siargao/issues/238);
4. this page for human-readable reference;
5. generated TypeScript bindings and examples, which must match the canonical artifacts.

This contract ends at a verified Field Batch. Server Field Ingestion, PostgreSQL field tables, Fact
Admission, chat retrieval, and publication are separate future contracts.

## Lifecycle

```mermaid
flowchart LR
  A["Signed Field Protocol Package"] --> B["Field Day Plan"]
  B --> C["Offline Field Recorder"]
  C --> D["Immutable capture"]
  D --> E["Field Desk review"]
  D --> F["Field Recovery Export"]
  E --> G["Field Batch"]
  G -. future .-> H["Field Ingestion"]
  H -. future .-> I["Fact Admission"]
```

No chat tool or public route may query Recorder, Desk, recovery, legacy, or future staging data
directly.

## Protocol hierarchy

| Concept | Required relationship | Meaning |
| --- | --- | --- |
| Field Campaign | contains Field Assignments | Scoped research programme with one methodology and evidence objective; no fixed schedule required. |
| Field Assignment | belongs to one Campaign | Unscheduled work for one principal Subject, bounded area, or route. |
| Research Objective | belongs to one Assignment | Required question, observation, measurement, attempt, statement, traversal, document, or repetition. |
| Coverage Requirement | belongs to one Objective | Requiredness, minimum record count, supporting evidence, and repetition conditions. |
| Eligibility Window | applies to Assignment or Objective | Daypart, weekday class, tide, access, operating, or other conditions for a valid attempt. |
| Partial Coverage Set | belongs to one Assignment | Explicit subset that remains independently valid when the entire Assignment cannot fit. |
| Field Day Plan | selects Assignments | Researcher-confirmed, capacity-bounded grouping for one outing. |
| Field Visit | executes Assignment work | Shared place, time, conditions, and provenance context for captured records. |

## Field Protocol Package

A package manifest pins compatible versions for:

- Campaigns, Assignments, Objectives, Coverage Requirements, and labels;
- record schemas and controlled registries;
- Method Profiles and supported device requirements;
- governed Subjects and Provisional Subject rules;
- areas, corridors, transport modes, transfer boundaries, and conservative duration bands;
- Eligibility Windows, Partial Coverage Sets, fallbacks, and branching rules;
- permission and freshness defaults;
- application compatibility and Protocol Migration declarations.

The manifest has a stable package ID, semantic version, created time, signer/key ID, content hashes,
component versions, compatibility range, and signature. Activation fails on unknown signer, invalid
signature, hash mismatch, incompatible application, or missing migration declaration.

Active Field Plans and Visits remain pinned to their original package. Protocol Migration previews
every change, preserves originals, and sends ambiguous conversions to Needs resolution or Legacy
Capture.

## Planning contract

### Geographic forms

An Assignment declares exactly one primary geographic form:

- governed point Subject;
- bounded governed area;
- origin–destination route;
- route corridor;
- access or pickup point distinct from the Subject.

The Travel Compatibility Graph provides versioned area, corridor, transport, transfer, and
conservative-duration relationships. Live maps or routing are optional preflight evidence, not a
correctness dependency.

### Planner inputs

- governed starting area;
- optional permissioned precise start location;
- transport mode;
- available time;
- safety, documentation, rest, and daylight margins;
- Assignment duration and geography;
- Eligibility Windows and preflight evidence;
- required repetition and outstanding Objective Coverage;
- editorial priority and evidence freshness;
- safe fallback compatibility.

### Deterministic order

After hard safety, permission, eligibility, access, transport, and capacity exclusions, selection uses:

1. rare current Eligibility Window;
2. starting cluster or route-corridor compatibility;
3. outstanding required coverage;
4. editorial priority or older evidence;
5. remaining capacity fit;
6. stable Assignment ID.

The Field Plan Snapshot stores inputs, source retrieval context, exclusions, proposal, researcher
adjustments, resulting coverage effects, protocol versions, and later revisions.

## Common record fields

Every captured record has:

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Client-generated UUID and immutable identity. |
| `schemaVersion` | yes | Exact canonical record schema. |
| `protocolPackageId` | yes | Pinned Field Protocol Package. |
| `campaignId` | yes | Owning Field Campaign. |
| `assignmentId` | conditional | Originating Field Assignment. |
| `visitId` | conditional | Shared Field Visit context. |
| `researcherId` | yes | Verified Field Researcher identity, never a shared token. |
| `deviceId` | yes | Authorized Field Device reference. |
| `recordedAt` | yes | Durable-entry instant. |
| `localTimezone` | yes | IANA timezone, normally `Asia/Manila`. |
| `supersedesId` | no | Prior immutable record corrected by this record. |
| `captureState` | yes | Draft or Captured; later lifecycle states are not stored here. |

Automatic context includes IDs, times, timezone, protocol, Campaign, Assignment, researcher, device,
Method Profile, and active Visit. Weather, tide, access, crowd, road, or operating state require an
explicit observation or cited preflight source.

## Record types

### Field Visit

A Visit requires one governed Subject, governed area, governed route, or Provisional Subject. It also
records Assignment, start/end times, permissioned location state, Public Location Precision,
structured conditions, Objective links, asset links, and optional Private Context Note.

### Field Observation

An observation is atomic and has exactly one Subject. Required fields include:

- Observation Kind and value-schema version;
- directness;
- `observedAt`, `recordedAt`, timezone, offset, and time-correction indicator;
- typed value or controlled negative state;
- Method Profile and structured conditions;
- immutable Raw Measurement and unit when applicable;
- derived Normalized Measurement and conversion version when applicable;
- Capture Confidence and reason when below high;
- caveat and validity when applicable;
- review due time derived from the kind default;
- linked assets, contradictions, comparison group, and supersession;
- independently denied-by-default LLM, article, quotation, and public-use permissions.

The researcher may shorten a freshness window but cannot extend the protocol default.

### Route Run

A Route Run requires defined endpoints, transport mode, request/queue/departure/arrival times as
applicable, stops, party/luggage/access context, booking method, distance and Method Profile, price and
currency when paid, receipt link, conditions, signal checkpoints, access/transfer barriers, and what
was not tested. Duration is derived from timestamps.

### Source Statement

A Source Statement requires Source role and basis of knowledge, the question asked, original language,
exact quotation or labelled paraphrase, attribution choice, capture context, each consent scope,
consent method/time, validity or recontact window, withdrawal route, and linked assets.

A Statement Translation is a separate derivative with translator identity or method. Participation,
public location, or one permission never implies another permission.

### Evidence Asset

An asset requires kind, byte size, media type, content hash, capture time, device, purpose, linked
Objectives/records, permitted location, people-present state, rights, consent, redaction state,
retention state, and relationship to any redacted derivative. Filename is not provenance.

The first release supports photos and receipt/document scans. Direct audio and video capture remain out
of scope until their consent, encryption, retention, and deletion contracts are approved.

### Capture Exception

Controlled exception reasons are:

- `access_denied`;
- `unsafe_conditions`;
- `permission_declined`;
- `subject_unavailable`;
- `equipment_failure`;
- `eligibility_changed`;
- `interrupted`;
- `not_applicable`.

Every exception links to its Objective, time, Visit or planning context, and structured reason details.
An exception explains missing evidence; it does not fabricate Satisfied coverage.

### Schema Gap

A Schema Gap records attempted Subject, time, permitted location, Assignment/Objective, a bounded
description, and optional Evidence Asset. It cannot become Ready for Desk or enter a Field Batch until
a new protocol maps it without distortion.

## Objective and Assignment states

Objective Coverage is derived from linked typed records and exceptions:

- `unstarted`;
- `in_progress`;
- `satisfied`;
- `blocked`;
- `not_applicable` with justification;
- `needs_resolution`.

Field Assignment states are:

- `unscheduled`;
- `planned`;
- `in_progress`;
- `complete`;
- `closed_with_gaps`;
- `needs_attention`.

Complete requires every required Objective to be Satisfied or validly Not Applicable. Capture
Exceptions produce Closed with gaps. Unresolved coverage creates a linked unscheduled Follow-up
Assignment without reopening history. Deferred unstarted work returns unchanged to the pool.

## Capture and review lifecycle

```text
Draft
→ Captured
→ Needs resolution or Ready for Desk
→ Field-reviewed
→ Ready for Export or Excluded
```

Recorder, Desk, future ingestion, and Fact Admission states are separate. A captured record is
immutable. The Field Desk records Include, Exclude with reason, Needs more evidence, or Correct by
supersession. Conflicts and intentional repetitions remain preserved.

Reviewer identity and whether the reviewer matched the researcher are required. Independent review is
preferred where practical but is never fabricated.

## Standard Observation Kinds

| Kind | Required value context | Default review guidance |
| --- | --- | --- |
| `identity` | displayed/official names, aliases, category, resolution evidence | up to 180 days |
| `opening_signal` | open/closed at instant; posted hours separately evidenced | 7–30 days |
| `price` | amount, ISO currency, item, unit, party size, inclusions, posted/quoted/paid basis | 7–30 days |
| `route_duration` | endpoints, mode, timestamps, conditions | 30–90 days |
| `route_wait` | queue start, departure, mode, conditions | 7–30 days |
| `road_condition` | segment, surface, obstruction, weather context | 7–30 days |
| `facility` | facility type, controlled state, instant, access conditions | 30–90 days |
| `accessibility` | measured barrier or feature; never a generic accessible label | 30–90 days |
| `payment_method` | attempted/offered/accepted/rejected method and transaction context | 30 days |
| `connectivity` | network, device, zone, method, repeated down/up/latency values | 7–30 days |
| `power` | socket permission/state, outage, direct versus Source-stated backup | 7–30 days |
| `crowd_snapshot` | count or controlled band, boundary, instant, method | 7 days |
| `noise_snapshot` | measured dBA or controlled subjective band and method | 7 days |
| `weather_condition` | observed condition and separate authoritative source when used | hours |
| `tide_context` | observed shoreline/time and cited official/model source | hours |
| `menu_item` | item, price, availability, dietary disclosure basis | 7–30 days |
| `service_status` | controlled operating state at instant and evidence basis | 1–7 days |
| `contact_channel` | public channel, verification method, permission | 30–90 days |
| `local_caveat` | bounded warning, conditions, directness, corroboration | fact-specific |

These windows are review defaults, not truth guarantees. Safety-critical or unusually volatile
evidence expires sooner. A new protocol version is required to lengthen defaults.

## Cross-cutting controlled values

- Objective Actions: observe, measure, attempt, ask, traverse, document, repeat.
- Capture Confidence: high, medium, low; medium/low require a reason.
- State outcomes distinguish present, absent, available, unavailable, accepted, rejected, not offered,
  not tested, inaccessible, and unknown rather than collapsing to boolean.
- Conditions use governed structured vocabularies for weather, tide, road, crowd, noise, outage,
  access, and disruption.
- Money preserves decimal capture, ISO currency, pricing unit, basis, party size, inclusions, fees,
  negotiation, payment attempt, and receipt linkage.
- Raw values and units remain immutable; normalized values retain conversion lineage.
- Unknown, Not observed, Not applicable, and Capture Exception are schema-specific explicit values.
  Empty strings and placeholders always fail.

## Protected data and authorization

Protected Field Data includes precise location, private Source identity/contact, consent details,
Private Context Notes, and unredacted assets.

- The installable PWA stores protected payloads authenticated-encrypted at rest.
- A time-bounded Offline Field Grant is established through verified online identity and bound to an
  Authorized Field Device.
- Expiry locks rather than deletes evidence.
- A researcher-held Field Recovery Secret provides fallback; there is no administrative bypass.
- Protected payloads never enter PostHog, Sentry, logs, HTTP caches, service-worker caches, or silent
  background requests.
- Location permission may last for the active Visit but remains visible and revocable.
- Public Location Precision is separate from private coordinates.
- Local purge requires exact scope, fresh authorization, audit evidence, and verified recovery or a
  retention/withdrawal requirement.

## Field Recovery Export

A Field Recovery Export is a private authenticated-encrypted backup. It may contain Drafts, Captured
records, unresolved work, Capture Exceptions, Schema Gaps, assets, protocol packages, plan snapshots,
and writer/recovery metadata needed for restoration.

Its unencrypted outer receipt is limited to format version, encrypted bytes, ciphertext hash,
creation time at the minimum necessary precision, encryption/key identifiers, and restore instructions.
It contains no Campaign, Subject, record count, location, researcher identity, or field-derived
filename.

Restoration is idempotent for identical immutable content. Same-ID/different-content is quarantined.
No restore silently overwrites destination data.

## Field Batch

A Field Batch contains an explicit selection of Included, Field-reviewed, referentially closed records
and required lineage. It may span Field Day Plans.

The authoritative contract requires:

- one batch schema version and UUID;
- Field Protocol Package and component versions;
- reviewer decisions and identity/independence state;
- plural counts by record type;
- separate canonical files by record type;
- per-file byte sizes and cryptographic hashes;
- declared protected assets and relationships;
- Campaign, Assignment, Visit, researcher, correction, conflict, and review lineage;
- deterministic canonicalization and an authenticated-encrypted recipient envelope when Protected
  Field Data is present.

Export fails closed on unresolved Subject, rights, consent, asset hash, conflict disposition, review,
protocol, schema, or referential blockers. JSON is internal interchange only.

## Verified Field Transfer

Routine transfer encrypts to an Authorized Field Device registered through public-key exchange. The
Field Recovery Secret is fallback, not the routine transfer password. Transfer completion requires
recipient decryption, ciphertext and record-hash verification, referential validation, and a receipt
the source verifies.

Large exports use bounded-memory chunking or streaming and never report success after a partial write.
Device revocation prevents future trust without remotely erasing local evidence.

## Legacy Capture

The current PR #226 validator uses a passthrough schema, arbitrary observation kinds and methods,
unknown values, and an incompatible embedded-record `field-batch.v1` envelope. Records and exports from
that surface are Legacy Capture.

Legacy Capture requires explicit migration preview and mapping. Unknown or ambiguous values become
Schema Gaps or Needs resolution. Same-ID/different-content remains quarantined. No legacy **Ready**
state automatically maps to Ready for Desk or Ready for Export.

## Future server boundary

Future Field Ingestion may authenticate a Field Batch recipient, allocate quarantine, validate media,
stage records idempotently, and later support separate Field Review and Fact Admission services. It
must use a new issue, API contract, threat model, database migration, and release evidence.

Upload, server receipt, staging, review, admission, agent eligibility, and publication remain distinct
states. No successful local operation implies a later state.

## Current implementation status

Implemented by PR #226:

- protected `/admin/field-ingestion` route;
- ordinary IndexedDB queue;
- JSON/JSONL parsing and limited local checks;
- same-ID conflict preservation;
- deterministic embedded-record envelope hash;
- synthetic offline browser test.

Not implemented:

- `/operator/field` Field Workspace;
- signed Field Protocol Package or canonical generated schemas;
- flexible deterministic planner;
- guided Recorder and typed Observation Kind forms;
- encrypted local protected store, Offline Field Grant, recovery secret, or authorized device keys;
- derived Objective Coverage and Assignment outcomes;
- immutable Field Review workflow;
- authoritative Field Recovery Export or Field Batch;
- physical iPad/Mac acceptance;
- server Field Ingestion, PostgreSQL capture tables, Fact Admission, or publication.

Until issue #237 is accepted, do not hand-author JSON as production field capture, do not treat the
legacy **Ready** label as review, and do not insert field material directly into production facts.

## Related documentation

- [Run Siargao field research](../how-to-guides/run-siargao-field-research.md)
- [Deterministic Field Workspace](../explanation/deterministic-field-workspace.md)
- [Legacy field import recovery](../how-to-guides/use-offline-field-ingestion-desk.md)
- [Siargao fieldwork official source pack](siargao-fieldwork-source-pack-2026-08-16.md)

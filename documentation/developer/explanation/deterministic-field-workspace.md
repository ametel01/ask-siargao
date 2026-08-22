# Deterministic Field Workspace

The Field Workspace is the accepted product architecture for collecting first-hand Siargao evidence
without asking a Field Researcher to design forms, hand-author JSON, or improvise a daily itinerary.
Implementation is tracked by [GitHub issue #237](https://github.com/ametel01/ask-siargao/issues/237).
The current `/admin/field-ingestion` page is a legacy compatibility tool and does not implement this
architecture.

## Why the import desk is not the recorder

PR #226 delivered a protected browser queue that accepts JSON and JSON Lines, performs limited local
checks, and exports a deterministic record envelope. That boundary is useful for recovery experiments,
but it assumes that another tool already created correct structured records.

The missing product responsibility sits upstream: decide what fieldwork is worth doing, group nearby
work into a realistic outing, prompt for the exact required data, preserve explicit omissions, and
derive whether coverage is complete. File validation cannot provide that behavior after capture.

The accepted product therefore separates three concerns:

- **Field Recorder**: plans and captures typed evidence offline.
- **Field Desk**: reviews immutable capture and creates protected exports.
- **Field Ingestion**: a future authenticated server boundary for quarantine and staging.

The protected **Field Workspace** contains planning, Recorder, Desk, and export areas while preserving
those lifecycle boundaries.

## Domain hierarchy

```text
Field Campaign
└── Field Assignment (unscheduled)
    ├── Research Objective
    │   └── Coverage Requirement
    ├── Eligibility Window
    ├── Partial Coverage Set
    └── safe fallbacks

Field Day Plan
└── selected Field Assignments
    └── Field Visit
        ├── Field Observations
        ├── Route Runs
        ├── Source Statements
        ├── Evidence Assets
        ├── Capture Exceptions
        └── Schema Gaps
```

A Campaign is a scoped research programme, not a calendar. Assignments remain unscheduled until a
Field Researcher prepares an outing. A Research Objective is a required question, measurement,
attempt, statement, traversal, document, or repetition. Its Coverage Requirement defines what typed
evidence is adequate.

## Flexible planning without hidden judgement

The planner creates a Field Day Plan from the current protocol package and researcher inputs. It does
not assign fixed dates and does not ask an LLM to choose fieldwork.

Hard safety, permission, eligibility, access, transport, and capacity rules run first. Remaining
Assignments are selected through stable lexicographic rules:

1. prefer rare Eligibility Windows that would otherwise be missed;
2. keep work within the starting cluster or a compatible route corridor;
3. maximize outstanding required coverage;
4. prefer higher editorial priority or older evidence;
5. fit conservative remaining capacity;
6. resolve ties by stable Assignment identity.

The Travel Compatibility Graph models governed areas, route corridors, transport modes, transfer
boundaries, and conservative duration bands. Live routing may inform preflight but cannot silently
change deterministic grouping. Every inclusion and relevant exclusion has a human-readable reason.

The researcher may adjust a proposal. The Workspace preserves the original proposal and displays the
coverage consequence of each change. Mid-outing replanning creates a new Field Plan Snapshot rather
than rewriting history.

## Typed capture instead of generic records

The Recorder presents a stable sequence:

```text
Field Readiness
→ Plan confirmation
→ Assignment briefing
→ Safety and eligibility
→ Start Visit
→ Research Objectives
→ Resolve gaps
→ Close Visit
→ Assignment outcome
```

Each Objective Action opens a purpose-built control. A price form asks for amount, currency, item,
unit, inclusions, and posted, quoted, or paid basis. A connectivity form asks for device, network,
zone, conditions, and the required repeated measurements. A Source Statement keeps exact quotation
separate from paraphrase and records each consent scope independently.

One observation has exactly one governed or Provisional Subject. Unexpected context can be kept in a
Private Context Note, but free text cannot satisfy a Coverage Requirement. When the current protocol
cannot represent reality without distortion, the researcher records a Schema Gap. A Schema Gap remains
blocked until a new protocol explicitly maps it.

Objective Coverage is derived from linked typed records. A manual checkbox cannot declare completion.
A structured negative result can satisfy an Objective; work that was not performed cannot. Capture
Exceptions preserve exact reasons such as unsafe conditions, access denial, permission refusal,
equipment failure, or interruption.

## Immutable capture and human review

Drafts remain editable until the Visit closes. Captured records are immutable. Later corrections
supersede originals, while conflicting observations and intentional repetitions remain available for
review.

The Field Desk records one of four human decisions:

- Include;
- Exclude with reason;
- Needs more evidence;
- Correct by supersession.

The Desk records reviewer identity and whether the reviewer was also the Field Researcher. Independent
review is preferred but is not fabricated when the first release is operated by one person.

## Two export boundaries

A **Field Recovery Export** is an authenticated-encrypted backup containing complete and unfinished
work. It can include drafts, Capture Exceptions, Schema Gaps, and unresolved records.

A **Field Batch** is an authenticated-encrypted selection of Field-reviewed, referentially closed
records. It may span outings while retaining Campaign, Assignment, Visit, researcher, protocol,
reviewer, correction, and asset lineage.

These artifacts have different schemas, filenames, recipients, receipts, and restore/import actions.
Neither is created through a generic “Export validated batch” control.

## Offline custody

The maintained Recorder is an installable iPad-first PWA that also works on Mac. A verified online
identity establishes a time-bounded, device-bound Offline Field Grant. Expiry locks local work rather
than deleting it.

Protected Field Data is encrypted locally and excluded from analytics, error payloads, HTTP caches,
service-worker caches, and silent networking. Routine cross-device transfer encrypts to an Authorized
Field Device. A researcher-held Field Recovery Secret provides fallback recovery; Ask Siargao keeps no
administrative bypass.

A transfer is complete only after the recipient decrypts the archive, verifies integrity and
referential closure, and returns a receipt the source can verify. File download, Files copy, or AirDrop
completion alone is not success.

## Executable protocol

The playbook is delivered as a signed Field Protocol Package built from repository-reviewed source.
It pins compatible Campaigns, Assignments, schemas, registries, methods, governed Subjects, geography,
branching rules, and help text.

Markdown explains the workflow but is not parsed as the executable database. Canonical
machine-readable schemas generate application bindings and validated examples. Active work remains
pinned to its original package. Breaking updates use an explicit Protocol Migration that preserves
originals and quarantines ambiguous conversion.

## Release boundary

The first release ends after a verified Field Batch. It does not include server upload, PostgreSQL
capture tables, Fact Admission, agent retrieval, or publication. Those operations require separate
issues and cannot be inferred from a successful local export.

Acceptance requires physical iPad and Mac evidence in addition to automated gates. The terminal gate
is [issue #244](https://github.com/ametel01/ask-siargao/issues/244); simulator-only evidence or green CI
cannot establish field usability, recovery, accessibility, or cross-device correctness.

## Decision records

- [ADR 0026: Assemble Field Day Plans from unscheduled Assignments](../../../docs/adr/0026-assemble-field-day-plans-from-unscheduled-assignments.md)
- [ADR 0027: Protect offline fieldwork with device-bound authorization](../../../docs/adr/0027-protect-offline-fieldwork-with-device-bound-authorization.md)
- [ADR 0028: Separate field recovery from reviewed batch export](../../../docs/adr/0028-separate-field-recovery-from-reviewed-batch-export.md)
- [ADR 0029: Distribute signed versioned field protocol packages](../../../docs/adr/0029-distribute-signed-versioned-field-protocol-packages.md)

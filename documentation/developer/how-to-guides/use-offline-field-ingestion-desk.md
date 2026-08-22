# Use the Legacy Field Importer for Recovery

Use this guide only to inspect or recover records created for the compatibility boundary delivered by
PR #226. The protected page remains at `/admin/field-ingestion` until
[issue #243](https://github.com/ametel01/ask-siargao/issues/243) moves it under **Diagnostics and
Recovery**.

> **Do not use this page as the Field Recorder.** It accepts permissive JSON or JSON Lines produced
> somewhere else. It does not provide a Field Campaign, Field Assignment, Research Objectives,
> controlled kind-specific forms, derived coverage, Field Review, encrypted recovery, or an
> authoritative Field Batch.

The replacement product is described in
[Deterministic Field Workspace](../explanation/deterministic-field-workspace.md) and tracked by
[issue #237](https://github.com/ametel01/ask-siargao/issues/237).

## Understand the legacy boundary

The page currently:

- accepts `.json` and `.jsonl` files containing `field-record.v1` records;
- stores parsed records in ordinary browser IndexedDB for the current profile;
- checks a limited set of required fields, visit references, permission escalation, consent evidence,
  redaction state, duplicates, and same-ID payload conflicts;
- exposes private record JSON in its inspector;
- exports an embedded-record envelope also named `field-batch.v1`.

The current validator deliberately accepts passthrough properties, arbitrary `observationKind`,
arbitrary `method`, arbitrary condition/purpose/rights strings, and an unknown `value` shape. Its
**Ready** label means only that these limited checks passed. It does not mean protocol-complete,
Field-reviewed, factually correct, safe to publish, or eligible for future ingestion.

The current envelope conflicts with the accepted Field Batch contract. Treat every export from this
page as **Legacy Capture**, not as a reviewed Field Batch.

## Inspect a legacy export

1. Preserve the original source files and assets outside browser storage.
2. Open `/admin/field-ingestion` only through an authorized Operator Account or the configured local
   development access boundary.
3. Import only files from a known PR #226-compatible source.
4. Review rejected rows, same-ID variants, missing Visits, permissions, consent, and asset state.
5. Do not resolve a conflict by deleting its only source copy.
6. If an envelope must be retained, label it Legacy Capture and keep the original inputs beside it.
7. Record any arbitrary or unmappable value as a future Schema Gap; do not coerce it into the accepted
   protocol.

Do not download the sample template and treat placeholder values as valid research. In particular,
`replace_with_controlled_kind` passes the legacy validator even though it is not an accepted
Observation Kind.

## Recover after interruption

- Reopen the same browser profile and verify the queue contents against the original source files.
- If site data was cleared or the queue is empty, restore from the source export; IndexedDB is not a
  backup.
- If a digest changed unexpectedly, retain both variants and investigate.
- If storage reports an error, assume no row was durably saved until verified.
- If consent is withdrawn, block the affected material and preserve only the minimum governed audit
  evidence allowed by policy.

## Privacy boundary

Do not send notes, quotations, filenames, coordinates, contact details, consent details, raw JSON,
record identifiers, or media to PostHog, Sentry, logs, support messages, or public APIs. The current
page does not encrypt its IndexedDB payloads and must not be treated as the long-term protected store.

## Migration boundary

The replacement must quarantine legacy records and show an explicit mapping preview. A Legacy Capture
record cannot automatically become Ready for Desk or Ready for Export. Same-ID/different-content
variants remain quarantined, and original files remain immutable.

Server upload, PostgreSQL insertion, Fact Admission, chat retrieval, and publication remain out of
scope.

## Related documentation

- [Run Siargao field research](run-siargao-field-research.md)
- [Deterministic Field Workspace](../explanation/deterministic-field-workspace.md)
- [Field research data model](../reference/field-research-data-model.md)

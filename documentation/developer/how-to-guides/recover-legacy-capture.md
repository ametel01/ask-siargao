# Recover Legacy Capture

Use this procedure to preserve and diagnose records created for the PR #226 compatibility boundary.
It does not describe new field capture. New work belongs in the Field Recorder under
`/operator/field/capture`.

## Prerequisites

- Sign in with an allowlisted Field Researcher or Operator Account.
- Use an Authorized Field Device with an unexpired Offline Field Grant.
- Keep the original file unchanged until encrypted custody and recovery are verified.
- Use only a known PR #226 source. Filename is explanatory only and never supplies a missing version.

## Preserve and preview a source

1. Open `/operator/field/diagnostics-recovery/legacy-import`.
2. Verify the page says **Legacy import — Diagnostics and Recovery** and the device is unlocked.
3. Read the compatibility boundary before selecting a file.
4. Select one exact supported artifact:
   - one `field-record.v1` JSON record;
   - a JSON array containing only `field-record.v1` records;
   - JSON Lines where every non-empty row is `field-record.v1`; or
   - an embedded-record `field-batch.v1` whose identity, campaign, timezone, plural counts, and
     canonical payload SHA-256 are internally consistent.
5. Wait for the encrypted source-preservation receipt and non-mutating Protocol Migration preview.
6. Review every explicit mapping, omission, reference gap, rights gap, validation blocker, conflict,
   and Schema Gap candidate.
7. Choose **Defer resolution** or **Preserve quarantined decision**. Both decisions remain append-only;
   neither promotes the source into Recorder, Desk, or export custody.

The compatibility workflow rejects missing or mixed versions, unknown versions, current
`field-batch.v2`, current encrypted receipts, and generic objects that merely contain a `records`
array. Historical permission claims never grant current LLM, article, quotation, or public use.

## Handle conflicts and repeat imports

- Repeating identical source bytes reuses the existing encrypted source and preview.
- The same immutable ID with the same canonical content is an exact replay.
- The same immutable ID with different content preserves every variant and quarantines the entire
  identity. Do not delete a variant to make another appear acceptable.
- A changed protected destination makes an older preview stale. Rebuild the preview before recording
  another decision.
- Unknown or unrepresentable values remain explicit Schema Gap candidates. Do not coerce them into a
  best-fit current value.

## Recover historical browser rows

Choose **Discover old browser custody** only after unlocking the Authorized Field Device. The adapter
reads the old `ask-siargao-field-ingestion` IndexedDB database without changing or clearing it, then
copies each discoverable variant into the encrypted Field Vault.

PR #226 retained `sourceName`, `importedAt`, a canonical signature, and the parsed record, but did not
retain original file bytes. The recovery record therefore says `original_bytes_unavailable`; it does
not invent an original hash or offer a reconstructed file as the original.

## Verify recovery

1. Create a Field Recovery Export from the protected Exports area.
2. Verify that its encrypted payload includes the Legacy Capture index and the referenced opaque
   source, preview, and decision envelopes.
3. Restore into an Authorized Field Device through the normal Recovery preview and confirmation
   boundary.
4. Confirm identical sources are idempotent and same-ID variants remain quarantined.

A Field Recovery Export is private custody, not a reviewed Field Batch. A file copy or AirDrop alone
is not a Verified Field Transfer.

## Use the temporary alias during rollback

`/admin/field-ingestion` normally returns a temporary redirect to the canonical route. A controlled
rollback may set `FIELD_LEGACY_IMPORT_ALIAS_MODE=fallback`; that old URL then renders the same
Field-Researcher-authorized, device-locked compatibility component. Invalid or missing configuration
defaults to redirect.

Rollback never restores local admin-token access, the old template, raw JSON inspector, record
deletion, queue clearing, **Ready** labels, or embedded `field-batch.v1` export.

## Related documentation

- [Run Siargao field research](run-siargao-field-research.md)
- [Deterministic Field Workspace](../explanation/deterministic-field-workspace.md)
- [Field research protocol and data reference](../reference/field-research-data-model.md)
- [Routes and surfaces reference](../reference/routes-and-surfaces.md)

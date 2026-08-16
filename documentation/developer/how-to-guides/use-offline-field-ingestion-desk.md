# Use the Offline Field Ingestion Desk

Use this guide to move structured field records from an iPad to a Mac, check them without an
internet connection, preserve a private review queue, and export one validated batch envelope. The
desk is available at `/admin/field-ingestion`.

This workflow does not upload records, write to PostgreSQL, admit facts, publish guide changes, or
copy binary media into the browser. It is the safe bridge between field capture and the future
quarantine and staging importer.

## Understand the Connection Boundary

Connecting and trusting an iPad lets macOS recognize it in Finder. It does not mount every Files app
location as a general-purpose disk, and it does not authorize Ask Siargao to silently browse the
iPad. Finder file sharing exposes only apps that support file sharing.

Use one of these explicit handoffs:

1. AirDrop selected JSON, JSON Lines, and small supporting files from the iPad to the Mac.
2. Use Finder file sharing when the capture app appears under the connected iPad's **Files** tab.
3. Export to an agreed iCloud Drive folder when network-backed synchronization is acceptable.
4. Copy to an external drive from Files and attach that drive to the Mac for large media sets.

Apple documents the current connection and transfer behavior in:

- [Connect iPad and your computer with a cable](https://support.apple.com/guide/ipad/ipad756c56a8/ipados)
- [Sync files from a Mac to an iPhone or iPad](https://support.apple.com/guide/mac-help/sync-files-to-your-device-mchl4bd77d3a/mac)
- [Transfer files between an iPad and other devices](https://support.apple.com/guide/ipad/ipade9d848b8/ipados)
- [Use AirDrop on iPad](https://support.apple.com/guide/ipad/ipad46a13d74/ipados)

## Prepare the Mac Before Going Offline

1. From the repository root, install dependencies while online:

   ```sh
   bun install
   ```

2. Build the application before leaving reliable connectivity:

   ```sh
   bun run build
   ```

3. Start the built application on the Mac:

   ```sh
   bun run start -- --hostname 127.0.0.1 --port 3100
   ```

4. In a browser on the Mac, open `http://localhost:3100/admin/field-ingestion`.
5. Confirm the header says **Private browser storage ready**.
6. Download the capture template and import it once as a rehearsal.
7. Clear the rehearsal queue without deleting the downloaded original.

The desk is internet-independent while the local Mac server is running. It is not a standalone iPad
PWA in this version: a full browser reload still needs the local Next.js server, and directly opening
the Mac's plain-HTTP LAN address on iPad is not a supported secure capture path.

## Connect and Trust the iPad

1. Connect the iPad using a data-capable USB or USB-C cable.
2. Unlock the iPad and keep its screen awake during the first connection.
3. On the Mac, approve **Allow accessory to connect** if macOS asks.
4. Select the iPad in Finder and choose **Trust**.
5. On the iPad, choose **Trust** and enter the iPad passcode.
6. Confirm the iPad appears in the Finder sidebar.

If it does not appear, verify the cable supports data, try another port, and repeat the trust flow.
Apple's [device recognition troubleshooting](https://support.apple.com/108643) is the authoritative
fallback.

## Export From the iPad

Keep records and binary assets in separate folders:

```text
field-batch-working/
├── records/
│   ├── visits.jsonl
│   ├── observations.jsonl
│   ├── statements.jsonl
│   ├── route-runs.jsonl
│   └── assets.jsonl
└── assets-private/
    ├── <asset-id>.heic
    └── <asset-id>.m4a
```

Each record must carry `schemaVersion: "field-record.v1"`, a client-generated UUID, a client batch
UUID, a campaign slug, a capture timestamp with an offset, and a local timezone. Canonical JSON
Lines filenames may omit `recordType`; the desk infers it from the filename. A generic JSON file
must include `recordType`.

Default `llmUseAllowed`, `articleUseAllowed`, and `publicRepublishAllowed` to `false`. Preserve the
original export even when a row is malformed. Corrections receive a new record or follow the
supersession policy; do not rewrite a surprising observation in place.

## Import and Review Records

1. Transfer the `records` files to a private Mac folder.
2. Open `/admin/field-ingestion` on the Mac.
3. Choose **Choose export files** and select one or more `.json` or `.jsonl` files.
4. Read the import result. Invalid JSON and schema-invalid rows are rejected and shown with a file,
   row, and field path when available.
5. Filter the local queue by **Ready**, **Needs attention**, or **Conflicts**.
6. Select a row to inspect its exact blockers and private JSON.
7. Remove only the incorrect local variant. Keep its source export for the audit trail.
8. Repeat the import after creating a corrected source record.

The queue persists in IndexedDB for that browser profile. It is not a backup. Clearing browser site
data, using private browsing, changing browser profiles, or clearing the queue can remove it.

## Interpret Local Checks

The desk performs these checks before enabling export:

| Code | Meaning | Required action |
| --- | --- | --- |
| `schema_error` | A field is missing, malformed, or outside its controlled values. | Correct the source record and re-import it. |
| `id_payload_conflict` | One immutable record ID has more than one payload. | Preserve the originals, decide which variant is valid, and remove the other local variant. |
| `mixed_client_batches` | The queue contains more than one client batch UUID. | Export and clear one batch at a time. |
| `mixed_campaigns` | The queue contains more than one campaign. | Separate the campaigns into different exports. |
| `missing_visit` | An observation, statement, route run, or asset references an absent visit. | Import the referenced visit record. |
| `capture_permission_escalation` | A captured observation grants LLM, article, or public use. | Restore capture permissions to false; review grants happen later. |
| `consent_evidence_missing` | A non-internal statement scope lacks a consent time or method. | Record the exact consent evidence or keep the statement internal. |
| `redaction_pending` | An indexed asset still needs a redacted derivative or review. | Finish redaction review before export. |
| `asset_blocked` | An asset is explicitly blocked. | Remove it from the export set without deleting the governed original. |

An identical retry is idempotent and does not create a second queue row. A different payload with
the same ID remains visible as a conflict instead of overwriting either variant.

## Export a Validated Envelope

When every row is ready, choose **Export validated batch**. The browser downloads:

```text
field-batch-<client-batch-id>.json
```

The portable envelope contains:

- `schemaVersion: "field-batch.v1"`;
- one client batch UUID and campaign slug;
- an export timestamp and local timezone;
- counts by record type;
- a SHA-256 digest of canonicalized, deterministically ordered records;
- the validated records.

This is a record-only staging envelope. It does not replace the final ZIP bundle manifest, per-file
hashes, media quarantine, malware scanning, server authentication, idempotent database transaction,
or human review. Keep `assets-private` beside it until the later packager verifies the asset index and
builds the complete governed bundle.

## Recover Safely

- If the Mac loses power, restart the local server and reopen the same browser profile. IndexedDB
  should restore the queue, but the iPad export remains the source of recovery.
- If import reports a storage error, stop. Do not assume any row was saved; retain and retry from the
  original export.
- If export is disabled, inspect the non-ready filters. Do not edit the downloaded batch by hand.
- If a digest changes without an intentional source correction, retain both exports and investigate
  before staging.
- If consent is withdrawn, block the affected record and asset immediately. Do not wait for weekly
  packaging.

## Privacy and Analytics Boundary

The desk has no PostHog capture calls and no database route. Do not add raw notes, quotes, filenames,
coordinates, contact details, consent details, private record JSON, or media to analytics. Future
workflow analytics may record coarse counts and state transitions only, as defined by the field data
model.

## Related Documentation

- [Run Siargao field research](run-siargao-field-research.md)
- [Field research data model](../reference/field-research-data-model.md)
- [Siargao fieldwork official source pack](../reference/siargao-fieldwork-source-pack-2026-08-16.md)

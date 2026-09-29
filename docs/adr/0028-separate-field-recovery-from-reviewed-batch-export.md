# Separate field recovery from reviewed batch export

Ask Siargao uses a Field Recovery Export for complete private device backup and a Field Batch for an
explicit selection of Field-reviewed, referentially closed records. Captured records are immutable;
corrections supersede them, Field Review records inclusion or exclusion without rewriting capture, and
Legacy Capture remains quarantined until explicitly mapped into the current protocol. This preserves
unfinished work and provenance while preventing a backup, parseable file, or historical loose record
from masquerading as ingestion-ready evidence.

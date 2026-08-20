CREATE TABLE operational_reconciliation_cursors (
  scope_key text PRIMARY KEY,
  cursor_offset integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT operational_reconciliation_cursors_offset_check CHECK (cursor_offset >= 0)
);

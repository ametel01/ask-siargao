ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS completion_status text NOT NULL DEFAULT 'complete',
  ADD COLUMN IF NOT EXISTS termination_reason text;

ALTER TABLE chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_completion_status_check,
  ADD CONSTRAINT chat_messages_completion_status_check
    CHECK (completion_status IN ('complete', 'completed_with_limits')),
  DROP CONSTRAINT IF EXISTS chat_messages_termination_reason_check,
  ADD CONSTRAINT chat_messages_termination_reason_check
    CHECK (
      termination_reason IS NULL
      OR termination_reason IN (
        'model_response_budget_exhausted',
        'model_response_invalid',
        'model_response_unavailable'
      )
    );

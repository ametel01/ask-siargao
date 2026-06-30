ALTER TABLE chat_messages
ADD COLUMN IF NOT EXISTS decision_summaries_json jsonb NOT NULL DEFAULT '[]'::jsonb;

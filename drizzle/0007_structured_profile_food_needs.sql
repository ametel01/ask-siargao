ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS food_needs_json jsonb NOT NULL DEFAULT '[]'::jsonb;

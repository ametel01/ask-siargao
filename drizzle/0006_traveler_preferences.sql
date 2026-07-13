ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS surf_ability text,
  ADD COLUMN IF NOT EXISTS quiet_sleep_preference boolean,
  ADD COLUMN IF NOT EXISTS weather_preference text;

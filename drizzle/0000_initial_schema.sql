CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS saved_trips (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id),
  client_trip_key_hash text NOT NULL UNIQUE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_trips_client_trip_key_hash_idx
  ON saved_trips(client_trip_key_hash);

CREATE TABLE IF NOT EXISTS saved_trip_items (
  id text NOT NULL,
  trip_id text NOT NULL REFERENCES saved_trips(id),
  kind text NOT NULL,
  title text NOT NULL,
  payload_json jsonb NOT NULL,
  sources_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  PRIMARY KEY (trip_id, id)
);

ALTER TABLE saved_trip_items DROP CONSTRAINT IF EXISTS saved_trip_items_pkey;
ALTER TABLE saved_trip_items ADD PRIMARY KEY (trip_id, id);

CREATE INDEX IF NOT EXISTS saved_trip_items_trip_id_idx
  ON saved_trip_items(trip_id);

CREATE INDEX IF NOT EXISTS saved_trip_items_deleted_at_idx
  ON saved_trip_items(deleted_at);

CREATE TABLE IF NOT EXISTS shared_trip_plans (
  id text PRIMARY KEY,
  trip_id text NOT NULL REFERENCES saved_trips(id),
  public_token_hash text NOT NULL UNIQUE,
  title text NOT NULL,
  item_ids_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  items_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shared_trip_plans
  ADD COLUMN IF NOT EXISTS items_json jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS shared_trip_plans_trip_id_idx
  ON shared_trip_plans(trip_id);

CREATE INDEX IF NOT EXISTS shared_trip_plans_public_token_hash_idx
  ON shared_trip_plans(public_token_hash);

CREATE INDEX IF NOT EXISTS shared_trip_plans_expires_at_idx
  ON shared_trip_plans(expires_at);

CREATE TABLE IF NOT EXISTS areas (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  municipality text NOT NULL,
  description text NOT NULL,
  latitude numeric,
  longitude numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS routes (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  origin text NOT NULL,
  destination text NOT NULL,
  transport_modes jsonb NOT NULL DEFAULT '[]'::jsonb,
  risk_notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS providers (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  provider_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_profiles (
  id text PRIMARY KEY,
  provider_id text REFERENCES providers(id),
  source_name text NOT NULL,
  source_type text NOT NULL,
  access_method text NOT NULL,
  allowed_use text NOT NULL,
  robots_policy text,
  terms_url text,
  rate_limit text,
  freshness_window_days integer NOT NULL,
  authority_level integer NOT NULL,
  stores_raw_allowed boolean NOT NULL DEFAULT false,
  publishes_raw_allowed boolean NOT NULL DEFAULT false,
  requires_partner_approval boolean NOT NULL DEFAULT false,
  known_stale_risk text NOT NULL DEFAULT 'medium',
  known_ai_or_seo_content_risk text NOT NULL DEFAULT 'medium',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_permissions (
  id text PRIMARY KEY,
  source_profile_id text NOT NULL REFERENCES source_profiles(id),
  use_case text NOT NULL,
  allowed_use text NOT NULL,
  public_republish_allowed boolean NOT NULL DEFAULT false,
  citation_allowed boolean NOT NULL DEFAULT false,
  raw_storage_allowed boolean NOT NULL DEFAULT false,
  llm_exposure_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entities (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  entity_type text NOT NULL,
  name text NOT NULL,
  area_id text REFERENCES areas(id),
  aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
  public_visibility text NOT NULL DEFAULT 'internal',
  confidence_label text NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accommodations (
  id text PRIMARY KEY,
  entity_id text NOT NULL UNIQUE REFERENCES entities(id),
  accommodation_type text NOT NULL,
  address text,
  platform_refs jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS raw_snapshots (
  id text PRIMARY KEY,
  source_profile_id text NOT NULL REFERENCES source_profiles(id),
  fetched_at timestamptz NOT NULL,
  content_hash text NOT NULL,
  storage_uri text,
  raw_payload jsonb,
  allowed_use text NOT NULL,
  retention_expires_at timestamptz
);

CREATE TABLE IF NOT EXISTS source_records (
  id text PRIMARY KEY,
  source_profile_id text NOT NULL REFERENCES source_profiles(id),
  raw_snapshot_id text REFERENCES raw_snapshots(id),
  provider_entity_id text,
  entity_type text NOT NULL,
  name text NOT NULL,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_url text,
  fetched_at timestamptz NOT NULL,
  allowed_use text NOT NULL
);

CREATE TABLE IF NOT EXISTS google_places (
  place_id text PRIMARY KEY,
  resource_name text,
  latest_source_record_id text REFERENCES source_records(id),
  canonical_entity_id text REFERENCES entities(id),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_details_fetched_at timestamptz,
  details_stale_at timestamptz
);

CREATE INDEX IF NOT EXISTS google_places_details_stale_at_idx
  ON google_places(details_stale_at);

CREATE TABLE IF NOT EXISTS google_place_snapshots (
  id text PRIMARY KEY,
  place_id text NOT NULL REFERENCES google_places(place_id),
  source_record_id text NOT NULL REFERENCES source_records(id),
  request_kind text NOT NULL,
  field_mask text NOT NULL,
  payload_json jsonb,
  payload_hash text,
  fetched_at timestamptz NOT NULL,
  stale_at timestamptz NOT NULL,
  retention_expires_at timestamptz,
  storage_policy text NOT NULL,
  attribution_json jsonb
);

CREATE INDEX IF NOT EXISTS google_place_snapshots_place_id_idx
  ON google_place_snapshots(place_id);

CREATE INDEX IF NOT EXISTS google_place_snapshots_stale_at_idx
  ON google_place_snapshots(stale_at);

CREATE INDEX IF NOT EXISTS google_place_snapshots_retention_expires_at_idx
  ON google_place_snapshots(retention_expires_at);

CREATE TABLE IF NOT EXISTS google_place_details (
  place_id text PRIMARY KEY REFERENCES google_places(place_id),
  display_name_json jsonb,
  formatted_address text,
  short_formatted_address text,
  address_components_json jsonb,
  location_json jsonb,
  latitude numeric,
  longitude numeric,
  viewport_json jsonb,
  types_json jsonb,
  primary_type text,
  business_status text,
  google_maps_uri text,
  website_uri text,
  national_phone_number text,
  international_phone_number text,
  opening_hours_json jsonb,
  price_level text,
  price_range_json jsonb,
  rating numeric,
  user_rating_count integer,
  payment_options_json jsonb,
  parking_options_json jsonb,
  amenities_json jsonb,
  attributions_json jsonb,
  fetched_at timestamptz NOT NULL,
  stale_at timestamptz NOT NULL,
  retention_expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS google_place_details_stale_at_idx
  ON google_place_details(stale_at);

CREATE INDEX IF NOT EXISTS google_place_details_retention_expires_at_idx
  ON google_place_details(retention_expires_at);

CREATE TABLE IF NOT EXISTS google_place_reviews (
  id text PRIMARY KEY,
  place_id text NOT NULL REFERENCES google_places(place_id),
  snapshot_id text NOT NULL REFERENCES google_place_snapshots(id),
  review_name text,
  relative_publish_time_description text,
  rating numeric,
  text_json jsonb,
  original_text_json jsonb,
  author_attribution_json jsonb,
  publish_time timestamptz,
  flagged_content boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL,
  stale_at timestamptz NOT NULL,
  retention_expires_at timestamptz NOT NULL,
  display_requires_google_attribution boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS google_place_reviews_place_id_idx
  ON google_place_reviews(place_id);

CREATE INDEX IF NOT EXISTS google_place_reviews_snapshot_id_idx
  ON google_place_reviews(snapshot_id);

CREATE INDEX IF NOT EXISTS google_place_reviews_stale_at_idx
  ON google_place_reviews(stale_at);

CREATE INDEX IF NOT EXISTS google_place_reviews_retention_expires_at_idx
  ON google_place_reviews(retention_expires_at);

CREATE TABLE IF NOT EXISTS candidate_entities (
  id text PRIMARY KEY,
  candidate_name text NOT NULL,
  candidate_type text NOT NULL,
  source_profile_id text NOT NULL REFERENCES source_profiles(id),
  source_record_id text REFERENCES source_records(id),
  raw_location text,
  raw_category text,
  raw_contact text,
  discovery_confidence numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entity_matches (
  id text PRIMARY KEY,
  entity_id text REFERENCES entities(id),
  candidate_entity_id text NOT NULL REFERENCES candidate_entities(id),
  match_status text NOT NULL,
  match_score numeric NOT NULL,
  matched_source_record_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  conflict_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  requires_user_followup boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS facts (
  id text PRIMARY KEY,
  entity_id text REFERENCES entities(id),
  claim text NOT NULL,
  fact_type text NOT NULL,
  source_type text NOT NULL,
  source_profile_id text REFERENCES source_profiles(id),
  source_record_id text REFERENCES source_records(id),
  fetched_at timestamptz NOT NULL,
  verified_at timestamptz,
  expires_at timestamptz,
  confidence_label text NOT NULL,
  source_authority integer NOT NULL,
  public_republish_allowed boolean NOT NULL DEFAULT false,
  audit_use_allowed boolean NOT NULL DEFAULT true,
  raw_evidence_allowed boolean NOT NULL DEFAULT false,
  conflicts_with_fact_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY,
  fact_id text NOT NULL REFERENCES facts(id),
  source_record_id text REFERENCES source_records(id),
  label text NOT NULL,
  citation_url text,
  citation_text text,
  allowed_use text NOT NULL,
  public_republish_allowed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviews (
  id text PRIMARY KEY,
  entity_id text REFERENCES entities(id),
  source_record_id text REFERENCES source_records(id),
  rating numeric,
  review_count integer,
  themes jsonb NOT NULL DEFAULT '[]'::jsonb,
  fetched_at timestamptz NOT NULL,
  allowed_use text NOT NULL
);

CREATE TABLE IF NOT EXISTS fact_confidence_scores (
  id text PRIMARY KEY,
  fact_id text NOT NULL REFERENCES facts(id),
  score numeric NOT NULL,
  label text NOT NULL,
  drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  scored_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS source_credibility_scores (
  id text PRIMARY KEY,
  source_profile_id text NOT NULL REFERENCES source_profiles(id),
  score numeric NOT NULL,
  label text NOT NULL,
  drivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  scored_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fact_conflicts (
  id text PRIMARY KEY,
  primary_fact_id text NOT NULL REFERENCES facts(id),
  conflicting_fact_id text NOT NULL REFERENCES facts(id),
  conflict_type text NOT NULL,
  severity text NOT NULL,
  resolution_status text NOT NULL DEFAULT 'open',
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_requests (
  id text PRIMARY KEY,
  user_id text REFERENCES users(id),
  email text,
  status text NOT NULL,
  price_usd numeric NOT NULL DEFAULT 9.99,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_inputs (
  id text PRIMARY KEY,
  audit_request_id text NOT NULL REFERENCES audit_requests(id),
  travel_month text,
  start_date date,
  end_date date,
  arrival_origin text,
  arrival_route_id text REFERENCES routes(id),
  accommodation_name text,
  accommodation_entity_id text REFERENCES entities(id),
  stay_area_id text REFERENCES areas(id),
  top_constraint text NOT NULL,
  optional_modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  traveler_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_runs (
  id text PRIMARY KEY,
  audit_request_id text NOT NULL REFERENCES audit_requests(id),
  state text NOT NULL,
  state_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  last_error text
);

CREATE TABLE IF NOT EXISTS audit_completeness_checks (
  id text PRIMARY KEY,
  audit_request_id text NOT NULL REFERENCES audit_requests(id),
  can_complete boolean NOT NULL,
  blocking_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  preview_risk jsonb,
  required_user_followups jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_summary jsonb NOT NULL DEFAULT '[]'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY,
  audit_request_id text NOT NULL REFERENCES audit_requests(id),
  stripe_checkout_session_id text UNIQUE,
  stripe_payment_intent_id text,
  stripe_event_id text UNIQUE,
  amount_usd numeric NOT NULL,
  status text NOT NULL,
  webhook_verified_at timestamptz,
  diagnostic_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_events (
  id text PRIMARY KEY,
  audit_request_id text NOT NULL REFERENCES audit_requests(id),
  stripe_event_id text NOT NULL UNIQUE,
  stripe_checkout_session_id text NOT NULL,
  stripe_payment_intent_id text,
  event_type text NOT NULL,
  verified_at timestamptz NOT NULL,
  raw_event jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_reports (
  id text PRIMARY KEY,
  audit_request_id text NOT NULL REFERENCES audit_requests(id),
  audit_run_id text REFERENCES audit_runs(id),
  overall_risk text NOT NULL,
  confidence_label text NOT NULL,
  report_json jsonb NOT NULL,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  limitations jsonb NOT NULL DEFAULT '[]'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refresh_jobs (
  id text PRIMARY KEY,
  fact_id text REFERENCES facts(id),
  source_profile_id text REFERENCES source_profiles(id),
  entity_id text REFERENCES entities(id),
  refresh_reason text NOT NULL,
  priority integer NOT NULL,
  provider_budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_at timestamptz NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  last_error text,
  result_status text NOT NULL DEFAULT 'scheduled'
);

CREATE TABLE IF NOT EXISTS public_evidence_bundles (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  summary text NOT NULL,
  allowed_use text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public_pages (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  page_type text NOT NULL,
  entity_id text REFERENCES entities(id),
  canonical_url text NOT NULL,
  human_path text NOT NULL,
  llm_markdown_path text NOT NULL,
  json_api_path text NOT NULL,
  evidence_bundle_id text REFERENCES public_evidence_bundles(id),
  last_generated_at timestamptz,
  last_verified_at timestamptz,
  confidence_label text NOT NULL,
  public_visibility text NOT NULL,
  indexing_status text NOT NULL,
  stale_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  generation_source_fact_ids jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS agent_readable_snapshots (
  id text PRIMARY KEY,
  public_page_id text NOT NULL REFERENCES public_pages(id),
  format text NOT NULL,
  path text NOT NULL,
  content_hash text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS llm_runs (
  id text PRIMARY KEY,
  audit_run_id text REFERENCES audit_runs(id),
  run_type text NOT NULL,
  model_family text NOT NULL,
  input_redaction_version text NOT NULL,
  output_schema_version text NOT NULL,
  status text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS llm_tool_calls (
  id text PRIMARY KEY,
  llm_run_id text NOT NULL REFERENCES llm_runs(id),
  tool_name text NOT NULL,
  arguments_json jsonb NOT NULL,
  result_json jsonb,
  evidence_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  called_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reviewer_results (
  id text PRIMARY KEY,
  audit_run_id text REFERENCES audit_runs(id),
  llm_run_id text REFERENCES llm_runs(id),
  verdict text NOT NULL,
  corrections jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocked_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS provider_health_checks (
  id text PRIMARY KEY,
  provider_id text NOT NULL REFERENCES providers(id),
  status text NOT NULL,
  latency_ms integer,
  checked_at timestamptz NOT NULL DEFAULT now(),
  last_error text
);

CREATE TABLE IF NOT EXISTS public_page_generation_jobs (
  id text PRIMARY KEY,
  public_page_id text REFERENCES public_pages(id),
  status text NOT NULL,
  reason text NOT NULL,
  scheduled_at timestamptz NOT NULL,
  completed_at timestamptz,
  last_error text
);

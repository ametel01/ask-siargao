INSERT INTO providers (id, slug, name, provider_type)
VALUES ('provider_google_places', 'google-places', 'Google Places', 'places_api')
ON CONFLICT (id) DO NOTHING;

INSERT INTO source_profiles (
  id,
  provider_id,
  source_name,
  source_type,
  access_method,
  allowed_use,
  terms_url,
  rate_limit,
  freshness_window_days,
  authority_level,
  stores_raw_allowed,
  publishes_raw_allowed,
  requires_partner_approval,
  known_stale_risk,
  known_ai_or_seo_content_risk,
  notes
)
VALUES (
  'source_google_places',
  'provider_google_places',
  'Google Places API profile',
  'licensed_api',
  'api',
  'citation_only',
  'https://cloud.google.com/maps-platform/terms',
  'quota-controlled Google Maps Platform API',
  30,
  3,
  false,
  false,
  false,
  'medium',
  'low',
  'Google Places API source for Place ID discovery and refreshable accommodation/POI evidence. Store durable Place IDs, not copied public directory content.'
)
ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS chat_response_ratings_message_id_idx
  ON chat_response_ratings(message_id);

CREATE INDEX IF NOT EXISTS source_profiles_provider_id_idx
  ON source_profiles(provider_id);

CREATE INDEX IF NOT EXISTS source_permissions_source_profile_id_idx
  ON source_permissions(source_profile_id);

CREATE INDEX IF NOT EXISTS entities_area_id_idx
  ON entities(area_id);

CREATE INDEX IF NOT EXISTS raw_snapshots_source_profile_id_idx
  ON raw_snapshots(source_profile_id);

CREATE INDEX IF NOT EXISTS source_records_source_profile_id_idx
  ON source_records(source_profile_id);

CREATE INDEX IF NOT EXISTS source_records_raw_snapshot_id_idx
  ON source_records(raw_snapshot_id);

CREATE INDEX IF NOT EXISTS google_places_latest_source_record_id_idx
  ON google_places(latest_source_record_id);

CREATE INDEX IF NOT EXISTS google_places_canonical_entity_id_idx
  ON google_places(canonical_entity_id);

CREATE INDEX IF NOT EXISTS google_place_snapshots_source_record_id_idx
  ON google_place_snapshots(source_record_id);

CREATE INDEX IF NOT EXISTS candidate_entities_source_profile_id_idx
  ON candidate_entities(source_profile_id);

CREATE INDEX IF NOT EXISTS candidate_entities_source_record_id_idx
  ON candidate_entities(source_record_id);

CREATE INDEX IF NOT EXISTS entity_matches_entity_id_idx
  ON entity_matches(entity_id);

CREATE INDEX IF NOT EXISTS entity_matches_candidate_entity_id_idx
  ON entity_matches(candidate_entity_id);

CREATE INDEX IF NOT EXISTS facts_entity_id_idx
  ON facts(entity_id);

CREATE INDEX IF NOT EXISTS facts_source_profile_id_idx
  ON facts(source_profile_id);

CREATE INDEX IF NOT EXISTS facts_source_record_id_idx
  ON facts(source_record_id);

CREATE INDEX IF NOT EXISTS evidence_fact_id_idx
  ON evidence(fact_id);

CREATE INDEX IF NOT EXISTS evidence_source_record_id_idx
  ON evidence(source_record_id);

CREATE INDEX IF NOT EXISTS reviews_entity_id_idx
  ON reviews(entity_id);

CREATE INDEX IF NOT EXISTS reviews_source_record_id_idx
  ON reviews(source_record_id);

CREATE INDEX IF NOT EXISTS fact_confidence_scores_fact_id_idx
  ON fact_confidence_scores(fact_id);

CREATE INDEX IF NOT EXISTS source_credibility_scores_source_profile_id_idx
  ON source_credibility_scores(source_profile_id);

CREATE INDEX IF NOT EXISTS fact_conflicts_primary_fact_id_idx
  ON fact_conflicts(primary_fact_id);

CREATE INDEX IF NOT EXISTS fact_conflicts_conflicting_fact_id_idx
  ON fact_conflicts(conflicting_fact_id);

CREATE INDEX IF NOT EXISTS audit_requests_user_id_idx
  ON audit_requests(user_id);

CREATE INDEX IF NOT EXISTS audit_inputs_audit_request_id_idx
  ON audit_inputs(audit_request_id);

CREATE INDEX IF NOT EXISTS audit_inputs_arrival_route_id_idx
  ON audit_inputs(arrival_route_id);

CREATE INDEX IF NOT EXISTS audit_inputs_accommodation_entity_id_idx
  ON audit_inputs(accommodation_entity_id);

CREATE INDEX IF NOT EXISTS audit_inputs_stay_area_id_idx
  ON audit_inputs(stay_area_id);

CREATE INDEX IF NOT EXISTS audit_runs_audit_request_id_idx
  ON audit_runs(audit_request_id);

CREATE INDEX IF NOT EXISTS audit_completeness_checks_audit_request_id_idx
  ON audit_completeness_checks(audit_request_id);

CREATE INDEX IF NOT EXISTS payments_audit_request_id_idx
  ON payments(audit_request_id);

CREATE INDEX IF NOT EXISTS payment_events_audit_request_id_idx
  ON payment_events(audit_request_id);

CREATE INDEX IF NOT EXISTS audit_reports_audit_request_id_idx
  ON audit_reports(audit_request_id);

CREATE INDEX IF NOT EXISTS audit_reports_audit_run_id_idx
  ON audit_reports(audit_run_id);

CREATE INDEX IF NOT EXISTS refresh_jobs_fact_id_idx
  ON refresh_jobs(fact_id);

CREATE INDEX IF NOT EXISTS refresh_jobs_source_profile_id_idx
  ON refresh_jobs(source_profile_id);

CREATE INDEX IF NOT EXISTS refresh_jobs_entity_id_idx
  ON refresh_jobs(entity_id);

CREATE INDEX IF NOT EXISTS public_pages_entity_id_idx
  ON public_pages(entity_id);

CREATE INDEX IF NOT EXISTS public_pages_evidence_bundle_id_idx
  ON public_pages(evidence_bundle_id);

CREATE INDEX IF NOT EXISTS agent_readable_snapshots_public_page_id_idx
  ON agent_readable_snapshots(public_page_id);

CREATE INDEX IF NOT EXISTS llm_runs_audit_run_id_idx
  ON llm_runs(audit_run_id);

CREATE INDEX IF NOT EXISTS llm_tool_calls_llm_run_id_idx
  ON llm_tool_calls(llm_run_id);

CREATE INDEX IF NOT EXISTS reviewer_results_audit_run_id_idx
  ON reviewer_results(audit_run_id);

CREATE INDEX IF NOT EXISTS reviewer_results_llm_run_id_idx
  ON reviewer_results(llm_run_id);

CREATE INDEX IF NOT EXISTS provider_health_checks_provider_id_idx
  ON provider_health_checks(provider_id);

CREATE INDEX IF NOT EXISTS public_page_generation_jobs_public_page_id_idx
  ON public_page_generation_jobs(public_page_id);

ALTER TABLE chat_threads
  ADD CONSTRAINT chat_threads_status_check CHECK (status IN ('active', 'archived'));

ALTER TABLE chat_messages
  ADD CONSTRAINT chat_messages_role_check CHECK (role IN ('user', 'assistant')),
  ADD CONSTRAINT chat_messages_status_check CHECK (status IN ('complete', 'error'));

ALTER TABLE chat_response_ratings
  ADD CONSTRAINT chat_response_ratings_rating_check CHECK (rating IN ('up', 'down'));

ALTER TABLE trip_passes
  ADD CONSTRAINT trip_passes_status_check CHECK (status IN ('active', 'expired', 'cancelled', 'refunded')),
  ADD CONSTRAINT trip_passes_timestamp_order_check CHECK (starts_at < expires_at);

ALTER TABLE trip_usage_meters
  ADD CONSTRAINT trip_usage_meters_meter_type_check CHECK (
    meter_type IN ('chat_message', 'live_refresh', 'heavy_recommendation', 'weather_refresh', 'route_lookup')
  ),
  ADD CONSTRAINT trip_usage_meters_counter_check CHECK (used >= 0 AND "limit" >= 0 AND used <= "limit");

ALTER TABLE areas
  ADD CONSTRAINT areas_latitude_check CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  ADD CONSTRAINT areas_longitude_check CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180));

ALTER TABLE providers
  ADD CONSTRAINT providers_provider_type_check CHECK (
    provider_type IN ('official_transport', 'weather_api', 'marine_forecast_page', 'places_api', 'user_submitted_evidence')
  );

ALTER TABLE source_profiles
  ADD CONSTRAINT source_profiles_source_type_check CHECK (
    source_type IN ('official', 'partner_api', 'provider_api', 'licensed_api', 'permitted_public_web', 'user_submitted', 'host_submitted', 'local_verified')
  ),
  ADD CONSTRAINT source_profiles_allowed_use_check CHECK (
    allowed_use IN ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')
  ),
  ADD CONSTRAINT source_profiles_freshness_window_days_check CHECK (freshness_window_days >= 0),
  ADD CONSTRAINT source_profiles_authority_level_check CHECK (authority_level >= 0 AND authority_level <= 100),
  ADD CONSTRAINT source_profiles_known_stale_risk_check CHECK (known_stale_risk IN ('low', 'medium', 'high')),
  ADD CONSTRAINT source_profiles_known_ai_or_seo_content_risk_check CHECK (
    known_ai_or_seo_content_risk IN ('low', 'medium', 'high')
  );

ALTER TABLE source_permissions
  ADD CONSTRAINT source_permissions_allowed_use_check CHECK (
    allowed_use IN ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')
  );

ALTER TABLE entities
  ADD CONSTRAINT entities_public_visibility_check CHECK (
    public_visibility IN ('internal', 'public', 'eligible', 'published', 'noindex', 'blocked')
  ),
  ADD CONSTRAINT entities_confidence_label_check CHECK (confidence_label IN ('low', 'medium', 'high'));

ALTER TABLE raw_snapshots
  ADD CONSTRAINT raw_snapshots_allowed_use_check CHECK (
    allowed_use IN ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')
  ),
  ADD CONSTRAINT raw_snapshots_retention_order_check CHECK (
    retention_expires_at IS NULL OR retention_expires_at >= fetched_at
  );

ALTER TABLE source_records
  ADD CONSTRAINT source_records_allowed_use_check CHECK (
    allowed_use IN ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')
  );

ALTER TABLE google_places
  ADD CONSTRAINT google_places_seen_order_check CHECK (first_seen_at <= last_seen_at);

ALTER TABLE google_place_snapshots
  ADD CONSTRAINT google_place_snapshots_request_kind_check CHECK (
    request_kind IN ('chat_search', 'details_identity_contact', 'details_enterprise', 'details_atmosphere_reviews')
  ),
  ADD CONSTRAINT google_place_snapshots_storage_policy_check CHECK (
    storage_policy IN ('durable_identifier', 'google_refreshable_cache', 'google_attribution_required_cache', 'google_no_store')
  ),
  ADD CONSTRAINT google_place_snapshots_timestamp_order_check CHECK (
    fetched_at <= stale_at
    AND (retention_expires_at IS NULL OR fetched_at <= retention_expires_at)
  );

ALTER TABLE google_place_details
  ADD CONSTRAINT google_place_details_latitude_check CHECK (latitude IS NULL OR (latitude >= -90 AND latitude <= 90)),
  ADD CONSTRAINT google_place_details_longitude_check CHECK (longitude IS NULL OR (longitude >= -180 AND longitude <= 180)),
  ADD CONSTRAINT google_place_details_rating_check CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  ADD CONSTRAINT google_place_details_user_rating_count_check CHECK (user_rating_count IS NULL OR user_rating_count >= 0),
  ADD CONSTRAINT google_place_details_business_status_check CHECK (
    business_status IS NULL OR business_status IN ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY')
  ),
  ADD CONSTRAINT google_place_details_price_level_check CHECK (
    price_level IS NULL
    OR price_level IN (
      'PRICE_LEVEL_FREE',
      'PRICE_LEVEL_INEXPENSIVE',
      'PRICE_LEVEL_MODERATE',
      'PRICE_LEVEL_EXPENSIVE',
      'PRICE_LEVEL_VERY_EXPENSIVE'
    )
  ),
  ADD CONSTRAINT google_place_details_timestamp_order_check CHECK (
    fetched_at <= stale_at AND fetched_at <= retention_expires_at
  );

ALTER TABLE google_place_reviews
  ADD CONSTRAINT google_place_reviews_rating_check CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  ADD CONSTRAINT google_place_reviews_timestamp_order_check CHECK (
    fetched_at <= stale_at AND fetched_at <= retention_expires_at
  );

ALTER TABLE candidate_entities
  ADD CONSTRAINT candidate_entities_discovery_confidence_check CHECK (
    discovery_confidence >= 0 AND discovery_confidence <= 100
  );

ALTER TABLE entity_matches
  ADD CONSTRAINT entity_matches_match_status_check CHECK (
    match_status IN ('confident', 'probable', 'ambiguous', 'rejected')
  ),
  ADD CONSTRAINT entity_matches_match_score_check CHECK (match_score >= 0 AND match_score <= 100);

ALTER TABLE facts
  ADD CONSTRAINT facts_source_type_check CHECK (
    source_type IN ('official', 'partner_api', 'provider_api', 'licensed_api', 'permitted_public_web', 'user_submitted', 'host_submitted', 'local_verified')
  ),
  ADD CONSTRAINT facts_confidence_label_check CHECK (confidence_label IN ('low', 'medium', 'high')),
  ADD CONSTRAINT facts_source_authority_check CHECK (source_authority >= 0 AND source_authority <= 100),
  ADD CONSTRAINT facts_timestamp_order_check CHECK (expires_at IS NULL OR fetched_at <= expires_at);

ALTER TABLE evidence
  ADD CONSTRAINT evidence_allowed_use_check CHECK (
    allowed_use IN ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')
  );

ALTER TABLE reviews
  ADD CONSTRAINT reviews_rating_check CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  ADD CONSTRAINT reviews_review_count_check CHECK (review_count IS NULL OR review_count >= 0),
  ADD CONSTRAINT reviews_allowed_use_check CHECK (
    allowed_use IN ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')
  );

ALTER TABLE fact_confidence_scores
  ADD CONSTRAINT fact_confidence_scores_score_check CHECK (score >= 0 AND score <= 100),
  ADD CONSTRAINT fact_confidence_scores_label_check CHECK (label IN ('low', 'medium', 'high'));

ALTER TABLE source_credibility_scores
  ADD CONSTRAINT source_credibility_scores_score_check CHECK (score >= 0 AND score <= 100),
  ADD CONSTRAINT source_credibility_scores_label_check CHECK (label IN ('low', 'medium', 'high'));

ALTER TABLE fact_conflicts
  ADD CONSTRAINT fact_conflicts_resolution_status_check CHECK (
    resolution_status IN ('open', 'resolved', 'dismissed')
  );

ALTER TABLE audit_requests
  ADD CONSTRAINT audit_requests_status_check CHECK (
    status IN (
      'created',
      'resolving',
      'needs_user_input',
      'complete_for_payment',
      'awaiting_payment',
      'paid',
      'generating',
      'reviewing',
      'published',
      'blocked',
      'failed'
    )
  ),
  ADD CONSTRAINT audit_requests_price_usd_check CHECK (price_usd >= 0);

ALTER TABLE audit_inputs
  ADD CONSTRAINT audit_inputs_date_order_check CHECK (
    start_date IS NULL OR end_date IS NULL OR start_date <= end_date
  );

ALTER TABLE audit_runs
  ADD CONSTRAINT audit_runs_state_check CHECK (
    state IN (
      'created',
      'resolving',
      'needs_user_input',
      'complete_for_payment',
      'awaiting_payment',
      'paid',
      'generating',
      'reviewing',
      'published',
      'blocked',
      'failed',
      'queued',
      'running',
      'succeeded'
    )
  ),
  ADD CONSTRAINT audit_runs_timestamp_order_check CHECK (
    started_at IS NULL OR completed_at IS NULL OR started_at <= completed_at
  );

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_usd_check CHECK (amount_usd >= 0),
  ADD CONSTRAINT payments_status_check CHECK (
    status IN ('not_started', 'checkout_started', 'paid', 'failed')
  );

ALTER TABLE audit_reports
  ADD CONSTRAINT audit_reports_overall_risk_check CHECK (overall_risk IN ('green', 'yellow', 'red')),
  ADD CONSTRAINT audit_reports_confidence_label_check CHECK (confidence_label IN ('low', 'medium', 'high'));

ALTER TABLE refresh_jobs
  ADD CONSTRAINT refresh_jobs_priority_check CHECK (priority >= 0 AND priority <= 100),
  ADD CONSTRAINT refresh_jobs_attempt_count_check CHECK (attempt_count >= 0),
  ADD CONSTRAINT refresh_jobs_result_status_check CHECK (
    result_status IN ('scheduled', 'running', 'succeeded', 'failed')
  );

ALTER TABLE public_evidence_bundles
  ADD CONSTRAINT public_evidence_bundles_allowed_use_check CHECK (
    allowed_use IN ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')
  );

ALTER TABLE public_pages
  ADD CONSTRAINT public_pages_page_type_check CHECK (
    page_type IN ('accommodations', 'areas', 'routes', 'operators', 'risks')
  ),
  ADD CONSTRAINT public_pages_confidence_label_check CHECK (confidence_label IN ('low', 'medium', 'high')),
  ADD CONSTRAINT public_pages_public_visibility_check CHECK (
    public_visibility IN ('internal', 'eligible', 'published', 'noindex', 'blocked')
  ),
  ADD CONSTRAINT public_pages_indexing_status_check CHECK (indexing_status IN ('index', 'noindex'));

ALTER TABLE agent_readable_snapshots
  ADD CONSTRAINT agent_readable_snapshots_format_check CHECK (format IN ('markdown', 'json'));

ALTER TABLE llm_runs
  ADD CONSTRAINT llm_runs_status_check CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'completed')
  ),
  ADD CONSTRAINT llm_runs_timestamp_order_check CHECK (
    completed_at IS NULL OR started_at <= completed_at
  );

ALTER TABLE reviewer_results
  ADD CONSTRAINT reviewer_results_verdict_check CHECK (verdict IN ('approved', 'needs_revision', 'blocked'));

ALTER TABLE provider_health_checks
  ADD CONSTRAINT provider_health_checks_status_check CHECK (status IN ('ok', 'degraded', 'failed')),
  ADD CONSTRAINT provider_health_checks_latency_ms_check CHECK (latency_ms IS NULL OR latency_ms >= 0);

ALTER TABLE public_page_generation_jobs
  ADD CONSTRAINT public_page_generation_jobs_status_check CHECK (
    status IN ('scheduled', 'running', 'succeeded', 'failed')
  ),
  ADD CONSTRAINT public_page_generation_jobs_timestamp_order_check CHECK (
    completed_at IS NULL OR scheduled_at <= completed_at
  );

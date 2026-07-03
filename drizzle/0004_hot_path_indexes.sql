CREATE INDEX IF NOT EXISTS chat_threads_user_active_recent_idx
  ON chat_threads(user_id, (COALESCE(last_message_at, updated_at, created_at)) DESC, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS chat_messages_thread_user_created_id_idx
  ON chat_messages(thread_id, user_id, created_at, id);

CREATE INDEX IF NOT EXISTS saved_trips_user_recent_idx
  ON saved_trips(user_id, updated_at DESC, created_at DESC, id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS saved_trip_items_active_trip_created_id_idx
  ON saved_trip_items(trip_id, created_at, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS saved_trip_items_active_id_trip_idx
  ON saved_trip_items(id, trip_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS facts_public_republish_freshness_idx
  ON facts(public_republish_allowed, expires_at, fetched_at DESC, id)
  WHERE public_republish_allowed = TRUE;

CREATE INDEX IF NOT EXISTS evidence_public_fact_created_idx
  ON evidence(fact_id, created_at, id)
  WHERE public_republish_allowed = TRUE
    OR allowed_use IN ('public_republish', 'citation_only');

CREATE INDEX IF NOT EXISTS google_place_snapshots_chat_cache_freshness_idx
  ON google_place_snapshots(
    (payload_json->'search'->>'cacheKey'),
    stale_at,
    retention_expires_at,
    place_id,
    fetched_at DESC
  )
  WHERE request_kind = 'chat_search';

# Database Index Audits

Issue #65 adds non-destructive hot-path indexes only. It does not drop, rename, rebuild, or
deduplicate existing indexes. Treat duplicate or unused-index findings as operator review inputs;
confirm production query plans and write costs before scheduling a separate cleanup migration.

Run these statements from a read-only Postgres session.

## Duplicate Index Candidates

This query groups indexes with the same table and indexed key expression. It is intentionally a
candidate report: predicates, uniqueness, included columns, operator classes, and sort order still
need human review before any cleanup decision.

```sql
select
  n.nspname as schema_name,
  t.relname as table_name,
  array_agg(ix.relname order by ix.relname) as index_names,
  array_agg(pg_get_indexdef(i.indexrelid) order by ix.relname) as index_definitions,
  pg_get_expr(i.indexprs, i.indrelid) as expression_keys,
  pg_get_expr(i.indpred, i.indrelid) as predicate,
  count(*) as index_count
from pg_index i
join pg_class ix on ix.oid = i.indexrelid
join pg_class t on t.oid = i.indrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
group by
  n.nspname,
  t.relname,
  i.indkey,
  i.indclass,
  i.indcollation,
  i.indoption,
  i.indexprs,
  i.indpred,
  i.indisunique,
  i.indisprimary
having count(*) > 1
order by schema_name, table_name, index_names;
```

## Unused Index Candidates

This query lists non-primary, non-unique indexes with no recorded scans since the current stats
window began. A zero scan count can mean the app path has not run since stats reset, not that the
index is safe to remove.

```sql
select
  schemaname,
  relname as table_name,
  indexrelname as index_name,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where schemaname = 'public'
  and idx_scan = 0
  and indexrelid not in (
    select indexrelid
    from pg_index
    where indisprimary or indisunique
  )
order by pg_relation_size(indexrelid) desc, relname, indexrelname;
```

Check when statistics were last reset before acting on unused-index candidates:

```sql
select
  stats_reset
from pg_stat_database
where datname = current_database();
```

## Hot-Path Exceptions

The #65 migration deliberately avoids these extra indexes because the current query is already
covered by a primary/unique index or has no matching database predicate without changing runtime
behavior.

| Query/file | Existing coverage or reason |
| --- | --- |
| `src/server/chat/chat-history-store.ts` `loadOwnedChatThread`: `where id = $1 and user_id = $2 and deleted_at is null` | `chat_threads_pkey` performs the exact thread lookup; `user_id` and `deleted_at` are ownership and soft-delete checks on one row. |
| `src/server/chat/chat-history-store.ts` rating join in `loadOwnedChatThreadWithMessages`: `chat_response_ratings.message_id = chat_messages.id and chat_response_ratings.user_id = $2` | `chat_response_ratings_user_id_message_id_idx` already matches the parameterized `user_id` plus message join key. |
| `src/server/trips/shared-trip-store.ts` `listSelectedActiveItems`: `where trip_id = $1 and deleted_at is null and id = any($2::text[])` | `saved_trip_items_pkey` on `(trip_id, id)` covers selected item lookups; the new active item indexes target ordered active lists and user-scoped deletion. |
| `src/server/trips/shared-trip-store.ts` `lookupSharedTripPlanByToken` and `deleteSharedTripPlanByToken`: `where public_token_hash = $1 ...` | `shared_trip_plans_public_token_hash_key` is unique, so token lookup touches at most one row before checking `deleted_at` and `expires_at`. |
| `src/server/public-pages/database-public-catalog.ts` `getPage`: `where p.page_type = $1 and p.slug = $2` | `public_pages_slug_key` is unique, so the slug lookup is already selective; adding `(page_type, slug)` would duplicate that access path. |
| `src/server/public-pages/database-public-catalog.ts` `listPages` and `listEligiblePages` | The current SQL loads pages and eligibility is evaluated in application code; adding a visibility/listing index would not match a database `where` predicate. |
| `src/server/public-pages/database-public-catalog.ts` fact ID expansion from `p.generation_source_fact_ids` | The query expands the selected page JSON array and joins facts by `facts_pkey`; a GIN index would not match `jsonb_array_elements_text(...)` in the current SQL. |
| `src/server/providers/google-places-store.ts` `findFreshPlaceDetails`: `where d.place_id = $1 and d.stale_at > $2 and d.retention_expires_at > $2` | `google_place_details_pkey` performs the exact place lookup; freshness predicates validate the single row. |
| `src/server/providers/google-places-store.ts` Google Places retention deletes/counts | Existing `*_retention_expires_at_idx` indexes cover review, detail, and snapshot retention predicates. |

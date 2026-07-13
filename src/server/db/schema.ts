import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    imageUrl: text("image_url"),
    clerkUpdatedAt: timestamp("clerk_updated_at", { withTimezone: true }),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("users_deleted_at_idx").on(table.deletedAt),
    index("users_last_seen_at_idx").on(table.lastSeenAt),
  ],
);

export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => users.id),
    displayName: text("display_name"),
    homeCountry: text("home_country"),
    travelStyle: text("travel_style"),
    budgetLevel: text("budget_level"),
    dietaryNotes: text("dietary_notes"),
    foodNeedsJson: jsonb("food_needs_json").$type<string[]>().notNull().default([]),
    accessibilityNotes: text("accessibility_notes"),
    surfAbility: text("surf_ability"),
    quietSleepPreference: boolean("quiet_sleep_preference"),
    weatherPreference: text("weather_preference"),
    interestsJson: jsonb("interests_json").$type<string[]>().notNull().default([]),
    preferredAreasJson: jsonb("preferred_areas_json").$type<string[]>().notNull().default([]),
    tripContextJson: jsonb("trip_context_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("user_profiles_updated_at_idx").on(table.updatedAt)],
);

export const savedTrips = pgTable(
  "saved_trips",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    clientTripKeyHash: text("client_trip_key_hash").notNull().unique(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("saved_trips_client_trip_key_hash_idx").on(table.clientTripKeyHash),
    index("saved_trips_user_id_idx").on(table.userId),
    index("saved_trips_user_recent_idx")
      .using(
        "btree",
        table.userId,
        sql`${table.updatedAt} desc`,
        sql`${table.createdAt} desc`,
        table.id,
      )
      .where(sql`${table.userId} is not null`),
    uniqueIndex("saved_trips_user_client_trip_key_hash_idx")
      .on(table.userId, table.clientTripKeyHash)
      .where(sql`${table.userId} is not null`),
  ],
);

export const chatThreads = pgTable(
  "chat_threads",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    title: text("title").notNull().default("New Siargao chat"),
    summary: text("summary"),
    status: text("status").notNull().default("active"),
    source: text("source").notNull().default("chat_workspace"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_threads_user_id_updated_at_idx").on(table.userId, table.updatedAt),
    index("chat_threads_user_id_deleted_at_idx").on(table.userId, table.deletedAt),
    index("chat_threads_user_active_recent_idx")
      .using(
        "btree",
        table.userId,
        sql`(coalesce(${table.lastMessageAt}, ${table.updatedAt}, ${table.createdAt})) desc`,
        sql`${table.createdAt} desc`,
      )
      .where(sql`${table.deletedAt} is null`),
    check("chat_threads_status_check", sql`${table.status} in ('active', 'archived')`),
  ],
);

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => chatThreads.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    role: text("role").notNull(),
    content: text("content").notNull(),
    status: text("status").notNull().default("complete"),
    requestId: text("request_id"),
    model: text("model"),
    clientMessageId: text("client_message_id"),
    sourcesJson: jsonb("sources_json").$type<Record<string, unknown>[]>().notNull().default([]),
    cardsJson: jsonb("cards_json").$type<Record<string, unknown>[]>().notNull().default([]),
    actionsJson: jsonb("actions_json").$type<Record<string, unknown>[]>().notNull().default([]),
    itinerariesJson: jsonb("itineraries_json")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    decisionSummariesJson: jsonb("decision_summaries_json")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    toolCallsJson: jsonb("tool_calls_json")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    contextSummaryJson: jsonb("context_summary_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("chat_messages_thread_id_created_at_idx").on(table.threadId, table.createdAt),
    index("chat_messages_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("chat_messages_request_id_idx").on(table.requestId),
    index("chat_messages_thread_user_created_id_idx").on(
      table.threadId,
      table.userId,
      table.createdAt,
      table.id,
    ),
    check("chat_messages_role_check", sql`${table.role} in ('user', 'assistant')`),
    check("chat_messages_status_check", sql`${table.status} in ('complete', 'error')`),
  ],
);

export const chatResponseRatings = pgTable(
  "chat_response_ratings",
  {
    id: text("id").primaryKey(),
    messageId: text("message_id")
      .notNull()
      .references(() => chatMessages.id),
    threadId: text("thread_id")
      .notNull()
      .references(() => chatThreads.id),
    userId: text("user_id")
      .notNull()
      .references(() => users.id),
    rating: text("rating").notNull(),
    reasonCodesJson: jsonb("reason_codes_json").$type<string[]>().notNull().default([]),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("chat_response_ratings_user_id_message_id_idx").on(table.userId, table.messageId),
    index("chat_response_ratings_message_id_idx").on(table.messageId),
    index("chat_response_ratings_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("chat_response_ratings_thread_id_idx").on(table.threadId),
    check("chat_response_ratings_rating_check", sql`${table.rating} in ('up', 'down')`),
  ],
);

export const savedTripItems = pgTable(
  "saved_trip_items",
  {
    id: text("id").notNull(),
    tripId: text("trip_id")
      .notNull()
      .references(() => savedTrips.id),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>().notNull(),
    sourcesJson: jsonb("sources_json").$type<Record<string, unknown>[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.tripId, table.id] }),
    index("saved_trip_items_trip_id_idx").on(table.tripId),
    index("saved_trip_items_deleted_at_idx").on(table.deletedAt),
    index("saved_trip_items_active_trip_created_id_idx")
      .on(table.tripId, table.createdAt, table.id)
      .where(sql`${table.deletedAt} is null`),
    index("saved_trip_items_active_id_trip_idx")
      .on(table.id, table.tripId)
      .where(sql`${table.deletedAt} is null`),
  ],
);

export const sharedTripPlans = pgTable(
  "shared_trip_plans",
  {
    id: text("id").primaryKey(),
    tripId: text("trip_id")
      .notNull()
      .references(() => savedTrips.id),
    publicTokenHash: text("public_token_hash").notNull().unique(),
    title: text("title").notNull(),
    itemIdsJson: jsonb("item_ids_json").$type<string[]>().notNull().default([]),
    itemsJson: jsonb("items_json").$type<Record<string, unknown>[]>().notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("shared_trip_plans_trip_id_idx").on(table.tripId),
    index("shared_trip_plans_public_token_hash_idx").on(table.publicTokenHash),
    index("shared_trip_plans_expires_at_idx").on(table.expiresAt),
  ],
);

export const tripPasses = pgTable(
  "trip_passes",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    email: text("email"),
    status: text("status").notNull(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeEventId: text("stripe_event_id").unique(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_passes_user_id_idx").on(table.userId),
    index("trip_passes_status_expires_at_idx").on(table.status, table.expiresAt),
    check(
      "trip_passes_status_check",
      sql`${table.status} in ('active', 'expired', 'cancelled', 'refunded')`,
    ),
    check("trip_passes_timestamp_order_check", sql`${table.startsAt} < ${table.expiresAt}`),
  ],
);

export const tripUsageMeters = pgTable(
  "trip_usage_meters",
  {
    id: text("id").primaryKey(),
    tripPassId: text("trip_pass_id")
      .notNull()
      .references(() => tripPasses.id),
    meterType: text("meter_type").notNull(),
    used: integer("used").notNull().default(0),
    limit: integer("limit").notNull(),
    resetAt: timestamp("reset_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_usage_meters_trip_pass_id_meter_type_idx").on(
      table.tripPassId,
      table.meterType,
    ),
    index("trip_usage_meters_trip_pass_id_idx").on(table.tripPassId),
    check(
      "trip_usage_meters_meter_type_check",
      sql`${table.meterType} in ('chat_message', 'live_refresh', 'heavy_recommendation', 'weather_refresh', 'route_lookup')`,
    ),
    check(
      "trip_usage_meters_counter_check",
      sql`${table.used} >= 0 and ${table.limit} >= 0 and ${table.used} <= ${table.limit}`,
    ),
  ],
);

export const areas = pgTable(
  "areas",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    municipality: text("municipality").notNull(),
    description: text("description").notNull(),
    latitude: numeric("latitude"),
    longitude: numeric("longitude"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "areas_latitude_check",
      sql`${table.latitude} is null or (${table.latitude} >= -90 and ${table.latitude} <= 90)`,
    ),
    check(
      "areas_longitude_check",
      sql`${table.longitude} is null or (${table.longitude} >= -180 and ${table.longitude} <= 180)`,
    ),
  ],
);

export const routes = pgTable("routes", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  transportModes: jsonb("transport_modes").$type<string[]>().notNull().default([]),
  riskNotes: jsonb("risk_notes").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providers = pgTable(
  "providers",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    providerType: text("provider_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "providers_provider_type_check",
      sql`${table.providerType} in ('official_transport', 'weather_api', 'marine_forecast_page', 'places_api', 'user_submitted_evidence')`,
    ),
  ],
);

export const sourceProfiles = pgTable(
  "source_profiles",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id").references(() => providers.id),
    sourceName: text("source_name").notNull(),
    sourceType: text("source_type").notNull(),
    accessMethod: text("access_method").notNull(),
    allowedUse: text("allowed_use").notNull(),
    robotsPolicy: text("robots_policy"),
    termsUrl: text("terms_url"),
    rateLimit: text("rate_limit"),
    freshnessWindowDays: integer("freshness_window_days").notNull(),
    authorityLevel: integer("authority_level").notNull(),
    storesRawAllowed: boolean("stores_raw_allowed").notNull().default(false),
    publishesRawAllowed: boolean("publishes_raw_allowed").notNull().default(false),
    requiresPartnerApproval: boolean("requires_partner_approval").notNull().default(false),
    knownStaleRisk: text("known_stale_risk").notNull().default("medium"),
    knownAiOrSeoContentRisk: text("known_ai_or_seo_content_risk").notNull().default("medium"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("source_profiles_provider_id_idx").on(table.providerId),
    check(
      "source_profiles_source_type_check",
      sql`${table.sourceType} in ('official', 'partner_api', 'provider_api', 'licensed_api', 'permitted_public_web', 'user_submitted', 'host_submitted', 'local_verified')`,
    ),
    check(
      "source_profiles_allowed_use_check",
      sql`${table.allowedUse} in ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')`,
    ),
    check("source_profiles_freshness_window_days_check", sql`${table.freshnessWindowDays} >= 0`),
    check(
      "source_profiles_authority_level_check",
      sql`${table.authorityLevel} >= 0 and ${table.authorityLevel} <= 100`,
    ),
    check(
      "source_profiles_known_stale_risk_check",
      sql`${table.knownStaleRisk} in ('low', 'medium', 'high')`,
    ),
    check(
      "source_profiles_known_ai_or_seo_content_risk_check",
      sql`${table.knownAiOrSeoContentRisk} in ('low', 'medium', 'high')`,
    ),
  ],
);

export const sourcePermissions = pgTable(
  "source_permissions",
  {
    id: text("id").primaryKey(),
    sourceProfileId: text("source_profile_id")
      .notNull()
      .references(() => sourceProfiles.id),
    useCase: text("use_case").notNull(),
    allowedUse: text("allowed_use").notNull(),
    publicRepublishAllowed: boolean("public_republish_allowed").notNull().default(false),
    citationAllowed: boolean("citation_allowed").notNull().default(false),
    rawStorageAllowed: boolean("raw_storage_allowed").notNull().default(false),
    llmExposureAllowed: boolean("llm_exposure_allowed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("source_permissions_source_profile_id_idx").on(table.sourceProfileId),
    check(
      "source_permissions_allowed_use_check",
      sql`${table.allowedUse} in ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')`,
    ),
  ],
);

export const entities = pgTable(
  "entities",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    areaId: text("area_id").references(() => areas.id),
    aliases: jsonb("aliases").$type<string[]>().notNull().default([]),
    publicVisibility: text("public_visibility").notNull().default("internal"),
    confidenceLabel: text("confidence_label").notNull().default("medium"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("entities_area_id_idx").on(table.areaId),
    check(
      "entities_public_visibility_check",
      sql`${table.publicVisibility} in ('internal', 'public', 'eligible', 'published', 'noindex', 'blocked')`,
    ),
    check(
      "entities_confidence_label_check",
      sql`${table.confidenceLabel} in ('low', 'medium', 'high')`,
    ),
  ],
);

export const accommodations = pgTable("accommodations", {
  id: text("id").primaryKey(),
  entityId: text("entity_id")
    .notNull()
    .unique()
    .references(() => entities.id),
  accommodationType: text("accommodation_type").notNull(),
  address: text("address"),
  platformRefs: jsonb("platform_refs").$type<Record<string, string>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const rawSnapshots = pgTable(
  "raw_snapshots",
  {
    id: text("id").primaryKey(),
    sourceProfileId: text("source_profile_id")
      .notNull()
      .references(() => sourceProfiles.id),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    contentHash: text("content_hash").notNull(),
    storageUri: text("storage_uri"),
    rawPayload: jsonb("raw_payload"),
    allowedUse: text("allowed_use").notNull(),
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }),
  },
  (table) => [
    index("raw_snapshots_source_profile_id_idx").on(table.sourceProfileId),
    check(
      "raw_snapshots_allowed_use_check",
      sql`${table.allowedUse} in ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')`,
    ),
    check(
      "raw_snapshots_retention_order_check",
      sql`${table.retentionExpiresAt} is null or ${table.retentionExpiresAt} >= ${table.fetchedAt}`,
    ),
  ],
);

export const sourceRecords = pgTable(
  "source_records",
  {
    id: text("id").primaryKey(),
    sourceProfileId: text("source_profile_id")
      .notNull()
      .references(() => sourceProfiles.id),
    rawSnapshotId: text("raw_snapshot_id").references(() => rawSnapshots.id),
    providerEntityId: text("provider_entity_id"),
    entityType: text("entity_type").notNull(),
    name: text("name").notNull(),
    normalizedPayload: jsonb("normalized_payload")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    sourceUrl: text("source_url"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    allowedUse: text("allowed_use").notNull(),
  },
  (table) => [
    index("source_records_source_profile_id_idx").on(table.sourceProfileId),
    index("source_records_raw_snapshot_id_idx").on(table.rawSnapshotId),
    check(
      "source_records_allowed_use_check",
      sql`${table.allowedUse} in ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')`,
    ),
  ],
);

export const googlePlaces = pgTable(
  "google_places",
  {
    placeId: text("place_id").primaryKey(),
    resourceName: text("resource_name"),
    latestSourceRecordId: text("latest_source_record_id").references(() => sourceRecords.id),
    canonicalEntityId: text("canonical_entity_id").references(() => entities.id),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastDetailsFetchedAt: timestamp("last_details_fetched_at", { withTimezone: true }),
    detailsStaleAt: timestamp("details_stale_at", { withTimezone: true }),
  },
  (table) => [
    index("google_places_details_stale_at_idx").on(table.detailsStaleAt),
    index("google_places_latest_source_record_id_idx").on(table.latestSourceRecordId),
    index("google_places_canonical_entity_id_idx").on(table.canonicalEntityId),
    check("google_places_seen_order_check", sql`${table.firstSeenAt} <= ${table.lastSeenAt}`),
  ],
);

export const googlePlaceSnapshots = pgTable(
  "google_place_snapshots",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => googlePlaces.placeId),
    sourceRecordId: text("source_record_id")
      .notNull()
      .references(() => sourceRecords.id),
    requestKind: text("request_kind").notNull(),
    fieldMask: text("field_mask").notNull(),
    payloadJson: jsonb("payload_json").$type<Record<string, unknown>>(),
    payloadHash: text("payload_hash"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    staleAt: timestamp("stale_at", { withTimezone: true }).notNull(),
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }),
    storagePolicy: text("storage_policy").notNull(),
    attributionJson: jsonb("attribution_json").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("google_place_snapshots_place_id_idx").on(table.placeId),
    index("google_place_snapshots_source_record_id_idx").on(table.sourceRecordId),
    index("google_place_snapshots_stale_at_idx").on(table.staleAt),
    index("google_place_snapshots_retention_expires_at_idx").on(table.retentionExpiresAt),
    index("google_place_snapshots_chat_cache_freshness_idx")
      .using(
        "btree",
        sql`(${table.payloadJson}->'search'->>'cacheKey')`,
        table.staleAt,
        table.retentionExpiresAt,
        table.placeId,
        sql`${table.fetchedAt} desc`,
      )
      .where(sql`${table.requestKind} = 'chat_search'`),
    check(
      "google_place_snapshots_request_kind_check",
      sql`${table.requestKind} in ('chat_search', 'details_identity_contact', 'details_enterprise', 'details_atmosphere_reviews')`,
    ),
    check(
      "google_place_snapshots_storage_policy_check",
      sql`${table.storagePolicy} in ('durable_identifier', 'google_refreshable_cache', 'google_attribution_required_cache', 'google_no_store')`,
    ),
    check(
      "google_place_snapshots_timestamp_order_check",
      sql`${table.fetchedAt} <= ${table.staleAt} and (${table.retentionExpiresAt} is null or ${table.fetchedAt} <= ${table.retentionExpiresAt})`,
    ),
  ],
);

export const googlePlaceDetails = pgTable(
  "google_place_details",
  {
    placeId: text("place_id")
      .primaryKey()
      .references(() => googlePlaces.placeId),
    displayNameJson: jsonb("display_name_json").$type<Record<string, unknown>>(),
    formattedAddress: text("formatted_address"),
    shortFormattedAddress: text("short_formatted_address"),
    addressComponentsJson: jsonb("address_components_json").$type<Record<string, unknown>[]>(),
    locationJson: jsonb("location_json").$type<Record<string, unknown>>(),
    latitude: numeric("latitude"),
    longitude: numeric("longitude"),
    viewportJson: jsonb("viewport_json").$type<Record<string, unknown>>(),
    typesJson: jsonb("types_json").$type<string[]>(),
    primaryType: text("primary_type"),
    businessStatus: text("business_status"),
    googleMapsUri: text("google_maps_uri"),
    websiteUri: text("website_uri"),
    nationalPhoneNumber: text("national_phone_number"),
    internationalPhoneNumber: text("international_phone_number"),
    openingHoursJson: jsonb("opening_hours_json").$type<Record<string, unknown>>(),
    priceLevel: text("price_level"),
    priceRangeJson: jsonb("price_range_json").$type<Record<string, unknown>>(),
    rating: numeric("rating"),
    userRatingCount: integer("user_rating_count"),
    paymentOptionsJson: jsonb("payment_options_json").$type<Record<string, unknown>>(),
    parkingOptionsJson: jsonb("parking_options_json").$type<Record<string, unknown>>(),
    amenitiesJson: jsonb("amenities_json").$type<Record<string, unknown>>(),
    attributionsJson: jsonb("attributions_json").$type<Record<string, unknown>[]>(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    staleAt: timestamp("stale_at", { withTimezone: true }).notNull(),
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("google_place_details_stale_at_idx").on(table.staleAt),
    index("google_place_details_retention_expires_at_idx").on(table.retentionExpiresAt),
    check(
      "google_place_details_latitude_check",
      sql`${table.latitude} is null or (${table.latitude} >= -90 and ${table.latitude} <= 90)`,
    ),
    check(
      "google_place_details_longitude_check",
      sql`${table.longitude} is null or (${table.longitude} >= -180 and ${table.longitude} <= 180)`,
    ),
    check(
      "google_place_details_rating_check",
      sql`${table.rating} is null or (${table.rating} >= 1 and ${table.rating} <= 5)`,
    ),
    check(
      "google_place_details_user_rating_count_check",
      sql`${table.userRatingCount} is null or ${table.userRatingCount} >= 0`,
    ),
    check(
      "google_place_details_business_status_check",
      sql`${table.businessStatus} is null or ${table.businessStatus} in ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY')`,
    ),
    check(
      "google_place_details_price_level_check",
      sql`${table.priceLevel} is null or ${table.priceLevel} in ('PRICE_LEVEL_FREE', 'PRICE_LEVEL_INEXPENSIVE', 'PRICE_LEVEL_MODERATE', 'PRICE_LEVEL_EXPENSIVE', 'PRICE_LEVEL_VERY_EXPENSIVE')`,
    ),
    check(
      "google_place_details_timestamp_order_check",
      sql`${table.fetchedAt} <= ${table.staleAt} and ${table.fetchedAt} <= ${table.retentionExpiresAt}`,
    ),
  ],
);

export const googlePlaceReviews = pgTable(
  "google_place_reviews",
  {
    id: text("id").primaryKey(),
    placeId: text("place_id")
      .notNull()
      .references(() => googlePlaces.placeId),
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => googlePlaceSnapshots.id),
    reviewName: text("review_name"),
    relativePublishTimeDescription: text("relative_publish_time_description"),
    rating: numeric("rating"),
    textJson: jsonb("text_json").$type<Record<string, unknown>>(),
    originalTextJson: jsonb("original_text_json").$type<Record<string, unknown>>(),
    authorAttributionJson: jsonb("author_attribution_json").$type<Record<string, unknown>>(),
    publishTime: timestamp("publish_time", { withTimezone: true }),
    flaggedContent: boolean("flagged_content").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    staleAt: timestamp("stale_at", { withTimezone: true }).notNull(),
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }).notNull(),
    displayRequiresGoogleAttribution: boolean("display_requires_google_attribution")
      .notNull()
      .default(true),
  },
  (table) => [
    index("google_place_reviews_place_id_idx").on(table.placeId),
    index("google_place_reviews_snapshot_id_idx").on(table.snapshotId),
    index("google_place_reviews_stale_at_idx").on(table.staleAt),
    index("google_place_reviews_retention_expires_at_idx").on(table.retentionExpiresAt),
    check(
      "google_place_reviews_rating_check",
      sql`${table.rating} is null or (${table.rating} >= 1 and ${table.rating} <= 5)`,
    ),
    check(
      "google_place_reviews_timestamp_order_check",
      sql`${table.fetchedAt} <= ${table.staleAt} and ${table.fetchedAt} <= ${table.retentionExpiresAt}`,
    ),
  ],
);

export const candidateEntities = pgTable(
  "candidate_entities",
  {
    id: text("id").primaryKey(),
    candidateName: text("candidate_name").notNull(),
    candidateType: text("candidate_type").notNull(),
    sourceProfileId: text("source_profile_id")
      .notNull()
      .references(() => sourceProfiles.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    rawLocation: text("raw_location"),
    rawCategory: text("raw_category"),
    rawContact: text("raw_contact"),
    discoveryConfidence: numeric("discovery_confidence").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("candidate_entities_source_profile_id_idx").on(table.sourceProfileId),
    index("candidate_entities_source_record_id_idx").on(table.sourceRecordId),
    check(
      "candidate_entities_discovery_confidence_check",
      sql`${table.discoveryConfidence} >= 0 and ${table.discoveryConfidence} <= 100`,
    ),
  ],
);

export const entityMatches = pgTable(
  "entity_matches",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    candidateEntityId: text("candidate_entity_id")
      .notNull()
      .references(() => candidateEntities.id),
    matchStatus: text("match_status").notNull(),
    matchScore: numeric("match_score").notNull(),
    matchedSourceRecordIds: jsonb("matched_source_record_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    conflictReasons: jsonb("conflict_reasons").$type<string[]>().notNull().default([]),
    requiresUserFollowup: boolean("requires_user_followup").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("entity_matches_entity_id_idx").on(table.entityId),
    index("entity_matches_candidate_entity_id_idx").on(table.candidateEntityId),
    check(
      "entity_matches_match_status_check",
      sql`${table.matchStatus} in ('confident', 'probable', 'ambiguous', 'rejected')`,
    ),
    check(
      "entity_matches_match_score_check",
      sql`${table.matchScore} >= 0 and ${table.matchScore} <= 100`,
    ),
  ],
);

export const facts = pgTable(
  "facts",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    claim: text("claim").notNull(),
    factType: text("fact_type").notNull(),
    sourceType: text("source_type").notNull(),
    sourceProfileId: text("source_profile_id").references(() => sourceProfiles.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    confidenceLabel: text("confidence_label").notNull(),
    sourceAuthority: integer("source_authority").notNull(),
    publicRepublishAllowed: boolean("public_republish_allowed").notNull().default(false),
    auditUseAllowed: boolean("audit_use_allowed").notNull().default(true),
    rawEvidenceAllowed: boolean("raw_evidence_allowed").notNull().default(false),
    conflictsWithFactIds: jsonb("conflicts_with_fact_ids").$type<string[]>().notNull().default([]),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("facts_entity_id_idx").on(table.entityId),
    index("facts_source_profile_id_idx").on(table.sourceProfileId),
    index("facts_source_record_id_idx").on(table.sourceRecordId),
    index("facts_public_republish_freshness_idx")
      .using(
        "btree",
        table.publicRepublishAllowed,
        table.expiresAt,
        sql`${table.fetchedAt} desc`,
        table.id,
      )
      .where(sql`${table.publicRepublishAllowed} = true`),
    check(
      "facts_source_type_check",
      sql`${table.sourceType} in ('official', 'partner_api', 'provider_api', 'licensed_api', 'permitted_public_web', 'user_submitted', 'host_submitted', 'local_verified')`,
    ),
    check(
      "facts_confidence_label_check",
      sql`${table.confidenceLabel} in ('low', 'medium', 'high')`,
    ),
    check(
      "facts_source_authority_check",
      sql`${table.sourceAuthority} >= 0 and ${table.sourceAuthority} <= 100`,
    ),
    check(
      "facts_timestamp_order_check",
      sql`${table.expiresAt} is null or ${table.fetchedAt} <= ${table.expiresAt}`,
    ),
  ],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    factId: text("fact_id")
      .notNull()
      .references(() => facts.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    label: text("label").notNull(),
    citationUrl: text("citation_url"),
    citationText: text("citation_text"),
    allowedUse: text("allowed_use").notNull(),
    publicRepublishAllowed: boolean("public_republish_allowed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("evidence_fact_id_idx").on(table.factId),
    index("evidence_source_record_id_idx").on(table.sourceRecordId),
    index("evidence_public_fact_created_idx")
      .on(table.factId, table.createdAt, table.id)
      .where(
        sql`${table.publicRepublishAllowed} = true or ${table.allowedUse} in ('public_republish', 'citation_only')`,
      ),
    check(
      "evidence_allowed_use_check",
      sql`${table.allowedUse} in ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')`,
    ),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    entityId: text("entity_id").references(() => entities.id),
    sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
    rating: numeric("rating"),
    reviewCount: integer("review_count"),
    themes: jsonb("themes").$type<string[]>().notNull().default([]),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
    allowedUse: text("allowed_use").notNull(),
  },
  (table) => [
    index("reviews_entity_id_idx").on(table.entityId),
    index("reviews_source_record_id_idx").on(table.sourceRecordId),
    check(
      "reviews_rating_check",
      sql`${table.rating} is null or (${table.rating} >= 1 and ${table.rating} <= 5)`,
    ),
    check(
      "reviews_review_count_check",
      sql`${table.reviewCount} is null or ${table.reviewCount} >= 0`,
    ),
    check(
      "reviews_allowed_use_check",
      sql`${table.allowedUse} in ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')`,
    ),
  ],
);

export const factConfidenceScores = pgTable(
  "fact_confidence_scores",
  {
    id: text("id").primaryKey(),
    factId: text("fact_id")
      .notNull()
      .references(() => facts.id),
    score: numeric("score").notNull(),
    label: text("label").notNull(),
    drivers: jsonb("drivers").$type<string[]>().notNull().default([]),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fact_confidence_scores_fact_id_idx").on(table.factId),
    check("fact_confidence_scores_score_check", sql`${table.score} >= 0 and ${table.score} <= 100`),
    check("fact_confidence_scores_label_check", sql`${table.label} in ('low', 'medium', 'high')`),
  ],
);

export const sourceCredibilityScores = pgTable(
  "source_credibility_scores",
  {
    id: text("id").primaryKey(),
    sourceProfileId: text("source_profile_id")
      .notNull()
      .references(() => sourceProfiles.id),
    score: numeric("score").notNull(),
    label: text("label").notNull(),
    drivers: jsonb("drivers").$type<string[]>().notNull().default([]),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("source_credibility_scores_source_profile_id_idx").on(table.sourceProfileId),
    check(
      "source_credibility_scores_score_check",
      sql`${table.score} >= 0 and ${table.score} <= 100`,
    ),
    check(
      "source_credibility_scores_label_check",
      sql`${table.label} in ('low', 'medium', 'high')`,
    ),
  ],
);

export const factConflicts = pgTable(
  "fact_conflicts",
  {
    id: text("id").primaryKey(),
    primaryFactId: text("primary_fact_id")
      .notNull()
      .references(() => facts.id),
    conflictingFactId: text("conflicting_fact_id")
      .notNull()
      .references(() => facts.id),
    conflictType: text("conflict_type").notNull(),
    severity: text("severity").notNull(),
    resolutionStatus: text("resolution_status").notNull().default("open"),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fact_conflicts_primary_fact_id_idx").on(table.primaryFactId),
    index("fact_conflicts_conflicting_fact_id_idx").on(table.conflictingFactId),
    check(
      "fact_conflicts_resolution_status_check",
      sql`${table.resolutionStatus} in ('open', 'resolved', 'dismissed')`,
    ),
  ],
);

export const auditRequests = pgTable(
  "audit_requests",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    email: text("email"),
    status: text("status").notNull(),
    priceUsd: numeric("price_usd").notNull().default("9.99"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_requests_user_id_idx").on(table.userId),
    check(
      "audit_requests_status_check",
      sql`${table.status} in ('created', 'resolving', 'needs_user_input', 'complete_for_payment', 'awaiting_payment', 'paid', 'generating', 'reviewing', 'published', 'blocked', 'failed')`,
    ),
    check("audit_requests_price_usd_check", sql`${table.priceUsd} >= 0`),
  ],
);

export const auditInputs = pgTable(
  "audit_inputs",
  {
    id: text("id").primaryKey(),
    auditRequestId: text("audit_request_id")
      .notNull()
      .references(() => auditRequests.id),
    travelMonth: text("travel_month"),
    startDate: date("start_date"),
    endDate: date("end_date"),
    arrivalOrigin: text("arrival_origin"),
    arrivalRouteId: text("arrival_route_id").references(() => routes.id),
    accommodationName: text("accommodation_name"),
    accommodationEntityId: text("accommodation_entity_id").references(() => entities.id),
    stayAreaId: text("stay_area_id").references(() => areas.id),
    topConstraint: text("top_constraint").notNull(),
    optionalModules: jsonb("optional_modules").$type<string[]>().notNull().default([]),
    travelerContext: jsonb("traveler_context")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_inputs_audit_request_id_idx").on(table.auditRequestId),
    index("audit_inputs_arrival_route_id_idx").on(table.arrivalRouteId),
    index("audit_inputs_accommodation_entity_id_idx").on(table.accommodationEntityId),
    index("audit_inputs_stay_area_id_idx").on(table.stayAreaId),
    check(
      "audit_inputs_date_order_check",
      sql`${table.startDate} is null or ${table.endDate} is null or ${table.startDate} <= ${table.endDate}`,
    ),
  ],
);

export const auditRuns = pgTable(
  "audit_runs",
  {
    id: text("id").primaryKey(),
    auditRequestId: text("audit_request_id")
      .notNull()
      .references(() => auditRequests.id),
    state: text("state").notNull(),
    stateHistory: jsonb("state_history")
      .$type<Array<{ state: string; at: string }>>()
      .notNull()
      .default([]),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    index("audit_runs_audit_request_id_idx").on(table.auditRequestId),
    check(
      "audit_runs_state_check",
      sql`${table.state} in ('created', 'resolving', 'needs_user_input', 'complete_for_payment', 'awaiting_payment', 'paid', 'generating', 'reviewing', 'published', 'blocked', 'failed', 'queued', 'running', 'succeeded')`,
    ),
    check(
      "audit_runs_timestamp_order_check",
      sql`${table.startedAt} is null or ${table.completedAt} is null or ${table.startedAt} <= ${table.completedAt}`,
    ),
  ],
);

export const auditCompletenessChecks = pgTable(
  "audit_completeness_checks",
  {
    id: text("id").primaryKey(),
    auditRequestId: text("audit_request_id")
      .notNull()
      .references(() => auditRequests.id),
    canComplete: boolean("can_complete").notNull(),
    blockingReasons: jsonb("blocking_reasons").$type<string[]>().notNull().default([]),
    previewRisk: jsonb("preview_risk"),
    requiredUserFollowups: jsonb("required_user_followups").$type<string[]>().notNull().default([]),
    evidenceSummary: jsonb("evidence_summary").$type<string[]>().notNull().default([]),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("audit_completeness_checks_audit_request_id_idx").on(table.auditRequestId)],
);

export const payments = pgTable(
  "payments",
  {
    id: text("id").primaryKey(),
    auditRequestId: text("audit_request_id")
      .notNull()
      .references(() => auditRequests.id),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeEventId: text("stripe_event_id").unique(),
    amountUsd: numeric("amount_usd").notNull(),
    status: text("status").notNull(),
    webhookVerifiedAt: timestamp("webhook_verified_at", { withTimezone: true }),
    diagnosticContext: jsonb("diagnostic_context")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("payments_audit_request_id_idx").on(table.auditRequestId),
    check("payments_amount_usd_check", sql`${table.amountUsd} >= 0`),
    check(
      "payments_status_check",
      sql`${table.status} in ('not_started', 'checkout_started', 'paid', 'failed')`,
    ),
  ],
);

export const paymentEvents = pgTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    auditRequestId: text("audit_request_id")
      .notNull()
      .references(() => auditRequests.id),
    stripeEventId: text("stripe_event_id").notNull().unique(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    eventType: text("event_type").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
    rawEvent: jsonb("raw_event").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index("payment_events_audit_request_id_idx").on(table.auditRequestId)],
);

export const auditReports = pgTable(
  "audit_reports",
  {
    id: text("id").primaryKey(),
    auditRequestId: text("audit_request_id")
      .notNull()
      .references(() => auditRequests.id),
    auditRunId: text("audit_run_id").references(() => auditRuns.id),
    overallRisk: text("overall_risk").notNull(),
    confidenceLabel: text("confidence_label").notNull(),
    reportJson: jsonb("report_json").$type<Record<string, unknown>>().notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    limitations: jsonb("limitations").$type<string[]>().notNull().default([]),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_reports_audit_request_id_idx").on(table.auditRequestId),
    index("audit_reports_audit_run_id_idx").on(table.auditRunId),
    check(
      "audit_reports_overall_risk_check",
      sql`${table.overallRisk} in ('green', 'yellow', 'red')`,
    ),
    check(
      "audit_reports_confidence_label_check",
      sql`${table.confidenceLabel} in ('low', 'medium', 'high')`,
    ),
  ],
);

export const refreshJobs = pgTable(
  "refresh_jobs",
  {
    id: text("id").primaryKey(),
    factId: text("fact_id").references(() => facts.id),
    sourceProfileId: text("source_profile_id").references(() => sourceProfiles.id),
    entityId: text("entity_id").references(() => entities.id),
    refreshReason: text("refresh_reason").notNull(),
    priority: integer("priority").notNull(),
    providerBudget: jsonb("provider_budget").$type<Record<string, unknown>>().notNull().default({}),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    resultStatus: text("result_status").notNull().default("scheduled"),
  },
  (table) => [
    index("refresh_jobs_fact_id_idx").on(table.factId),
    index("refresh_jobs_source_profile_id_idx").on(table.sourceProfileId),
    index("refresh_jobs_entity_id_idx").on(table.entityId),
    check("refresh_jobs_priority_check", sql`${table.priority} >= 0 and ${table.priority} <= 100`),
    check("refresh_jobs_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "refresh_jobs_result_status_check",
      sql`${table.resultStatus} in ('scheduled', 'running', 'succeeded', 'failed')`,
    ),
  ],
);

export const publicEvidenceBundles = pgTable(
  "public_evidence_bundles",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    summary: text("summary").notNull(),
    allowedUse: text("allowed_use").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "public_evidence_bundles_allowed_use_check",
      sql`${table.allowedUse} in ('internal_only', 'audit_only', 'citation_only', 'public_republish', 'disallowed')`,
    ),
  ],
);

export const publicPages = pgTable(
  "public_pages",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    pageType: text("page_type").notNull(),
    entityId: text("entity_id").references(() => entities.id),
    canonicalUrl: text("canonical_url").notNull(),
    humanPath: text("human_path").notNull(),
    llmMarkdownPath: text("llm_markdown_path").notNull(),
    jsonApiPath: text("json_api_path").notNull(),
    evidenceBundleId: text("evidence_bundle_id").references(() => publicEvidenceBundles.id),
    lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    confidenceLabel: text("confidence_label").notNull(),
    publicVisibility: text("public_visibility").notNull(),
    indexingStatus: text("indexing_status").notNull(),
    staleFields: jsonb("stale_fields").$type<string[]>().notNull().default([]),
    generationSourceFactIds: jsonb("generation_source_fact_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
  },
  (table) => [
    index("public_pages_entity_id_idx").on(table.entityId),
    index("public_pages_evidence_bundle_id_idx").on(table.evidenceBundleId),
    check(
      "public_pages_page_type_check",
      sql`${table.pageType} in ('accommodations', 'areas', 'routes', 'operators', 'risks')`,
    ),
    check(
      "public_pages_confidence_label_check",
      sql`${table.confidenceLabel} in ('low', 'medium', 'high')`,
    ),
    check(
      "public_pages_public_visibility_check",
      sql`${table.publicVisibility} in ('internal', 'eligible', 'published', 'noindex', 'blocked')`,
    ),
    check(
      "public_pages_indexing_status_check",
      sql`${table.indexingStatus} in ('index', 'noindex')`,
    ),
  ],
);

export const publicPageFacts = pgTable(
  "public_page_facts",
  {
    publicPageId: text("public_page_id")
      .notNull()
      .references(() => publicPages.id, { onDelete: "cascade" }),
    factId: text("fact_id")
      .notNull()
      .references(() => facts.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.publicPageId, table.factId] }),
    uniqueIndex("public_page_facts_public_page_position_key").on(
      table.publicPageId,
      table.position,
    ),
    index("public_page_facts_ordered_page_idx").on(
      table.publicPageId,
      table.position,
      table.factId,
    ),
    index("public_page_facts_fact_id_idx").on(table.factId, table.publicPageId),
    check("public_page_facts_position_check", sql`${table.position} >= 0`),
  ],
);

export const publicEvidenceBundleEvidence = pgTable(
  "public_evidence_bundle_evidence",
  {
    evidenceBundleId: text("evidence_bundle_id")
      .notNull()
      .references(() => publicEvidenceBundles.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidence.id, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.evidenceBundleId, table.evidenceId] }),
    uniqueIndex("public_evidence_bundle_evidence_bundle_position_key").on(
      table.evidenceBundleId,
      table.position,
    ),
    index("public_evidence_bundle_evidence_ordered_bundle_idx").on(
      table.evidenceBundleId,
      table.position,
      table.evidenceId,
    ),
    index("public_evidence_bundle_evidence_evidence_id_idx").on(
      table.evidenceId,
      table.evidenceBundleId,
    ),
    check("public_evidence_bundle_evidence_position_check", sql`${table.position} >= 0`),
  ],
);

export const agentReadableSnapshots = pgTable(
  "agent_readable_snapshots",
  {
    id: text("id").primaryKey(),
    publicPageId: text("public_page_id")
      .notNull()
      .references(() => publicPages.id),
    format: text("format").notNull(),
    path: text("path").notNull(),
    contentHash: text("content_hash").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("agent_readable_snapshots_public_page_id_idx").on(table.publicPageId),
    check("agent_readable_snapshots_format_check", sql`${table.format} in ('markdown', 'json')`),
  ],
);

export const llmRuns = pgTable(
  "llm_runs",
  {
    id: text("id").primaryKey(),
    auditRunId: text("audit_run_id").references(() => auditRuns.id),
    runType: text("run_type").notNull(),
    modelFamily: text("model_family").notNull(),
    inputRedactionVersion: text("input_redaction_version").notNull(),
    outputSchemaVersion: text("output_schema_version").notNull(),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("llm_runs_audit_run_id_idx").on(table.auditRunId),
    check(
      "llm_runs_status_check",
      sql`${table.status} in ('queued', 'running', 'succeeded', 'failed', 'completed')`,
    ),
    check(
      "llm_runs_timestamp_order_check",
      sql`${table.completedAt} is null or ${table.startedAt} <= ${table.completedAt}`,
    ),
  ],
);

export const llmToolCalls = pgTable(
  "llm_tool_calls",
  {
    id: text("id").primaryKey(),
    llmRunId: text("llm_run_id")
      .notNull()
      .references(() => llmRuns.id),
    toolName: text("tool_name").notNull(),
    argumentsJson: jsonb("arguments_json").$type<Record<string, unknown>>().notNull(),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("llm_tool_calls_llm_run_id_idx").on(table.llmRunId)],
);

export const reviewerResults = pgTable(
  "reviewer_results",
  {
    id: text("id").primaryKey(),
    auditRunId: text("audit_run_id").references(() => auditRuns.id),
    llmRunId: text("llm_run_id").references(() => llmRuns.id),
    verdict: text("verdict").notNull(),
    corrections: jsonb("corrections").$type<string[]>().notNull().default([]),
    blockedReasons: jsonb("blocked_reasons").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("reviewer_results_audit_run_id_idx").on(table.auditRunId),
    index("reviewer_results_llm_run_id_idx").on(table.llmRunId),
    check(
      "reviewer_results_verdict_check",
      sql`${table.verdict} in ('approved', 'needs_revision', 'blocked')`,
    ),
  ],
);

export const providerHealthChecks = pgTable(
  "provider_health_checks",
  {
    id: text("id").primaryKey(),
    providerId: text("provider_id")
      .notNull()
      .references(() => providers.id),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
  },
  (table) => [
    index("provider_health_checks_provider_id_idx").on(table.providerId),
    check(
      "provider_health_checks_status_check",
      sql`${table.status} in ('ok', 'degraded', 'failed')`,
    ),
    check(
      "provider_health_checks_latency_ms_check",
      sql`${table.latencyMs} is null or ${table.latencyMs} >= 0`,
    ),
  ],
);

export const publicPageGenerationJobs = pgTable(
  "public_page_generation_jobs",
  {
    id: text("id").primaryKey(),
    publicPageId: text("public_page_id").references(() => publicPages.id),
    status: text("status").notNull(),
    reason: text("reason").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    lastError: text("last_error"),
  },
  (table) => [
    index("public_page_generation_jobs_public_page_id_idx").on(table.publicPageId),
    check(
      "public_page_generation_jobs_status_check",
      sql`${table.status} in ('scheduled', 'running', 'succeeded', 'failed')`,
    ),
    check(
      "public_page_generation_jobs_timestamp_order_check",
      sql`${table.completedAt} is null or ${table.scheduledAt} <= ${table.completedAt}`,
    ),
  ],
);

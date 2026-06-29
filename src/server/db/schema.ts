import { sql } from "drizzle-orm";
import {
  boolean,
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
    accessibilityNotes: text("accessibility_notes"),
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
    index("chat_response_ratings_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("chat_response_ratings_thread_id_idx").on(table.threadId),
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

export const areas = pgTable("areas", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  municipality: text("municipality").notNull(),
  description: text("description").notNull(),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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

export const providers = pgTable("providers", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  providerType: text("provider_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sourceProfiles = pgTable("source_profiles", {
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
});

export const sourcePermissions = pgTable("source_permissions", {
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
});

export const entities = pgTable("entities", {
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
});

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

export const rawSnapshots = pgTable("raw_snapshots", {
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
});

export const sourceRecords = pgTable("source_records", {
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
});

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
  (table) => [index("google_places_details_stale_at_idx").on(table.detailsStaleAt)],
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
    index("google_place_snapshots_stale_at_idx").on(table.staleAt),
    index("google_place_snapshots_retention_expires_at_idx").on(table.retentionExpiresAt),
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
  ],
);

export const candidateEntities = pgTable("candidate_entities", {
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
});

export const entityMatches = pgTable("entity_matches", {
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
});

export const facts = pgTable("facts", {
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
});

export const evidence = pgTable("evidence", {
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
});

export const reviews = pgTable("reviews", {
  id: text("id").primaryKey(),
  entityId: text("entity_id").references(() => entities.id),
  sourceRecordId: text("source_record_id").references(() => sourceRecords.id),
  rating: numeric("rating"),
  reviewCount: integer("review_count"),
  themes: jsonb("themes").$type<string[]>().notNull().default([]),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  allowedUse: text("allowed_use").notNull(),
});

export const factConfidenceScores = pgTable("fact_confidence_scores", {
  id: text("id").primaryKey(),
  factId: text("fact_id")
    .notNull()
    .references(() => facts.id),
  score: numeric("score").notNull(),
  label: text("label").notNull(),
  drivers: jsonb("drivers").$type<string[]>().notNull().default([]),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sourceCredibilityScores = pgTable("source_credibility_scores", {
  id: text("id").primaryKey(),
  sourceProfileId: text("source_profile_id")
    .notNull()
    .references(() => sourceProfiles.id),
  score: numeric("score").notNull(),
  label: text("label").notNull(),
  drivers: jsonb("drivers").$type<string[]>().notNull().default([]),
  scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
});

export const factConflicts = pgTable("fact_conflicts", {
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
});

export const auditRequests = pgTable("audit_requests", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id),
  email: text("email"),
  status: text("status").notNull(),
  priceUsd: numeric("price_usd").notNull().default("9.99"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditInputs = pgTable("audit_inputs", {
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
  travelerContext: jsonb("traveler_context").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const auditRuns = pgTable("audit_runs", {
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
});

export const auditCompletenessChecks = pgTable("audit_completeness_checks", {
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
});

export const payments = pgTable("payments", {
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
});

export const paymentEvents = pgTable("payment_events", {
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
});

export const auditReports = pgTable("audit_reports", {
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
});

export const refreshJobs = pgTable("refresh_jobs", {
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
});

export const publicEvidenceBundles = pgTable("public_evidence_bundles", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
  summary: text("summary").notNull(),
  allowedUse: text("allowed_use").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const publicPages = pgTable("public_pages", {
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
});

export const agentReadableSnapshots = pgTable("agent_readable_snapshots", {
  id: text("id").primaryKey(),
  publicPageId: text("public_page_id")
    .notNull()
    .references(() => publicPages.id),
  format: text("format").notNull(),
  path: text("path").notNull(),
  contentHash: text("content_hash").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const llmRuns = pgTable("llm_runs", {
  id: text("id").primaryKey(),
  auditRunId: text("audit_run_id").references(() => auditRuns.id),
  runType: text("run_type").notNull(),
  modelFamily: text("model_family").notNull(),
  inputRedactionVersion: text("input_redaction_version").notNull(),
  outputSchemaVersion: text("output_schema_version").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const llmToolCalls = pgTable("llm_tool_calls", {
  id: text("id").primaryKey(),
  llmRunId: text("llm_run_id")
    .notNull()
    .references(() => llmRuns.id),
  toolName: text("tool_name").notNull(),
  argumentsJson: jsonb("arguments_json").$type<Record<string, unknown>>().notNull(),
  resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
  evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
  calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
});

export const reviewerResults = pgTable("reviewer_results", {
  id: text("id").primaryKey(),
  auditRunId: text("audit_run_id").references(() => auditRuns.id),
  llmRunId: text("llm_run_id").references(() => llmRuns.id),
  verdict: text("verdict").notNull(),
  corrections: jsonb("corrections").$type<string[]>().notNull().default([]),
  blockedReasons: jsonb("blocked_reasons").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const providerHealthChecks = pgTable("provider_health_checks", {
  id: text("id").primaryKey(),
  providerId: text("provider_id")
    .notNull()
    .references(() => providers.id),
  status: text("status").notNull(),
  latencyMs: integer("latency_ms"),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
});

export const publicPageGenerationJobs = pgTable("public_page_generation_jobs", {
  id: text("id").primaryKey(),
  publicPageId: text("public_page_id").references(() => publicPages.id),
  status: text("status").notNull(),
  reason: text("reason").notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  lastError: text("last_error"),
});

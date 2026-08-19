import { relations, sql } from "drizzle-orm";
import {
  bigint,
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
    email: text("email"),
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

export const accountClosureTombstones = pgTable(
  "account_closure_tombstones",
  {
    id: text("id").primaryKey(),
    subjectHash: text("subject_hash").notNull().unique(),
    subjectHashVersion: integer("subject_hash_version").notNull(),
    subjectType: text("subject_type").notNull(),
    closurePolicyVersion: text("closure_policy_version").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull().defaultNow(),
    purgeAfter: timestamp("purge_after", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_closure_tombstones_subject_idx").on(
      table.subjectType,
      table.subjectHashVersion,
      table.subjectHash,
    ),
    index("account_closure_tombstones_purge_after_idx").on(table.purgeAfter),
    check(
      "account_closure_tombstones_subject_hash_version_check",
      sql`${table.subjectHashVersion} > 0`,
    ),
    check(
      "account_closure_tombstones_subject_type_check",
      sql`${table.subjectType} in ('clerk_user_id')`,
    ),
    check(
      "account_closure_tombstones_purge_after_check",
      sql`${table.purgeAfter} is null or ${table.purgeAfter} >= ${table.closedAt}`,
    ),
  ],
);

export const accountClosureOperations = pgTable(
  "account_closure_operations",
  {
    id: text("id").primaryKey(),
    tombstoneId: text("tombstone_id")
      .notNull()
      .references(() => accountClosureTombstones.id),
    operationType: text("operation_type").notNull(),
    status: text("status").notNull(),
    attempts: integer("attempts").notNull().default(0),
    lastErrorCode: text("last_error_code"),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    phaseOneCommittedAt: timestamp("phase_one_committed_at", { withTimezone: true }),
    closurePolicyVersion: text("closure_policy_version"),
    commercePolicyVersion: text("commerce_policy_version"),
    alertAfterAttempts: integer("alert_after_attempts").notNull().default(3),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("account_closure_operations_tombstone_id_idx").on(table.tombstoneId),
    index("account_closure_operations_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    check(
      "account_closure_operations_operation_type_check",
      sql`${table.operationType} in ('traveler_requested_closure', 'clerk_deletion_identity_sync')`,
    ),
    check(
      "account_closure_operations_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed')`,
    ),
    check("account_closure_operations_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "account_closure_operations_alert_after_attempts_check",
      sql`${table.alertAfterAttempts} > 0`,
    ),
    check(
      "account_closure_operations_completed_at_check",
      sql`${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt}`,
    ),
  ],
);

export const accountClosureSteps = pgTable(
  "account_closure_steps",
  {
    id: text("id").primaryKey(),
    operationId: text("operation_id")
      .notNull()
      .references(() => accountClosureOperations.id, { onDelete: "cascade" }),
    stepType: text("step_type").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCategory: text("last_error_category"),
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("account_closure_steps_operation_step_key").on(table.operationId, table.stepType),
    index("account_closure_steps_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
      table.id,
    ),
    check(
      "account_closure_steps_type_check",
      sql`${table.stepType} in ('clerk_deletion', 'checkout_expiry', 'local_erasure', 'commerce_minimization', 'identity_erasure')`,
    ),
    check(
      "account_closure_steps_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded')`,
    ),
    check("account_closure_steps_attempts_check", sql`${table.attempts} >= 0`),
  ],
);

export const accountClosureProviderSubjects = pgTable("account_closure_provider_subjects", {
  operationId: text("operation_id")
    .primaryKey()
    .references(() => accountClosureOperations.id, { onDelete: "cascade" }),
  ciphertext: text("ciphertext").notNull(),
  iv: text("iv").notNull(),
  authTag: text("auth_tag").notNull(),
  keyVersion: integer("key_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountClosureCheckoutSessions = pgTable(
  "account_closure_checkout_sessions",
  {
    operationId: text("operation_id")
      .notNull()
      .references(() => accountClosureOperations.id, { onDelete: "cascade" }),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
    status: text("status").notNull().default("pending"),
    lastErrorCategory: text("last_error_category"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.operationId, table.stripeCheckoutSessionId] })],
);

export const retainedCommerceEvidence = pgTable(
  "retained_commerce_evidence",
  {
    id: text("id").primaryKey(),
    tombstoneId: text("tombstone_id")
      .notNull()
      .references(() => accountClosureTombstones.id),
    sourceType: text("source_type").notNull(),
    sourceRef: text("source_ref").notNull(),
    amountMinor: integer("amount_minor"),
    currency: text("currency"),
    productCode: text("product_code"),
    productVersion: integer("product_version"),
    productFamily: text("product_family"),
    lifecycleStatus: text("lifecycle_status").notNull(),
    lifecycleTimestamps: jsonb("lifecycle_timestamps")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeEventId: text("stripe_event_id"),
    policyVersion: text("policy_version").notNull(),
    consentPolicyVersions: jsonb("consent_policy_versions")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    aggregateServiceFacts: jsonb("aggregate_service_facts")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }),
    retentionExpiresAt: timestamp("retention_expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("retained_commerce_evidence_source_key").on(table.sourceType, table.sourceRef),
    index("retained_commerce_evidence_tombstone_idx").on(
      table.tombstoneId,
      table.retentionExpiresAt,
    ),
  ],
);

export const accountClosureRefundObligations = pgTable(
  "account_closure_refund_obligations",
  {
    id: text("id").primaryKey(),
    tombstoneId: text("tombstone_id")
      .notNull()
      .references(() => accountClosureTombstones.id),
    orderId: text("order_id").notNull().unique(),
    stripeEventId: text("stripe_event_id"),
    reason: text("reason").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCategory: text("last_error_category"),
    policyVersion: text("policy_version").notNull(),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    stripeRefundId: text("stripe_refund_id"),
    expectedAmountMinor: integer("expected_amount_minor"),
    providerStatus: text("provider_status"),
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("account_closure_refund_obligations_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
      table.id,
    ),
  ],
);

export const privacyRestoreGuardState = pgTable("privacy_restore_guard_state", {
  id: text("id").primaryKey(),
  privacySnapshotVersion: text("privacy_snapshot_version").notNull(),
  sourceMaxClosedAt: timestamp("source_max_closed_at", { withTimezone: true }).notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountClosureWriteBarriers = pgTable(
  "account_closure_write_barriers",
  {
    id: text("id").primaryKey(),
    tombstoneId: text("tombstone_id")
      .notNull()
      .references(() => accountClosureTombstones.id),
    subjectHash: text("subject_hash").notNull().unique(),
    subjectHashVersion: integer("subject_hash_version").notNull(),
    subjectType: text("subject_type").notNull(),
    status: text("status").notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_closure_write_barriers_tombstone_id_idx").on(table.tombstoneId),
    index("account_closure_write_barriers_subject_idx").on(
      table.subjectType,
      table.subjectHashVersion,
      table.subjectHash,
    ),
    check(
      "account_closure_write_barriers_subject_hash_version_check",
      sql`${table.subjectHashVersion} > 0`,
    ),
    check(
      "account_closure_write_barriers_subject_type_check",
      sql`${table.subjectType} in ('clerk_user_id')`,
    ),
    check(
      "account_closure_write_barriers_status_check",
      sql`${table.status} in ('active', 'released')`,
    ),
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
    completionStatus: text("completion_status").notNull().default("complete"),
    terminationReason: text("termination_reason"),
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
    check(
      "chat_messages_completion_status_check",
      sql`${table.completionStatus} in ('complete', 'completed_with_limits')`,
    ),
    check(
      "chat_messages_termination_reason_check",
      sql`${table.terminationReason} is null or ${table.terminationReason} in ('model_response_budget_exhausted', 'model_response_invalid', 'model_response_unavailable')`,
    ),
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
    terminalRevocationReason: text("terminal_revocation_reason"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_passes_user_id_idx").on(table.userId),
    index("trip_passes_status_expires_at_idx").on(table.status, table.expiresAt),
    check(
      "trip_passes_status_check",
      sql`${table.status} in ('active', 'suspended', 'expired', 'cancelled', 'refunded')`,
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

export const tripPassOrders = pgTable(
  "trip_pass_orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").references(() => users.id),
    email: text("email"),
    status: text("status").notNull(),
    productCode: text("product_code").notNull(),
    productFamily: text("product_family").notNull().default("siargao_trip_pass"),
    productVersion: integer("product_version").notNull(),
    stripePriceId: text("stripe_price_id"),
    amountTotalMinor: integer("amount_total_minor"),
    capturedAmountMinor: integer("captured_amount_minor"),
    successfulRefundAmountMinor: integer("successful_refund_amount_minor").notNull().default(0),
    refundState: text("refund_state").notNull().default("none"),
    refundRemainingAmountMinor: integer("refund_remaining_amount_minor"),
    refundReviewDeadlineAt: timestamp("refund_review_deadline_at", { withTimezone: true }),
    refundReviewAlertedAt: timestamp("refund_review_alerted_at", { withTimezone: true }),
    disputeState: text("dispute_state").notNull().default("none"),
    terminalRevocationReason: text("terminal_revocation_reason"),
    lifecycleUpdatedAt: timestamp("lifecycle_updated_at", { withTimezone: true }),
    paymentProvider: text("payment_provider").notNull().default("stripe"),
    providerStoreId: text("provider_store_id"),
    providerProductId: text("provider_product_id"),
    providerVariantId: text("provider_variant_id"),
    providerCheckoutId: text("provider_checkout_id"),
    providerOrderId: text("provider_order_id"),
    providerPaymentId: text("provider_payment_id"),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    checkoutAttemptId: text("checkout_attempt_id"),
    acceptedPaymentFactId: text("accepted_payment_fact_id"),
    paymentSuspensionState: text("payment_suspension_state").notNull().default("none"),
    currency: text("currency"),
    checkoutIdempotencyKey: text("checkout_idempotency_key").notNull().unique(),
    stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
    checkoutSessionExpiresAt: timestamp("checkout_session_expires_at", { withTimezone: true }),
    checkoutSessionStatus: text("checkout_session_status"),
    checkoutCancellationConfirmedAt: timestamp("checkout_cancellation_confirmed_at", {
      withTimezone: true,
    }),
    stripePaymentIntentId: text("stripe_payment_intent_id").unique(),
    stripeCustomerId: text("stripe_customer_id"),
    termsPolicyVersion: text("terms_policy_version"),
    refundPolicyVersion: text("refund_policy_version"),
    privacyPolicyVersion: text("privacy_policy_version"),
    retentionPolicyVersion: text("retention_policy_version"),
    termsConsentPresentedAt: timestamp("terms_consent_presented_at", { withTimezone: true }),
    metadataJson: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    closureTombstoneId: text("closure_tombstone_id").references(() => accountClosureTombstones.id),
    closureOutcome: text("closure_outcome"),
    closureRefundObligationId: text("closure_refund_obligation_id").references(
      () => accountClosureRefundObligations.id,
    ),
  },
  (table) => [
    index("trip_pass_orders_user_status_created_at_idx").on(
      table.userId,
      table.status,
      table.createdAt,
    ),
    index("trip_pass_orders_status_created_at_idx").on(table.status, table.createdAt),
    index("trip_pass_orders_product_code_idx").on(table.productCode),
    index("trip_pass_orders_product_family_idx").on(table.productFamily),
    index("trip_pass_orders_user_family_effective_pending_idx")
      .on(table.userId, table.productFamily, table.status, table.createdAt)
      .where(sql`${table.status} in ('pending', 'checkout_created')`),
    index("trip_pass_orders_closure_tombstone_id_idx").on(table.closureTombstoneId),
    index("trip_pass_orders_closure_refund_obligation_id_idx").on(table.closureRefundObligationId),
    check(
      "trip_pass_orders_status_check",
      sql`${table.status} in ('pending', 'checkout_created', 'paid', 'cancelled', 'expired', 'refunded', 'disputed', 'failed')`,
    ),
    check("trip_pass_orders_product_family_check", sql`${table.productFamily} <> ''`),
    check(
      "trip_pass_orders_checkout_session_status_check",
      sql`${table.checkoutSessionStatus} is null or ${table.checkoutSessionStatus} in ('open', 'complete', 'expired')`,
    ),
    check("trip_pass_orders_product_version_check", sql`${table.productVersion} > 0`),
    check(
      "trip_pass_orders_amount_total_minor_check",
      sql`${table.amountTotalMinor} is null or ${table.amountTotalMinor} >= 0`,
    ),
    check(
      "trip_pass_orders_currency_check",
      sql`${table.currency} is null or ${table.currency} ~ '^[a-z]{3}$'`,
    ),
    check(
      "trip_pass_orders_completed_at_check",
      sql`${table.completedAt} is null or ${table.completedAt} >= ${table.createdAt}`,
    ),
    check(
      "trip_pass_orders_closure_outcome_check",
      sql`${table.closureOutcome} is null or ${table.closureOutcome} in ('blocked_at_closure', 'paid_after_closure')`,
    ),
    check(
      "trip_pass_orders_payment_provider_check",
      sql`${table.paymentProvider} in ('stripe', 'lemon_squeezy')`,
    ),
    check(
      "trip_pass_orders_payment_suspension_check",
      sql`${table.paymentSuspensionState} in ('none', 'fraudulent', 'disputed')`,
    ),
  ],
);

export const tripPassCheckoutAttempts = pgTable(
  "trip_pass_checkout_attempts",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => tripPassOrders.id),
    provider: text("provider").notNull(),
    providerCheckoutId: text("provider_checkout_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    checkoutUrl: text("checkout_url"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_pass_checkout_attempts_order_idx").on(table.orderId, table.createdAt),
    uniqueIndex("trip_pass_checkout_attempts_provider_checkout_idx")
      .on(table.provider, table.providerCheckoutId)
      .where(sql`${table.providerCheckoutId} is not null`),
    check(
      "trip_pass_checkout_attempts_provider_check",
      sql`${table.provider} in ('lemon_squeezy', 'stripe')`,
    ),
    check(
      "trip_pass_checkout_attempts_status_check",
      sql`${table.status} in ('pending', 'created', 'expired', 'failed', 'paid', 'cancelled')`,
    ),
  ],
);

export const tripPassPaymentEventReceipts = pgTable(
  "trip_pass_payment_event_receipts",
  {
    id: text("id").primaryKey(),
    fingerprint: text("fingerprint").notNull().unique(),
    provider: text("provider").notNull(),
    eventName: text("event_name").notNull(),
    objectId: text("object_id").notNull(),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }).notNull(),
    orderId: text("order_id"),
    providerOrderId: text("provider_order_id"),
    status: text("status").notNull().default("pending"),
    amountTotalMinor: integer("amount_total_minor"),
    refundedAmountMinor: integer("refunded_amount_minor"),
    currency: text("currency"),
    normalizedFactsJson: jsonb("normalized_facts_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_pass_payment_event_receipts_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.createdAt,
    ),
    check(
      "trip_pass_payment_event_receipts_provider_check",
      sql`${table.provider} = 'lemon_squeezy'`,
    ),
    check(
      "trip_pass_payment_event_receipts_status_check",
      sql`${table.status} in ('pending', 'applied', 'blocked')`,
    ),
    check(
      "trip_pass_payment_event_receipts_amount_check",
      sql`(${table.amountTotalMinor} is null or ${table.amountTotalMinor} >= 0) and (${table.refundedAmountMinor} is null or ${table.refundedAmountMinor} >= 0)`,
    ),
  ],
);

export const tripPassPaymentFacts = pgTable(
  "trip_pass_payment_facts",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").references(() => tripPassOrders.id),
    receiptId: text("receipt_id")
      .notNull()
      .references(() => tripPassPaymentEventReceipts.id),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    providerPaymentId: text("provider_payment_id"),
    fingerprint: text("fingerprint").notNull().unique(),
    status: text("status").notNull(),
    amountTotalMinor: integer("amount_total_minor"),
    refundedAmountMinor: integer("refunded_amount_minor"),
    currency: text("currency"),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_pass_payment_facts_provider_order_idx").on(
      table.provider,
      table.providerOrderId,
      table.fingerprint,
    ),
    check("trip_pass_payment_facts_provider_check", sql`${table.provider} = 'lemon_squeezy'`),
    check(
      "trip_pass_payment_facts_status_check",
      sql`${table.status} in ('pending', 'failed', 'paid', 'refunded', 'partial_refund', 'fraudulent')`,
    ),
  ],
);

export const tripPassRefundOperations = pgTable(
  "trip_pass_refund_operations",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => tripPassOrders.id),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    reason: text("reason").notNull(),
    amountMinor: integer("amount_minor"),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: text("last_error_code"),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("trip_pass_refund_operations_provider_check", sql`${table.provider} = 'lemon_squeezy'`),
    check(
      "trip_pass_refund_operations_reason_check",
      sql`${table.reason} in ('duplicate_payment', 'paid_after_closure', 'partial_refund_deadline')`,
    ),
    check(
      "trip_pass_refund_operations_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded', 'failed')`,
    ),
  ],
);

export const tripPassRefundFacts = pgTable(
  "trip_pass_refund_facts",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => tripPassOrders.id),
    stripeRefundId: text("stripe_refund_id").notNull().unique(),
    stripeChargeId: text("stripe_charge_id").notNull(),
    stripeEventId: text("stripe_event_id").notNull(),
    providerStatus: text("provider_status").notNull(),
    amountMinor: integer("amount_minor").notNull(),
    providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_pass_refund_facts_order_status_idx").on(
      table.orderId,
      table.providerStatus,
      table.updatedAt,
    ),
  ],
);

export const tripPassDisputeFacts = pgTable(
  "trip_pass_dispute_facts",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => tripPassOrders.id),
    stripeDisputeId: text("stripe_dispute_id").notNull().unique(),
    stripeChargeId: text("stripe_charge_id"),
    stripeEventId: text("stripe_event_id").notNull(),
    providerStatus: text("provider_status").notNull(),
    applicationStatus: text("application_status").notNull(),
    amountMinor: integer("amount_minor"),
    providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_pass_dispute_facts_order_status_idx").on(
      table.orderId,
      table.applicationStatus,
      table.updatedAt,
    ),
  ],
);

export const tripPassGrants = pgTable(
  "trip_pass_grants",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").references(() => tripPassOrders.id),
    tripPassId: text("trip_pass_id")
      .notNull()
      .references(() => tripPasses.id),
    userId: text("user_id").references(() => users.id),
    sourceType: text("source_type").notNull(),
    sourceEventId: text("source_event_id").notNull(),
    productCode: text("product_code").notNull(),
    productVersion: integer("product_version").notNull(),
    quantity: integer("quantity").notNull().default(1),
    durationDays: integer("duration_days").notNull(),
    meterLimitsJson: jsonb("meter_limits_json").$type<Record<string, number>>().notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("trip_pass_grants_source_type_event_id_idx").on(
      table.sourceType,
      table.sourceEventId,
    ),
    index("trip_pass_grants_order_id_idx").on(table.orderId),
    index("trip_pass_grants_trip_pass_id_idx").on(table.tripPassId),
    index("trip_pass_grants_user_expires_at_idx").on(table.userId, table.expiresAt),
    check(
      "trip_pass_grants_source_type_check",
      sql`${table.sourceType} in ('stripe_checkout', 'lemon_squeezy_checkout', 'manual_operator', 'refund_adjustment', 'dispute_adjustment')`,
    ),
    check("trip_pass_grants_product_version_check", sql`${table.productVersion} > 0`),
    check("trip_pass_grants_quantity_check", sql`${table.quantity} > 0`),
    check("trip_pass_grants_duration_days_check", sql`${table.durationDays} > 0`),
    check("trip_pass_grants_timestamp_order_check", sql`${table.startsAt} < ${table.expiresAt}`),
  ],
);

export const tripUsageEvents = pgTable(
  "trip_usage_events",
  {
    id: text("id").primaryKey(),
    tripPassId: text("trip_pass_id")
      .notNull()
      .references(() => tripPasses.id),
    usageMeterId: text("usage_meter_id").references(() => tripUsageMeters.id),
    userId: text("user_id").references(() => users.id),
    eventType: text("event_type").notNull(),
    meterType: text("meter_type").notNull(),
    quantity: integer("quantity").notNull(),
    idempotencyKey: text("idempotency_key").unique(),
    requestId: text("request_id"),
    requestHash: text("request_hash"),
    providerRequestIdsJson: jsonb("provider_request_ids_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_usage_events_trip_pass_meter_created_at_idx").on(
      table.tripPassId,
      table.meterType,
      table.createdAt,
    ),
    index("trip_usage_events_usage_meter_id_idx").on(table.usageMeterId),
    index("trip_usage_events_user_created_at_idx").on(table.userId, table.createdAt),
    index("trip_usage_events_request_id_idx").on(table.requestId),
    check(
      "trip_usage_events_event_type_check",
      sql`${table.eventType} in ('reserved', 'settled', 'released', 'adjusted')`,
    ),
    check(
      "trip_usage_events_meter_type_check",
      sql`${table.meterType} in ('chat_message', 'live_refresh', 'heavy_recommendation', 'weather_refresh', 'route_lookup')`,
    ),
    check("trip_usage_events_quantity_check", sql`${table.quantity} > 0`),
  ],
);

export const paidAnswerReservations = pgTable(
  "paid_answer_reservations",
  {
    id: text("id").primaryKey(),
    tripPassId: text("trip_pass_id")
      .notNull()
      .references(() => tripPasses.id),
    usageMeterId: text("usage_meter_id")
      .notNull()
      .references(() => tripUsageMeters.id),
    accountId: text("account_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    requestBodyHash: text("request_body_hash").notNull(),
    requestId: text("request_id").notNull(),
    leaseToken: text("lease_token").notNull(),
    status: text("status").notNull().default("open"),
    releaseReason: text("release_reason"),
    invalidationReason: text("invalidation_reason"),
    answerMessageId: text("answer_message_id").references(() => chatMessages.id, {
      onDelete: "set null",
    }),
    resultJson: jsonb("result_json").$type<Record<string, unknown>>(),
    providerRequestIdsJson: jsonb("provider_request_ids_json")
      .$type<string[]>()
      .notNull()
      .default([]),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
    detailsPurgeAt: timestamp("details_purge_at", { withTimezone: true }).notNull(),
    detailsPurgedAt: timestamp("details_purged_at", { withTimezone: true }),
    purgeAttemptedAt: timestamp("purge_attempted_at", { withTimezone: true }),
    purgeRetryAt: timestamp("purge_retry_at", { withTimezone: true }),
    purgeFailureCount: integer("purge_failure_count").notNull().default(0),
    purgeLastError: text("purge_last_error"),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    invalidatedAt: timestamp("invalidated_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("paid_answer_reservations_account_idempotency_idx").on(
      table.accountId,
      table.idempotencyKeyHash,
    ),
    index("paid_answer_reservations_trip_pass_id_idx").on(table.tripPassId),
    index("paid_answer_reservations_usage_meter_id_idx").on(table.usageMeterId),
    index("paid_answer_reservations_answer_message_id_idx")
      .on(table.answerMessageId)
      .where(sql`${table.answerMessageId} is not null`),
    index("paid_answer_reservations_open_pass_idx")
      .on(table.tripPassId, table.usageMeterId, table.leaseExpiresAt)
      .where(sql`${table.status} = 'open'`),
    index("paid_answer_reservations_details_purge_idx")
      .using(
        "btree",
        sql`(coalesce(${table.purgeRetryAt}, ${table.detailsPurgeAt}))`,
        table.accountId,
        table.detailsPurgeAt,
        table.id,
      )
      .where(sql`${table.detailsPurgedAt} is null`),
    check(
      "paid_answer_reservations_status_check",
      sql`${table.status} in ('open', 'settled', 'released', 'invalidated')`,
    ),
    check(
      "paid_answer_reservations_release_reason_check",
      sql`${table.releaseReason} is null or ${table.releaseReason} in ('provider_failure', 'internal_failure', 'empty_output', 'safety_refusal', 'stale_lease', 'redis_unavailable', 'operational_limit', 'database_unavailable', 'pass_expired')`,
    ),
    check(
      "paid_answer_reservations_invalidation_reason_check",
      sql`${table.invalidationReason} is null or ${table.invalidationReason} in ('account_closed', 'full_refund', 'dispute_lost')`,
    ),
    check(
      "paid_answer_reservations_lease_order_check",
      sql`${table.reservedAt} < ${table.leaseExpiresAt}`,
    ),
    check(
      "paid_answer_reservations_purge_order_check",
      sql`${table.reservedAt} < ${table.detailsPurgeAt}`,
    ),
    check(
      "paid_answer_reservations_purge_failure_count_check",
      sql`${table.purgeFailureCount} between 0 and 31`,
    ),
    check(
      "paid_answer_reservations_purge_last_error_check",
      sql`${table.purgeLastError} is null or ${table.purgeLastError} in ('usage_event_integrity', 'purge_failed')`,
    ),
  ],
);

export const tripPassStripeEvents = pgTable(
  "trip_pass_stripe_events",
  {
    id: text("id").primaryKey(),
    stripeEventId: text("stripe_event_id").notNull().unique(),
    stripeApiVersion: text("stripe_api_version").notNull(),
    normalizedSchemaVersion: integer("normalized_schema_version").notNull(),
    eventType: text("event_type").notNull(),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    checkoutSessionId: text("checkout_session_id"),
    paymentIntentId: text("payment_intent_id"),
    orderId: text("order_id"),
    productCode: text("product_code"),
    productVersion: integer("product_version"),
    stripePriceId: text("stripe_price_id"),
    amountTotalMinor: integer("amount_total_minor"),
    currency: text("currency"),
    paymentStatus: text("payment_status"),
    status: text("status").notNull().default("pending"),
    attemptCount: integer("attempt_count").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    claimToken: text("claim_token"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    alertState: text("alert_state").notNull().default("none"),
    sanitizedErrorClass: text("sanitized_error_class"),
    normalizedFactsJson: jsonb("normalized_facts_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("trip_pass_stripe_events_status_next_attempt_idx").on(
      table.status,
      table.nextAttemptAt,
      table.receivedAt,
    ),
    index("trip_pass_stripe_events_order_id_idx").on(table.orderId),
    index("trip_pass_stripe_events_checkout_session_id_idx").on(table.checkoutSessionId),
    index("trip_pass_stripe_events_payment_intent_id_idx").on(table.paymentIntentId),
    index("trip_pass_stripe_events_claim_idx").on(table.claimToken, table.claimExpiresAt),
    check(
      "trip_pass_stripe_events_schema_version_check",
      sql`${table.normalizedSchemaVersion} > 0`,
    ),
    check(
      "trip_pass_stripe_events_status_check",
      sql`${table.status} in ('pending', 'applied', 'blocked')`,
    ),
    check("trip_pass_stripe_events_attempt_count_check", sql`${table.attemptCount} >= 0`),
    check(
      "trip_pass_stripe_events_alert_state_check",
      sql`${table.alertState} in ('none', 'watch', 'page')`,
    ),
    check(
      "trip_pass_stripe_events_product_version_check",
      sql`${table.productVersion} is null or ${table.productVersion} > 0`,
    ),
    check(
      "trip_pass_stripe_events_amount_total_minor_check",
      sql`${table.amountTotalMinor} is null or ${table.amountTotalMinor} >= 0`,
    ),
    check(
      "trip_pass_stripe_events_currency_check",
      sql`${table.currency} is null or ${table.currency} ~ '^[a-z]{3}$'`,
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

export const operationalReconciliationRuns = pgTable(
  "operational_reconciliation_runs",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    status: text("status").notNull().default("running"),
    checkedCount: integer("checked_count").notNull().default(0),
    findingCount: integer("finding_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check(
      "operational_reconciliation_runs_source_check",
      sql`${table.source} in ('cli', 'authenticated_adapter', 'worker')`,
    ),
    check(
      "operational_reconciliation_runs_status_check",
      sql`${table.status} in ('running', 'succeeded', 'failed')`,
    ),
    check(
      "operational_reconciliation_runs_counts_check",
      sql`${table.checkedCount} >= 0 and ${table.findingCount} >= 0`,
    ),
    check(
      "operational_reconciliation_runs_completed_check",
      sql`(${table.status} = 'running' and ${table.completedAt} is null) or (${table.status} <> 'running' and ${table.completedAt} is not null)`,
    ),
  ],
);

export const operationalReconciliationObservations = pgTable(
  "operational_reconciliation_observations",
  {
    localEntityType: text("local_entity_type").notNull(),
    localEntityRef: text("local_entity_ref").notNull(),
    lastAppliedSequence: bigint("last_applied_sequence", { mode: "bigint" }).notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.localEntityType, table.localEntityRef] }),
    check(
      "operational_reconciliation_observations_entity_type_check",
      sql`${table.localEntityType} = 'trip_pass_order'`,
    ),
    check(
      "operational_reconciliation_observations_sequence_check",
      sql`${table.lastAppliedSequence} > 0`,
    ),
  ],
);

export const operationalFindings = pgTable(
  "operational_findings",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => operationalReconciliationRuns.id),
    kind: text("kind").notNull(),
    impact: text("impact").notNull(),
    status: text("status").notNull().default("open"),
    localEntityType: text("local_entity_type").notNull(),
    localEntityRef: text("local_entity_ref").notNull(),
    summaryCode: text("summary_code").notNull(),
    incidentKey: text("incident_key").notNull(),
    lifecycle: integer("lifecycle").notNull().default(1),
    lastObservationSequence: bigint("last_observation_sequence", { mode: "bigint" }),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    lastDetectedAt: timestamp("last_detected_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("operational_findings_open_idx").on(
      table.status,
      table.impact,
      table.detectedAt,
      table.id,
    ),
    index("operational_findings_run_id_idx").on(table.runId),
    uniqueIndex("operational_findings_incident_key_key").on(table.incidentKey),
    uniqueIndex("operational_findings_run_entity_key").on(
      table.runId,
      table.kind,
      table.localEntityType,
      table.localEntityRef,
    ),
    check(
      "operational_findings_kind_check",
      sql`${table.kind} in ('paid_without_pass', 'access_without_payment', 'payment_state_mismatch', 'pending_payment_stale', 'missing_usage_meters', 'stale_usage_reservation', 'redis_unavailable', 'privacy_cleanup_failed', 'provider_application_failed')`,
    ),
    check("operational_findings_impact_check", sql`${table.impact} in ('warning', 'high')`),
    check("operational_findings_status_check", sql`${table.status} in ('open', 'resolved')`),
    check("operational_findings_lifecycle_check", sql`${table.lifecycle} >= 1`),
    check(
      "operational_findings_observation_sequence_check",
      sql`${table.lastObservationSequence} is null or ${table.lastObservationSequence} > 0`,
    ),
    check(
      "operational_findings_entity_type_check",
      sql`${table.localEntityType} in ('trip_pass_order', 'trip_pass', 'closure_operation', 'service')`,
    ),
    check(
      "operational_findings_resolution_check",
      sql`(${table.status} = 'open' and ${table.resolvedAt} is null) or (${table.status} = 'resolved' and ${table.resolvedAt} is not null)`,
    ),
  ],
);

export const operatorRepairActions = pgTable(
  "operator_repair_actions",
  {
    id: text("id").primaryKey(),
    findingId: text("finding_id")
      .notNull()
      .references(() => operationalFindings.id),
    operatorAccountId: text("operator_account_id").notNull(),
    idempotencyKeyHash: text("idempotency_key_hash").notNull(),
    commandHash: text("command_hash").notNull(),
    actionType: text("action_type").notNull(),
    reasonCode: text("reason_code").notNull(),
    beforeState: jsonb("before_state").$type<Record<string, unknown>>().notNull(),
    afterState: jsonb("after_state").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("operator_repair_actions_idempotency_key").on(
      table.operatorAccountId,
      table.idempotencyKeyHash,
    ),
    index("operator_repair_actions_finding_id_idx").on(table.findingId),
    check(
      "operator_repair_actions_action_check",
      sql`${table.actionType} in ('grant_missing_trip_pass', 'initialize_missing_meters', 'release_stale_reservation', 'manual_commerce_transition', 'goodwill_grant', 'account_recovery')`,
    ),
  ],
);

export const operationalAlertDeliveries = pgTable(
  "operational_alert_deliveries",
  {
    id: text("id").primaryKey(),
    alertKey: text("alert_key").notNull().unique(),
    findingId: text("finding_id").references(() => operationalFindings.id),
    impact: text("impact").notNull(),
    destination: text("destination").notNull(),
    status: text("status").notNull(),
    deliveryToken: text("delivery_token").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  },
  (table) => [
    index("operational_alert_deliveries_finding_id_idx").on(table.findingId),
    index("operational_alert_deliveries_lease_idx").on(
      table.status,
      table.leaseExpiresAt,
      table.alertKey,
    ),
    check("operational_alert_deliveries_impact_check", sql`${table.impact} in ('warning', 'high')`),
    check(
      "operational_alert_deliveries_destination_check",
      sql`${table.destination} in ('sentry')`,
    ),
    check(
      "operational_alert_deliveries_status_check",
      sql`${table.status} in ('sending', 'sent', 'failed')`,
    ),
    check(
      "operational_alert_deliveries_lease_check",
      sql`(${table.status} = 'sending' and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'sending' and ${table.leaseExpiresAt} is null)`,
    ),
  ],
);

export const operationalWorkerTasks = pgTable(
  "operational_worker_tasks",
  {
    id: text("id").primaryKey(),
    taskType: text("task_type").notNull(),
    resourceRef: text("resource_ref").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: text("lease_token"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("operational_worker_tasks_resource_key").on(table.taskType, table.resourceRef),
    index("operational_worker_tasks_due_idx").on(
      table.status,
      table.nextAttemptAt,
      table.leaseExpiresAt,
      table.id,
    ),
    check(
      "operational_worker_tasks_type_check",
      sql`${table.taskType} in ('account_closure', 'pending_payment_event', 'pending_stripe_event', 'paid_after_closure_refund', 'retention_purge', 'commerce_reconciliation')`,
    ),
    check(
      "operational_worker_tasks_status_check",
      sql`${table.status} in ('pending', 'running', 'succeeded')`,
    ),
    check("operational_worker_tasks_attempts_check", sql`${table.attempts} >= 0`),
    check(
      "operational_worker_tasks_lease_check",
      sql`(${table.status} = 'running' and ${table.leaseToken} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'running' and ${table.leaseToken} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "operational_worker_tasks_completed_check",
      sql`(${table.status} = 'succeeded' and ${table.completedAt} is not null) or (${table.status} <> 'succeeded' and ${table.completedAt} is null)`,
    ),
  ],
);

export const operationalScheduleStates = pgTable(
  "operational_schedule_states",
  {
    scheduleKey: text("schedule_key").primaryKey(),
    scheduleMinutes: integer("schedule_minutes").notNull(),
    graceMinutes: integer("grace_minutes").notNull(),
    status: text("status").notNull().default("observing"),
    lifecycle: bigint("lifecycle", { mode: "number" }).notNull().default(0),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    monitoringStartedAt: timestamp("monitoring_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastStartedAt: timestamp("last_started_at", { withTimezone: true }),
    lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    lastErrorCode: text("last_error_code"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("operational_schedule_states_status_idx").on(
      table.status,
      table.updatedAt,
      table.scheduleKey,
    ),
    check(
      "operational_schedule_states_key_check",
      sql`${table.scheduleKey} in ('weather', 'marine', 'places_prune')`,
    ),
    check(
      "operational_schedule_states_schedule_check",
      sql`${table.scheduleMinutes} > 0 and ${table.scheduleMinutes} <= 10080`,
    ),
    check(
      "operational_schedule_states_grace_check",
      sql`${table.graceMinutes} >= 0 and ${table.graceMinutes} <= 1440`,
    ),
    check(
      "operational_schedule_states_status_check",
      sql`${table.status} in ('observing', 'healthy', 'failed', 'stale')`,
    ),
    check("operational_schedule_states_lifecycle_check", sql`${table.lifecycle} >= 0`),
    check("operational_schedule_states_failures_check", sql`${table.consecutiveFailures} >= 0`),
    check(
      "operational_schedule_states_error_check",
      sql`${table.lastErrorCode} is null or ${table.lastErrorCode} ~ '^[a-z][a-z0-9_]{2,63}$'`,
    ),
    check(
      "operational_schedule_states_failure_state_check",
      sql`(${table.status} = 'failed' and ${table.consecutiveFailures} > 0 and ${table.lastFailedAt} is not null) or (${table.status} <> 'failed')`,
    ),
  ],
);

export const operationalReconciliationRunsRelations = relations(
  operationalReconciliationRuns,
  ({ many }) => ({ findings: many(operationalFindings) }),
);

export const operationalFindingsRelations = relations(operationalFindings, ({ many, one }) => ({
  alerts: many(operationalAlertDeliveries),
  repairActions: many(operatorRepairActions),
  run: one(operationalReconciliationRuns, {
    fields: [operationalFindings.runId],
    references: [operationalReconciliationRuns.id],
  }),
}));

export const operatorRepairActionsRelations = relations(operatorRepairActions, ({ one }) => ({
  finding: one(operationalFindings, {
    fields: [operatorRepairActions.findingId],
    references: [operationalFindings.id],
  }),
}));

export const operationalAlertDeliveriesRelations = relations(
  operationalAlertDeliveries,
  ({ one }) => ({
    finding: one(operationalFindings, {
      fields: [operationalAlertDeliveries.findingId],
      references: [operationalFindings.id],
    }),
  }),
);

export type OperationalReconciliationRun = typeof operationalReconciliationRuns.$inferSelect;
export type NewOperationalReconciliationRun = typeof operationalReconciliationRuns.$inferInsert;
export type OperationalReconciliationObservation =
  typeof operationalReconciliationObservations.$inferSelect;
export type NewOperationalReconciliationObservation =
  typeof operationalReconciliationObservations.$inferInsert;
export type OperationalFinding = typeof operationalFindings.$inferSelect;
export type NewOperationalFinding = typeof operationalFindings.$inferInsert;
export type OperatorRepairAction = typeof operatorRepairActions.$inferSelect;
export type NewOperatorRepairAction = typeof operatorRepairActions.$inferInsert;
export type OperationalAlertDelivery = typeof operationalAlertDeliveries.$inferSelect;
export type NewOperationalAlertDelivery = typeof operationalAlertDeliveries.$inferInsert;
export type OperationalWorkerTask = typeof operationalWorkerTasks.$inferSelect;
export type NewOperationalWorkerTask = typeof operationalWorkerTasks.$inferInsert;
export type OperationalScheduleState = typeof operationalScheduleStates.$inferSelect;
export type NewOperationalScheduleState = typeof operationalScheduleStates.$inferInsert;

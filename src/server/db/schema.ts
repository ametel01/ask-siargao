import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  freshnessWindowDays: integer("freshness_window_days").notNull(),
  authorityLevel: integer("authority_level").notNull(),
  storesRawAllowed: boolean("stores_raw_allowed").notNull().default(false),
  publishesRawAllowed: boolean("publishes_raw_allowed").notNull().default(false),
  requiresPartnerApproval: boolean("requires_partner_approval").notNull().default(false),
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
  amountUsd: numeric("amount_usd").notNull(),
  status: text("status").notNull(),
  webhookVerifiedAt: timestamp("webhook_verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
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

export const reviewerResults = pgTable("reviewer_results", {
  id: text("id").primaryKey(),
  auditRunId: text("audit_run_id").references(() => auditRuns.id),
  llmRunId: text("llm_run_id").references(() => llmRuns.id),
  verdict: text("verdict").notNull(),
  corrections: jsonb("corrections").$type<string[]>().notNull().default([]),
  blockedReasons: jsonb("blocked_reasons").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

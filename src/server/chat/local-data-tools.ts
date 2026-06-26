import { z } from "zod";

import type { AnswerTrustLabel } from "@/server/chat/answer-source-summary";

export const localFactsDefaultLimit = 10;
export const localFactsMaxLimit = 20;
export const sourceEvidenceMaxFactIds = 20;

export type LocalDataSurfaceName =
  | "areas"
  | "routes"
  | "curated_local_guide"
  | "public_entities"
  | "governed_facts"
  | "source_evidence";

export type LocalFactEntityType =
  | "area"
  | "route"
  | "beach"
  | "service"
  | "place"
  | "accommodation"
  | "operator"
  | "risk"
  | "local_caveat";

export type LocalFactConfidence = "high" | "medium" | "low";

export type DatabaseSchemaFieldDescription = {
  name: string;
  type: "string" | "string[]" | "number" | "boolean" | "timestamp" | "object";
  description: string;
  required: boolean;
};

export type DatabaseSchemaSurfaceDescription = {
  name: LocalDataSurfaceName;
  description: string;
  fields: readonly DatabaseSchemaFieldDescription[];
  queryExamples: readonly LocalFactsQuery[];
};

export type DatabaseSchemaToolResult = {
  publicViews: readonly DatabaseSchemaSurfaceDescription[];
  queryRules: readonly string[];
  defaultLimit: number;
  maxLimit: number;
};

export type LocalFactsQuery = {
  entityTypes: readonly LocalFactEntityType[];
  area?: string;
  tags?: readonly string[];
  text?: string;
  limit: number;
};

export type LocalFactSourceMetadata = {
  label: AnswerTrustLabel;
  sourceName: string;
  sourceProfileId?: string;
  fetchedAt?: string;
  verifiedAt?: string;
  expiresAt?: string;
};

export type LocalFactResultItem = {
  id: string;
  entityType: LocalFactEntityType;
  name: string;
  area?: string;
  tags: readonly string[];
  claim: string;
  confidence: LocalFactConfidence;
  source: LocalFactSourceMetadata;
  caveats: readonly string[];
};

export type SourceEvidenceResultItem = {
  factId: string;
  sourceName: string;
  sourceLabel: AnswerTrustLabel;
  sourceProfileId?: string;
  confidence: LocalFactConfidence;
  fetchedAt?: string;
  verifiedAt?: string;
  expiresAt?: string;
  citationUrl?: string;
  citationText?: string;
  caveats: readonly string[];
  checked: readonly string[];
  notChecked: readonly string[];
};

export type SourceEvidenceLookupQuery = {
  factIds: readonly string[];
};

const localFactEntityTypes = [
  "area",
  "route",
  "beach",
  "service",
  "place",
  "accommodation",
  "operator",
  "risk",
  "local_caveat",
] as const satisfies readonly LocalFactEntityType[];

const normalizedStringSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((value) => value.toLowerCase());

const localFactEntityTypeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(localFactEntityTypes),
);

export const describeDatabaseSchemaArgumentsSchema = z.object({}).strict();

export const localFactsQuerySchema: z.ZodType<LocalFactsQuery> = z
  .object({
    entityTypes: z.array(localFactEntityTypeSchema).min(1).max(localFactEntityTypes.length),
    area: normalizedStringSchema.optional(),
    tags: z.array(normalizedStringSchema).min(1).max(12).optional(),
    text: z.string().trim().min(2).max(240).optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .default(localFactsDefaultLimit)
      .transform((value) => Math.min(value, localFactsMaxLimit)),
  })
  .strict();

export const sourceEvidenceArgumentsSchema: z.ZodType<SourceEvidenceLookupQuery> = z
  .object({
    factIds: z
      .array(
        z
          .string()
          .trim()
          .min(3)
          .max(160)
          .regex(/^[A-Za-z0-9_.:-]+$/),
      )
      .min(1)
      .max(sourceEvidenceMaxFactIds),
  })
  .strict();

export const databaseSchemaToolResult: DatabaseSchemaToolResult = {
  defaultLimit: localFactsDefaultLimit,
  maxLimit: localFactsMaxLimit,
  queryRules: [
    "Use structured filters only: entityTypes, area, tags, text, and limit.",
    "Do not accept table names, joins, columns, free-form predicates, or SQL-like expressions.",
    "Return only approved fields from the publicViews dictionary.",
    "Apply the default row limit unless the caller provides a smaller or capped limit.",
    "Exclude account, audit, payment, report, job, and model-run internals.",
    "Exclude restricted provider bodies, snapshots, and Google review content.",
    "Every returned fact must include source and confidence metadata plus checked boundaries.",
  ],
  publicViews: [
    {
      name: "areas",
      description:
        "Public Siargao area records suitable for location grounding, municipality context, and broad travel caveats.",
      fields: [
        field("id", "string", "Stable public area identifier.", true),
        field("name", "string", "Human-readable area name.", true),
        field("municipality", "string", "Municipality or local government area.", true),
        field("description", "string", "Short public description.", true),
        field("latitude", "number", "Optional approximate latitude.", false),
        field("longitude", "number", "Optional approximate longitude.", false),
      ],
      queryExamples: [
        { entityTypes: ["area"], area: "general luna", tags: ["orientation"], limit: 5 },
      ],
    },
    {
      name: "routes",
      description:
        "Public route records for travel between known Siargao areas with transport modes and practical caveats.",
      fields: [
        field("id", "string", "Stable route identifier.", true),
        field("name", "string", "Human-readable route label.", true),
        field("origin", "string", "Starting area label.", true),
        field("destination", "string", "Destination area label.", true),
        field("transportModes", "string[]", "Supported local transport modes.", true),
        field("riskNotes", "string[]", "Public travel caveats for the route.", true),
      ],
      queryExamples: [
        { entityTypes: ["route"], area: "general luna", tags: ["transport"], limit: 5 },
      ],
    },
    {
      name: "curated_local_guide",
      description:
        "Ask Siargao curated guide facts for beaches, ride-time estimates, trip fit, and local caveats.",
      fields: [
        field("id", "string", "Stable curated fact identifier.", true),
        field("entityType", "string", "Approved entity type such as beach or local_caveat.", true),
        field("name", "string", "Beach, place, route, or caveat label.", true),
        field("area", "string", "Relevant Siargao area when known.", false),
        field("tags", "string[]", "Searchable fit tags such as sandy, swimming, or sunset.", true),
        field("claim", "string", "Single model-facing local fact.", true),
        field("confidence", "string", "High, medium, or low confidence label.", true),
        field("source", "object", "Curated source label and metadata.", true),
        field("caveats", "string[]", "Checked and not-checked boundaries.", true),
      ],
      queryExamples: [
        { entityTypes: ["beach"], area: "general luna", tags: ["sandy", "swimming"], limit: 5 },
      ],
    },
    {
      name: "public_entities",
      description:
        "Display-safe entity records for public accommodations, operators, services, places, and known local objects.",
      fields: [
        field("id", "string", "Stable public entity identifier.", true),
        field("entityType", "string", "Approved public entity type.", true),
        field("name", "string", "Display-safe entity name.", true),
        field("area", "string", "Linked public area label when known.", false),
        field("aliases", "string[]", "Display-safe alternative names.", true),
        field("confidence", "string", "Entity confidence label.", true),
      ],
      queryExamples: [{ entityTypes: ["service", "operator"], area: "general luna", limit: 10 }],
    },
    {
      name: "governed_facts",
      description:
        "Fact-graph claims that passed source governance and can be exposed to the chat agent as shaped facts.",
      fields: [
        field("id", "string", "Stable governed fact identifier.", true),
        field("entityType", "string", "Approved fact entity type.", true),
        field("name", "string", "Entity or fact label.", true),
        field("claim", "string", "Single governed claim.", true),
        field("confidence", "string", "Governed confidence label.", true),
        field("sourceProfileId", "string", "Source profile ID when policy allows display.", false),
        field("source", "object", "Source label, freshness, and checked boundaries.", true),
      ],
      queryExamples: [{ entityTypes: ["accommodation", "risk"], text: "generator", limit: 10 }],
    },
    {
      name: "source_evidence",
      description:
        "Display-safe evidence metadata for fact IDs returned by approved local fact queries.",
      fields: [
        field("factId", "string", "Fact identifier requested by the agent.", true),
        field("sourceName", "string", "Display-safe source name.", true),
        field(
          "sourceLabel",
          "string",
          "Trust label such as curated_local_guide or fresh_cache.",
          true,
        ),
        field("sourceProfileId", "string", "Source profile ID when policy allows display.", false),
        field("confidence", "string", "Evidence confidence label.", true),
        field("fetchedAt", "timestamp", "Fetch timestamp when available.", false),
        field("verifiedAt", "timestamp", "Verification timestamp when available.", false),
        field("expiresAt", "timestamp", "Freshness or retention boundary when available.", false),
        field("citationUrl", "string", "Citation URL only when display policy allows it.", false),
        field("citationText", "string", "Short citation text only when policy allows it.", false),
        field("caveats", "string[]", "Provider, freshness, and source-policy caveats.", true),
      ],
      queryExamples: [{ entityTypes: ["beach"], tags: ["source-evidence"], limit: 5 }],
    },
  ],
};

export function describeDatabaseSchema(): DatabaseSchemaToolResult {
  return databaseSchemaToolResult;
}

function field(
  name: string,
  type: DatabaseSchemaFieldDescription["type"],
  description: string,
  required: boolean,
): DatabaseSchemaFieldDescription {
  return { name, type, description, required };
}

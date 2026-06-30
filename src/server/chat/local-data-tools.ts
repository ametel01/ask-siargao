import { z } from "zod";

import type { AnswerTrustLabel } from "@/server/chat/answer-source-summary";
import { searchSiargaoLocalGuide } from "@/server/local/siargao-beaches";

const localFactsDefaultLimit = 10;
export const localFactsMaxLimit = 20;
const sourceEvidenceMaxFactIds = 20;

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

export type LocalFactsToolResult = {
  query: LocalFactsQuery;
  facts: readonly LocalFactResultItem[];
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

export type SourceEvidenceToolResult = {
  factIds: readonly string[];
  evidence: readonly SourceEvidenceResultItem[];
  missingFactIds: readonly string[];
  caveats: readonly string[];
};

export type LocalFactsDatabaseRow = Record<string, unknown>;

export type LocalFactsQueryRunner = (
  query: TemplateStringsArray,
  ...params: unknown[]
) => PromiseLike<LocalFactsDatabaseRow[]>;

export type QueryLocalFactsOptions = {
  queryRunner?: LocalFactsQueryRunner;
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
const optionalNullable = <Schema extends z.ZodTypeAny>(schema: Schema) =>
  z.preprocess((value) => (value === null ? undefined : value), schema.optional());

const localFactEntityTypeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(localFactEntityTypes),
);

export const describeDatabaseSchemaArgumentsSchema = z.strictObject({});

export const localFactsQuerySchema: z.ZodType<LocalFactsQuery> = z.strictObject({
  entityTypes: z.array(localFactEntityTypeSchema).min(1).max(localFactEntityTypes.length),
  area: optionalNullable(normalizedStringSchema),
  tags: optionalNullable(z.array(normalizedStringSchema).min(1).max(12)),
  text: optionalNullable(z.string().trim().min(2).max(240)),
  limit: z.preprocess(
    (value) => (value === null ? undefined : value),
    z
      .number()
      .int()
      .min(1)
      .default(localFactsDefaultLimit)
      .transform((value) => Math.min(value, localFactsMaxLimit)),
  ),
});

export const sourceEvidenceArgumentsSchema: z.ZodType<SourceEvidenceLookupQuery> = z.strictObject({
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
});

const databaseSchemaToolResult: DatabaseSchemaToolResult = {
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

export async function queryLocalFacts(
  input: unknown,
  options: QueryLocalFactsOptions = {},
): Promise<LocalFactsToolResult> {
  const query = localFactsQuerySchema.parse(input);
  const facts = [
    ...queryCuratedGuideFacts(query),
    ...(options.queryRunner ? await queryDatabaseFacts(query, options.queryRunner) : []),
  ]
    .filter((fact) => localFactMatchesQuery(fact, query))
    .slice(0, query.limit);

  return {
    query,
    facts,
    caveats: [
      "Local facts are returned through approved serializers, not raw database rows.",
      "Structured local fact queries do not perform live tide, surf, road, opening-hour, booking, or safety checks.",
    ],
  };
}

export async function getSourceEvidence(
  input: unknown,
  options: QueryLocalFactsOptions = {},
): Promise<SourceEvidenceToolResult> {
  const query = sourceEvidenceArgumentsSchema.parse(input);
  const curatedFactsById = curatedGuideFactsById();
  const curatedEvidence = query.factIds.flatMap((factId) => {
    if (!factId.startsWith("curated_local_guide:")) {
      return [];
    }
    const fact = curatedFactsById.get(factId);
    return isLocalFactResultItem(fact) ? [curatedFactToEvidence(fact)] : [];
  });
  const databaseEvidence = options.queryRunner
    ? await queryDatabaseEvidence(
        query.factIds.filter((factId) => !factId.startsWith("curated_local_guide:")),
        options.queryRunner,
      )
    : [];
  const evidence = [...curatedEvidence, ...databaseEvidence];
  const foundFactIds = new Set(evidence.map((item) => item.factId));

  return {
    factIds: query.factIds,
    evidence,
    missingFactIds: query.factIds.filter((factId) => !foundFactIds.has(factId)),
    caveats: [
      "Source evidence lookup returns display-safe metadata only.",
      "Restricted provider bodies, Google review content, private records, and internal model traces are omitted.",
    ],
  };
}

function field(
  name: string,
  type: DatabaseSchemaFieldDescription["type"],
  description: string,
  required: boolean,
): DatabaseSchemaFieldDescription {
  return { name, type, description, required };
}

function curatedGuideFactsById() {
  return new Map(
    queryCuratedGuideFacts({ entityTypes: ["beach"], limit: localFactsMaxLimit }).map((fact) => [
      fact.id,
      fact,
    ]),
  );
}

function curatedFactToEvidence(fact: LocalFactResultItem): SourceEvidenceResultItem {
  return {
    factId: fact.id,
    sourceName: "Ask Siargao curated local beach guide",
    sourceLabel: "curated_local_guide",
    confidence: fact.confidence,
    caveats: [
      "Curated local guide estimate; exact conditions can change by tide, weather, road access, and site conditions.",
    ],
    checked: ["curated beach fit notes", "estimated ride-time notes"],
    notChecked: [
      "live tide",
      "currents",
      "road conditions",
      "access changes",
      "lifeguard or swimming safety",
    ],
  };
}

async function queryDatabaseEvidence(
  factIds: readonly string[],
  queryRunner: LocalFactsQueryRunner,
): Promise<SourceEvidenceResultItem[]> {
  if (factIds.length === 0) {
    return [];
  }

  const rows = await queryRunner`
    select
      f.id as fact_id,
      f.public_republish_allowed as fact_public_republish_allowed,
      f.confidence_label,
      f.source_profile_id,
      f.fetched_at,
      f.verified_at,
      f.expires_at,
      sp.source_name,
      sp.allowed_use as source_allowed_use,
      ev.label as evidence_label,
      ev.citation_url,
      ev.citation_text,
      ev.allowed_use as evidence_allowed_use,
      ev.public_republish_allowed
    from facts f
    left join source_profiles sp on sp.id = f.source_profile_id
    left join evidence ev on ev.fact_id = f.id
      and (
        ev.public_republish_allowed = true
        or ev.allowed_use in ('public_republish', 'citation_only')
      )
    where f.id = any(${factIds})
      and f.public_republish_allowed = true
      and (f.expires_at is null or f.expires_at > now())
      and (
        sp.id is null
        or sp.allowed_use in ('public_republish', 'citation_only')
      )
    order by f.id, ev.created_at`;

  return rows.flatMap((row) => {
    const evidence = evidenceRowToSourceEvidence(row);
    return isSourceEvidenceResultItem(evidence) ? [evidence] : [];
  });
}

function evidenceRowToSourceEvidence(
  row: LocalFactsDatabaseRow,
): SourceEvidenceResultItem | undefined {
  const factId = readString(row.fact_id);
  const sourceName = readString(row.source_name) ?? "Governed local fact source";
  const confidence = readConfidence(row.confidence_label);
  if (!factId || !confidence) {
    return undefined;
  }

  const sourceAllowedUse = readString(row.source_allowed_use);
  const evidenceAllowedUse = readString(row.evidence_allowed_use);
  if (!isDisplaySafeEvidenceRow({ evidenceAllowedUse, row, sourceAllowedUse })) {
    return undefined;
  }

  const sourceProfileId = readString(row.source_profile_id);
  const fetchedAt = readDateString(row.fetched_at);
  const verifiedAt = readDateString(row.verified_at);
  const expiresAt = readDateString(row.expires_at);
  if (isExpiredDateString(expiresAt)) {
    return undefined;
  }

  const citationDisplayAllowed = canDisplayCitation({
    evidenceAllowedUse,
    publicRepublishAllowed: Boolean(row.public_republish_allowed),
    sourceAllowedUse,
  });
  const providerCaveats = sourceEvidenceCaveats({
    sourceName,
    sourceProfileId,
    sourceAllowedUse,
  });

  return {
    factId,
    sourceName,
    sourceLabel: sourceLabelFromAllowedUse(sourceAllowedUse),
    ...(sourceProfileId ? { sourceProfileId } : {}),
    confidence,
    ...(fetchedAt ? { fetchedAt } : {}),
    ...(verifiedAt ? { verifiedAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(citationDisplayAllowed ? optionalCitationFields(row) : {}),
    caveats: providerCaveats,
    checked: uniqueCompact([
      readString(row.evidence_label) ?? "governed fact evidence",
      fetchedAt ? "source fetch timestamp" : undefined,
      verifiedAt ? "verification timestamp" : undefined,
      expiresAt ? "freshness boundary" : undefined,
    ]),
    notChecked: sourceEvidenceNotChecked({ sourceName, sourceProfileId }),
  };
}

function queryCuratedGuideFacts(query: LocalFactsQuery): LocalFactResultItem[] {
  if (!query.entityTypes.some((entityType) => entityType === "beach" || entityType === "place")) {
    return [];
  }

  const searchResult = searchSiargaoLocalGuide({
    query: query.text ?? [...(query.tags ?? []), query.area ?? "Siargao beaches"].join(" "),
    filters: {
      beachSurface: query.tags?.includes("sandy") ? "sand" : "any",
      maxRideMinutes: query.area ? 30 : 180,
      ...(query.area ? { originArea: query.area } : {}),
      rainFit: query.tags?.includes("rain-fit"),
      sunset: query.tags?.includes("sunset"),
      swimming: query.tags?.includes("swimming"),
    },
  });

  return searchResult.candidates.map((candidate) => {
    const tags = uniqueCompact([
      "beach",
      candidate.surface,
      candidate.surface === "sand" ? "sandy" : undefined,
      tagFromText(candidate.area),
      candidateHasFit(candidate, ["swim", "calm water"]) ? "swimming" : undefined,
      candidateHasFit(candidate, ["sunset", "late afternoon"]) ? "sunset" : undefined,
      candidateHasFit(candidate, ["rain", "bad weather"]) ? "rain-fit" : undefined,
      ...candidate.fitReasons.flatMap(tagsFromText),
      ...tagsFromText(candidate.bestFor),
    ]);
    const claim = `${candidate.bestFor}. ${candidate.fitReasons.join(" ")}`;

    return {
      id: `curated_local_guide:beach:${slugify(candidate.name)}`,
      entityType: "beach",
      name: candidate.name,
      area: candidate.area,
      tags,
      claim,
      confidence: candidate.confidence,
      source: {
        label: "curated_local_guide",
        sourceName: "Ask Siargao curated local beach guide",
      },
      caveats: candidate.caveats,
    };
  });
}

async function queryDatabaseFacts(
  query: LocalFactsQuery,
  queryRunner: LocalFactsQueryRunner,
): Promise<LocalFactResultItem[]> {
  const facts: LocalFactResultItem[] = [];
  const pattern = databasePrefilterPattern(query);
  const rowLimit = Math.min(query.limit * 5, localFactsMaxLimit);

  if (query.entityTypes.includes("area")) {
    const areaRows = await queryRunner`
      select id, name, municipality, description
      from areas
      where ${pattern} = '%%'
        or lower(name || ' ' || municipality || ' ' || description) like lower(${pattern})
      order by name
      limit ${rowLimit}`;
    facts.push(
      ...areaRows.flatMap((row) => {
        const fact = areaRowToLocalFact(row);
        return isLocalFactResultItem(fact) ? [fact] : [];
      }),
    );
  }

  if (query.entityTypes.includes("route")) {
    const routeRows = await queryRunner`
      select id, name, origin, destination, transport_modes, risk_notes
      from routes
      where ${pattern} = '%%'
        or lower(name || ' ' || origin || ' ' || destination) like lower(${pattern})
      order by name
      limit ${rowLimit}`;
    facts.push(
      ...routeRows.flatMap((row) => {
        const fact = routeRowToLocalFact(row);
        return isLocalFactResultItem(fact) ? [fact] : [];
      }),
    );
  }

  const publicEntityTypes = query.entityTypes.filter(
    (entityType) => entityType !== "area" && entityType !== "route" && entityType !== "beach",
  );
  if (publicEntityTypes.length > 0) {
    const entityRows = await queryRunner`
      select e.id, e.entity_type, e.name, e.aliases, e.confidence_label, a.name as area
      from entities e
      left join areas a on a.id = e.area_id
      where e.public_visibility = 'public'
        and e.entity_type = any(${publicEntityTypes})
        and (
          ${pattern} = '%%'
          or lower(e.name || ' ' || coalesce(a.name, '') || ' ' || coalesce(e.aliases::text, '')) like lower(${pattern})
        )
      order by e.name
      limit ${rowLimit}`;
    facts.push(
      ...entityRows.flatMap((row) => {
        const fact = publicEntityRowToLocalFact(row);
        return isLocalFactResultItem(fact) ? [fact] : [];
      }),
    );
  }

  const factEntityTypes = query.entityTypes.filter(
    (entityType) => entityType !== "area" && entityType !== "route",
  );
  if (factEntityTypes.length > 0) {
    const factRows = await queryRunner`
      select
        f.id,
        coalesce(e.entity_type, f.fact_type) as entity_type,
        coalesce(e.name, f.fact_type) as name,
        a.name as area,
        f.claim,
        f.fact_type,
        f.confidence_label,
        f.source_profile_id,
        sp.source_name,
        sp.allowed_use,
        f.fetched_at,
        f.verified_at,
        f.expires_at
      from facts f
      left join entities e on e.id = f.entity_id
      left join areas a on a.id = e.area_id
      left join source_profiles sp on sp.id = f.source_profile_id
      where f.public_republish_allowed = true
        and coalesce(e.entity_type, f.fact_type) = any(${factEntityTypes})
        and (sp.id is null or sp.allowed_use in ('public_republish', 'citation_only'))
        and (f.expires_at is null or f.expires_at > now())
        and (
          ${pattern} = '%%'
          or lower(coalesce(e.name, '') || ' ' || coalesce(a.name, '') || ' ' || f.claim || ' ' || f.fact_type) like lower(${pattern})
        )
      order by f.fetched_at desc, f.id
      limit ${rowLimit}`;
    facts.push(
      ...factRows.flatMap((row) => {
        const fact = governedFactRowToLocalFact(row);
        return isLocalFactResultItem(fact) ? [fact] : [];
      }),
    );
  }

  return facts;
}

function areaRowToLocalFact(row: LocalFactsDatabaseRow): LocalFactResultItem | undefined {
  const id = readString(row.id);
  const name = readString(row.name);
  const municipality = readString(row.municipality);
  const description = readString(row.description);
  if (!id || !name || !municipality || !description) {
    return undefined;
  }

  return {
    id: `area:${id}`,
    entityType: "area",
    name,
    area: municipality,
    tags: uniqueCompact(["area", tagFromText(name), tagFromText(municipality), "orientation"]),
    claim: description,
    confidence: "medium",
    source: {
      label: "curated_local_guide",
      sourceName: "Ask Siargao baseline area taxonomy",
    },
    caveats: ["Area taxonomy is local context, not a live transport, weather, or safety check."],
  };
}

function routeRowToLocalFact(row: LocalFactsDatabaseRow): LocalFactResultItem | undefined {
  const id = readString(row.id);
  const name = readString(row.name);
  const origin = readString(row.origin);
  const destination = readString(row.destination);
  if (!id || !name || !origin || !destination) {
    return undefined;
  }
  const transportModes = readStringArray(row.transport_modes);
  const riskNotes = readStringArray(row.risk_notes);

  return {
    id: `route:${id}`,
    entityType: "route",
    name,
    area: `${origin} to ${destination}`,
    tags: uniqueCompact(["route", "transport", ...transportModes.map(tagFromText)]),
    claim: `${name} connects ${origin} to ${destination}${
      transportModes.length ? ` by ${transportModes.join(", ")}` : ""
    }.`,
    confidence: "medium",
    source: {
      label: "curated_local_guide",
      sourceName: "Ask Siargao baseline route taxonomy",
    },
    caveats: [
      ...riskNotes,
      "Route taxonomy is not a live ferry, road, traffic, weather, or schedule check.",
    ],
  };
}

function publicEntityRowToLocalFact(row: LocalFactsDatabaseRow): LocalFactResultItem | undefined {
  const id = readString(row.id);
  const entityType = readLocalFactEntityType(row.entity_type);
  const name = readString(row.name);
  const confidence = readConfidence(row.confidence_label);
  if (!id || !entityType || !name || !confidence) {
    return undefined;
  }

  const area = readString(row.area);
  const aliases = readStringArray(row.aliases);

  return {
    id: `public_entity:${id}`,
    entityType,
    name,
    ...(area ? { area } : {}),
    tags: uniqueCompact([entityType, area, ...aliases].flatMap((value) => tagsFromText(value))),
    claim: `${name} is a public ${entityType} entity${area ? ` in ${area}` : ""}.`,
    confidence,
    source: {
      label: "curated_local_guide",
      sourceName: "Ask Siargao public entity registry",
    },
    caveats: [
      "Public entity records identify known local entities; they do not verify live status, availability, ratings, or safety.",
    ],
  };
}

function governedFactRowToLocalFact(row: LocalFactsDatabaseRow): LocalFactResultItem | undefined {
  const id = readString(row.id);
  const entityType = readLocalFactEntityType(row.entity_type);
  const name = readString(row.name);
  const claim = readString(row.claim);
  const confidence = readConfidence(row.confidence_label);
  if (!id || !entityType || !name || !claim || !confidence) {
    return undefined;
  }

  const allowedUse = readString(row.allowed_use);
  if (allowedUse && !isDisplaySafeAllowedUse(allowedUse)) {
    return undefined;
  }

  const sourceProfileId = readString(row.source_profile_id);
  const sourceName = readString(row.source_name) ?? "Governed local fact source";
  const factType = readString(row.fact_type);
  const area = readString(row.area);
  const fetchedAt = readDateString(row.fetched_at);
  const verifiedAt = readDateString(row.verified_at);
  const expiresAt = readDateString(row.expires_at);
  if (isExpiredDateString(expiresAt)) {
    return undefined;
  }

  return {
    id,
    entityType,
    name,
    ...(area ? { area } : {}),
    tags: uniqueCompact([entityType, factType, area].flatMap((value) => tagsFromText(value))),
    claim,
    confidence,
    source: {
      label: sourceLabelFromAllowedUse(allowedUse),
      sourceName,
      ...(sourceProfileId ? { sourceProfileId } : {}),
      ...(fetchedAt ? { fetchedAt } : {}),
      ...(verifiedAt ? { verifiedAt } : {}),
      ...(expiresAt ? { expiresAt } : {}),
    },
    caveats: ["Governed fact output excludes restricted provider bodies and private records."],
  };
}

function localFactMatchesQuery(fact: LocalFactResultItem, query: LocalFactsQuery) {
  if (!query.entityTypes.includes(fact.entityType)) {
    return false;
  }

  if (
    query.area &&
    !containsNormalized(`${fact.area ?? ""} ${fact.name} ${fact.claim}`, query.area)
  ) {
    return false;
  }

  if (query.tags?.length && !query.tags.every((tag) => fact.tags.includes(tag))) {
    return false;
  }

  if (
    query.text &&
    !containsNormalized(`${fact.name} ${fact.area ?? ""} ${fact.claim}`, query.text)
  ) {
    return false;
  }

  return true;
}

function databasePrefilterPattern(query: LocalFactsQuery) {
  const searchableText = query.text ?? query.area;
  return searchableText ? `%${searchableText}%` : "%%";
}

function sourceLabelFromAllowedUse(allowedUse: string | undefined): AnswerTrustLabel {
  if (allowedUse === "public_republish") {
    return "fresh_cache";
  }
  if (allowedUse === "citation_only") {
    return "not_verified";
  }
  return "not_verified";
}

function canDisplayCitation({
  evidenceAllowedUse,
  publicRepublishAllowed,
  sourceAllowedUse,
}: {
  evidenceAllowedUse: string | undefined;
  publicRepublishAllowed: boolean;
  sourceAllowedUse: string | undefined;
}) {
  return (
    publicRepublishAllowed ||
    evidenceAllowedUse === "public_republish" ||
    evidenceAllowedUse === "citation_only" ||
    sourceAllowedUse === "public_republish" ||
    sourceAllowedUse === "citation_only"
  );
}

function isDisplaySafeEvidenceRow({
  evidenceAllowedUse,
  row,
  sourceAllowedUse,
}: {
  evidenceAllowedUse: string | undefined;
  row: LocalFactsDatabaseRow;
  sourceAllowedUse: string | undefined;
}) {
  if (row.fact_public_republish_allowed !== true) {
    return false;
  }
  if (sourceAllowedUse && !isDisplaySafeAllowedUse(sourceAllowedUse)) {
    return false;
  }

  const hasEvidenceMetadata = Boolean(
    readString(row.evidence_label) ||
      readString(row.citation_url) ||
      readString(row.citation_text) ||
      evidenceAllowedUse,
  );
  if (!hasEvidenceMetadata) {
    return true;
  }

  return Boolean(row.public_republish_allowed) || isDisplaySafeAllowedUse(evidenceAllowedUse);
}

function isDisplaySafeAllowedUse(allowedUse: string | undefined) {
  return allowedUse === "public_republish" || allowedUse === "citation_only";
}

function isExpiredDateString(dateString: string | undefined) {
  if (!dateString) {
    return false;
  }
  const timestamp = Date.parse(dateString);
  return Number.isFinite(timestamp) && timestamp <= Date.now();
}

function optionalCitationFields(row: LocalFactsDatabaseRow) {
  const citationUrl = readString(row.citation_url);
  const citationText = readString(row.citation_text);
  return {
    ...(citationUrl ? { citationUrl } : {}),
    ...(citationText ? { citationText } : {}),
  };
}

function sourceEvidenceCaveats({
  sourceName,
  sourceProfileId,
  sourceAllowedUse,
}: {
  sourceName: string;
  sourceProfileId: string | undefined;
  sourceAllowedUse: string | undefined;
}) {
  const normalizedSourceName = normalizeSearchText(sourceName);
  return [
    ...(sourceAllowedUse === "citation_only"
      ? ["Citation-only source metadata may be displayed, but source bodies are not copied."]
      : []),
    ...(sourceAllowedUse === "public_republish"
      ? ["Public-republish metadata is display-safe after source governance."]
      : []),
    ...(sourceProfileId === "source_google_places" || normalizedSourceName.includes("google places")
      ? [
          "Google Places evidence requires Google attribution and field-mask governance.",
          "Google review content, raw snapshots, and unrestricted payloads are not exposed.",
        ]
      : []),
    "Evidence output is display-safe metadata, not a raw source dump.",
  ];
}

function sourceEvidenceNotChecked({
  sourceName,
  sourceProfileId,
}: {
  sourceName: string;
  sourceProfileId: string | undefined;
}) {
  const normalizedSourceName = normalizeSearchText(sourceName);
  return [
    ...(sourceProfileId === "source_google_places" || normalizedSourceName.includes("google places")
      ? ["Google review text", "booking or table availability", "full provider payload"]
      : []),
    "private audit records",
    "payment records",
    "internal model traces",
  ];
}

function readLocalFactEntityType(value: unknown): LocalFactEntityType | undefined {
  const parsed = localFactEntityTypeSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function readConfidence(value: unknown): LocalFactConfidence | undefined {
  return value === "high" || value === "medium" || value === "low" ? value : undefined;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

function readDateString(value: unknown) {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

function containsNormalized(haystack: string, needle: string) {
  return normalizeSearchText(haystack).includes(normalizeSearchText(needle));
}

function tagsFromText(value: string | undefined) {
  if (!value) {
    return [];
  }
  const normalized = normalizeSearchText(value);
  return [
    ...normalized.split(" ").filter((part) => part.length >= 3),
    normalized.includes("swim") ? "swimming" : undefined,
    normalized.includes("sunset") || normalized.includes("late afternoon") ? "sunset" : undefined,
    normalized.includes("rain") || normalized.includes("bad weather") ? "rain-fit" : undefined,
    normalized.includes("sand") ? "sandy" : undefined,
  ];
}

function tagFromText(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  return normalizeSearchText(value).replaceAll(" ", "-");
}

function candidateHasFit(
  candidate: { bestFor: string; fitReasons: readonly string[] },
  needles: readonly string[],
) {
  const text = normalizeSearchText(`${candidate.bestFor} ${candidate.fitReasons.join(" ")}`);
  return needles.some((needle) => text.includes(normalizeSearchText(needle)));
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string) {
  return tagFromText(value) ?? "unknown";
}

function uniqueCompact(values: readonly (string | undefined)[]) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function isLocalFactResultItem(
  value: LocalFactResultItem | undefined,
): value is LocalFactResultItem {
  return Boolean(value);
}

function isSourceEvidenceResultItem(
  value: SourceEvidenceResultItem | undefined,
): value is SourceEvidenceResultItem {
  return Boolean(value);
}

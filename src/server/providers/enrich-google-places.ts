import postgres from "postgres";
import {
  createGooglePlacesCandidateEntityId,
  enrichGooglePlacesCaptureDetails,
  type GooglePlacesCaptureDetails,
  googlePlacesDetailsFieldMask,
  googlePlacesDiscoverySourceProfileId,
} from "@/server/providers/google-places-enrichment";
import { createGooglePlacesDetailsCaptureInput } from "@/server/providers/google-places-governed-capture";
import type { GooglePlacesRequestKind } from "@/server/providers/google-places-policy";
import {
  type GooglePlaceDetailsWriteSummary,
  type GooglePlacesStoreDatabase,
  upsertGooglePlaceDetails,
} from "@/server/providers/google-places-store";

type GooglePlacesDetailsCaptureOptions = Omit<
  Parameters<typeof createGooglePlacesDetailsCaptureInput>[0],
  "details" | "requestKind"
>;

type PostgresQueryExecutor = {
  unsafe(query: string, params?: never[]): Promise<unknown>;
};

export type PersistGooglePlacesDetailsEnrichmentOptions = GooglePlacesDetailsCaptureOptions & {
  requestKind?: GooglePlacesRequestKind;
};

export async function persistGooglePlacesDetailsEnrichment(
  db: GooglePlacesStoreDatabase,
  details: readonly GooglePlacesCaptureDetails[],
  {
    requestKind = "details_identity_contact",
    sourceProfileId = googlePlacesDiscoverySourceProfileId,
    ...captureOptions
  }: PersistGooglePlacesDetailsEnrichmentOptions = {},
): Promise<GooglePlaceDetailsWriteSummary[]> {
  const captures = details.map((detail) =>
    createGooglePlacesDetailsCaptureInput({
      ...captureOptions,
      details: detail,
      requestKind,
      sourceProfileId,
    }),
  );

  const sourceProfile = await db.query<{ id: string }>(
    "select id from source_profiles where id = $1",
    [sourceProfileId],
  );
  if (!sourceProfile.rows[0]) {
    throw new Error(
      `Source profile ${sourceProfileId} is missing. Run bun run db:seed before enrichment.`,
    );
  }

  const summaries: GooglePlaceDetailsWriteSummary[] = [];
  for (const capture of captures) {
    const governedCapture = {
      ...capture,
      sourceRecord: {
        id: capture.governedSourceRecord.id,
        sourceProfileId: capture.governedSourceRecord.sourceProfileId,
        providerEntityId: capture.governedSourceRecord.providerEntityId ?? capture.place.placeId,
        entityType: capture.governedSourceRecord.entityType,
        name: capture.governedSourceRecord.name,
        normalizedPayload: capture.governedSourceRecord.normalizedPayload,
        sourceUrl: capture.governedSourceRecord.sourceUrl,
        fetchedAt: capture.governedSourceRecord.fetchedAt,
        allowedUse: capture.governedSourceRecord.allowedUse,
      },
    };

    summaries.push(await upsertGooglePlaceDetails(db, governedCapture));
    await updateCandidateEntityFromGovernedCapture(db, governedCapture);
  }

  return summaries;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!apiKey) {
    throw new Error("GOOGLE_API_KEY is required to enrich Google Places candidates.");
  }

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to enrich Google Places candidates.");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const db = createPostgresStoreDatabase(sql);

  try {
    const placeIds = await readGooglePlaceCandidateIds(db);
    const details = await enrichGooglePlacesCaptureDetails({
      apiKey,
      fieldMask: googlePlacesDetailsFieldMask,
      placeIds,
    });

    if (dryRun) {
      printSummary({ databaseUrl, persisted: false, placeIds, details });
      process.exit(0);
    }

    await sql.begin(async (tx) => {
      await persistGooglePlacesDetailsEnrichment(createPostgresStoreDatabase(tx), details);
    });

    printSummary({ databaseUrl, persisted: true, placeIds, details });
  } finally {
    await sql.end();
  }
}

if (import.meta.main) {
  await main();
}

async function updateCandidateEntityFromGovernedCapture(
  db: GooglePlacesStoreDatabase,
  capture: ReturnType<typeof createGooglePlacesDetailsCaptureInput>,
) {
  await db.query(
    `
      update candidate_entities
      set
        candidate_name = $1,
        source_record_id = $2,
        raw_location = $3,
        raw_category = $4,
        discovery_confidence = $5
      where id = $6
    `,
    [
      capture.sourceRecord.name,
      capture.sourceRecord.id,
      capture.details.formattedAddress ?? null,
      capture.details.primaryType ?? capture.details.typesJson?.[0] ?? "lodging",
      "0.55",
      createGooglePlacesCandidateEntityId(capture.place.placeId),
    ],
  );
}

async function readGooglePlaceCandidateIds(
  db: GooglePlacesStoreDatabase,
  sourceProfileId = googlePlacesDiscoverySourceProfileId,
) {
  const rows = await db.query<{ place_id: string }>(
    `
    select distinct sr.provider_entity_id as place_id
    from candidate_entities ce
    join source_records sr on sr.id = ce.source_record_id
    where ce.source_profile_id = $1
      and sr.provider_entity_id is not null
    order by sr.provider_entity_id
  `,
    [sourceProfileId],
  );

  return rows.rows.map((row) => row.place_id);
}

function printSummary({
  databaseUrl,
  persisted,
  placeIds,
  details,
}: {
  databaseUrl: string;
  persisted: boolean;
  placeIds: readonly string[];
  details: readonly GooglePlacesCaptureDetails[];
}) {
  const sample = details
    .slice(0, 8)
    .map((detail) => `${detail.displayName} (${detail.primaryType ?? detail.types[0] ?? "place"})`)
    .join("; ");
  const destination = persisted
    ? `Persisted enriched details to ${databaseUrlForLog(databaseUrl)}.`
    : "Dry run only; no database rows written.";

  console.log(
    [
      "Google Places detail enrichment completed.",
      `Field mask: ${googlePlacesDetailsFieldMask}.`,
      `Candidate Place IDs: ${placeIds.length}. Enriched details: ${details.length}.`,
      `Sample: ${sample}`,
      destination,
    ].join("\n"),
  );
}

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

function createPostgresStoreDatabase(sql: PostgresQueryExecutor): GooglePlacesStoreDatabase {
  return {
    async query<T>(query: string, params: unknown[] = []) {
      const rows = await sql.unsafe(query, params as never[]);
      return { rows: rows as T[] };
    },
  };
}

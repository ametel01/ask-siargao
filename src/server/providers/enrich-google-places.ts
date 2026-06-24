import postgres from "postgres";
import type { GooglePlacesDetails } from "@/server/providers/google-places-enrichment";
import {
  createGooglePlacesCandidateEntityId,
  createGooglePlacesDetailsSourceRecordId,
  enrichGooglePlacesDetails,
  googlePlacesDetailsFieldMask,
  googlePlacesDiscoverySourceProfileId,
  normalizeGooglePlacesDetailsPayload,
} from "@/server/providers/google-places-enrichment";

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

try {
  const placeIds = await readGooglePlaceCandidateIds();
  const details = await enrichGooglePlacesDetails({ apiKey, placeIds });

  if (dryRun) {
    printSummary({ persisted: false, placeIds, details });
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    const [sourceProfile] = await tx<{ id: string }[]>`
      select id from source_profiles where id = ${googlePlacesDiscoverySourceProfileId}
    `;

    if (!sourceProfile) {
      throw new Error(
        `Source profile ${googlePlacesDiscoverySourceProfileId} is missing. Run bun run db:seed before enrichment.`,
      );
    }

    await Promise.all(
      details.map(async (detail) => {
        const sourceRecordId = createGooglePlacesDetailsSourceRecordId(detail.placeId);
        const candidateEntityId = createGooglePlacesCandidateEntityId(detail.placeId);

        await tx`
        insert into source_records (
          id,
          source_profile_id,
          provider_entity_id,
          entity_type,
          name,
          normalized_payload,
          source_url,
          fetched_at,
          allowed_use
        )
        values (
          ${sourceRecordId},
          ${googlePlacesDiscoverySourceProfileId},
          ${detail.placeId},
          ${"accommodation"},
          ${detail.displayName},
          ${sql.json(normalizeGooglePlacesDetailsPayload(detail))},
          ${detail.googleMapsUri ?? null},
          ${detail.fetchedAt},
          ${"citation_only"}
        )
        on conflict (id) do update set
          name = excluded.name,
          normalized_payload = excluded.normalized_payload,
          source_url = excluded.source_url,
          fetched_at = excluded.fetched_at,
          allowed_use = excluded.allowed_use
      `;

        await tx`
        update candidate_entities
        set
          candidate_name = ${detail.displayName},
          source_record_id = ${sourceRecordId},
          raw_location = ${detail.formattedAddress ?? null},
          raw_category = ${detail.primaryType ?? detail.types[0] ?? "lodging"},
          discovery_confidence = ${"0.55"}
        where id = ${candidateEntityId}
      `;
      }),
    );
  });

  printSummary({ persisted: true, placeIds, details });
} finally {
  await sql.end();
}

async function readGooglePlaceCandidateIds() {
  const rows = await sql<{ place_id: string }[]>`
    select distinct sr.provider_entity_id as place_id
    from candidate_entities ce
    join source_records sr on sr.id = ce.source_record_id
    where ce.source_profile_id = ${googlePlacesDiscoverySourceProfileId}
      and sr.provider_entity_id is not null
    order by sr.provider_entity_id
  `;

  return rows.map((row) => row.place_id);
}

function printSummary({
  persisted,
  placeIds,
  details,
}: {
  persisted: boolean;
  placeIds: readonly string[];
  details: readonly GooglePlacesDetails[];
}) {
  const sample = details
    .slice(0, 8)
    .map((detail) => `${detail.displayName} (${detail.primaryType ?? detail.types[0] ?? "place"})`)
    .join("; ");
  const destination = persisted
    ? `Persisted enriched details to ${databaseUrlForLog(databaseUrl ?? "")}.`
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

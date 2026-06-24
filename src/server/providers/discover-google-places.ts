import postgres from "postgres";

import {
  createGooglePlacesDiscoveryObservations,
  discoverGooglePlacesAccommodationIds,
  googlePlacesDiscoveryFieldMask,
  googlePlacesDiscoverySourceProfileId,
} from "@/server/providers/google-places-discovery";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const apiKey = process.env.GOOGLE_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;

if (!apiKey) {
  throw new Error("GOOGLE_API_KEY is required to discover Google Places accommodation IDs.");
}

const batch = await discoverGooglePlacesAccommodationIds({ apiKey });
const observations = createGooglePlacesDiscoveryObservations(batch);

if (dryRun) {
  printSummary({ persisted: false });
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to persist Google Places discovery candidates.");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  await sql.begin(async (tx) => {
    const [sourceProfile] = await tx<{ id: string }[]>`
      select id from source_profiles where id = ${googlePlacesDiscoverySourceProfileId}
    `;

    if (!sourceProfile) {
      throw new Error(
        `Source profile ${googlePlacesDiscoverySourceProfileId} is missing. Run bun run db:seed before discovery.`,
      );
    }

    for (const observation of observations) {
      await tx`
        insert into source_records (
          id,
          source_profile_id,
          provider_entity_id,
          entity_type,
          name,
          normalized_payload,
          fetched_at,
          allowed_use
        )
        values (
          ${observation.sourceRecordId},
          ${googlePlacesDiscoverySourceProfileId},
          ${observation.placeId},
          ${"accommodation"},
          ${`Google Places ID-only discovery: ${observation.placeId}`},
          ${sql.json({
            placeId: observation.placeId,
            resourceName: observation.resourceName,
            searchLabel: observation.searchLabel,
            areaSlug: observation.areaSlug,
            textQuery: observation.textQuery,
            fieldMask: googlePlacesDiscoveryFieldMask,
            sku: "Places API Text Search Essentials (IDs Only)",
            storagePolicy: "Durable Place ID candidate only; no copied Google listing content.",
          })},
          ${observation.fetchedAt},
          ${"citation_only"}
        )
        on conflict (id) do update set
          provider_entity_id = excluded.provider_entity_id,
          normalized_payload = excluded.normalized_payload,
          fetched_at = excluded.fetched_at,
          allowed_use = excluded.allowed_use
      `;

      await tx`
        insert into candidate_entities (
          id,
          candidate_name,
          candidate_type,
          source_profile_id,
          source_record_id,
          raw_location,
          raw_category,
          discovery_confidence
        )
        values (
          ${observation.candidateEntityId},
          ${`Google Place ${observation.placeId}`},
          ${"accommodation"},
          ${googlePlacesDiscoverySourceProfileId},
          ${observation.sourceRecordId},
          ${observation.areaSlug},
          ${"lodging"},
          ${"0.35"}
        )
        on conflict (id) do update set
          source_record_id = excluded.source_record_id,
          raw_location = excluded.raw_location,
          raw_category = excluded.raw_category,
          discovery_confidence = excluded.discovery_confidence
      `;
    }
  });

  printSummary({ persisted: true, databaseUrl });
} finally {
  await sql.end();
}

function printSummary({ persisted, databaseUrl }: { persisted: boolean; databaseUrl?: string }) {
  const perSearch = batch.results
    .map(
      (result) =>
        `${result.search.label}: ${result.places.length} IDs${
          result.nextPageToken ? " (next page available)" : ""
        }`,
    )
    .join("; ");

  const destination = persisted
    ? `Persisted candidates to ${databaseUrlForLog(databaseUrl ?? "")}.`
    : "Dry run only; no database rows written.";

  console.log(
    [
      `Google Places ID-only discovery completed at ${batch.fetchedAt}.`,
      `Field mask: ${googlePlacesDiscoveryFieldMask}.`,
      `Returned observations: ${observations.length}. Unique Place IDs: ${batch.uniquePlaceIds.length}.`,
      perSearch,
      destination,
    ].join("\n"),
  );
}

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

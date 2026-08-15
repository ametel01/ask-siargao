import { describe, expect, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";

import { runInitialMigration } from "@/server/db/test-database";
import {
  type PersistGooglePlacesDetailsEnrichmentOptions,
  persistGooglePlacesDetailsEnrichment,
} from "@/server/providers/enrich-google-places";
import {
  createGooglePlacesCandidateEntityId,
  type GooglePlacesCaptureDetails,
  googlePlacesDetailsFieldMask,
  googlePlacesDiscoverySourceProfileId,
} from "@/server/providers/google-places-enrichment";
import { type SourceProfile, SourceRegistry } from "@/server/providers/source-registry";

describe("Google Places enrichment persistence", () => {
  test("persists detail enrichment from governed capture output", async () => {
    const db = await openEnrichmentTestDatabase({ seedSourceProfile: true });
    await seedCandidate(db);
    const fieldMask =
      "id,name,displayName,formattedAddress,googleMapsUri,rating,userRatingCount,currentOpeningHours";

    const summaries = await persistGooglePlacesDetailsEnrichment(db, [captureDetails(fieldMask)], {
      policies: {
        details_identity_contact: {
          fieldMask,
          freshnessDays: 4,
          retentionDays: 9,
          storagePolicy: "google_attribution_required_cache",
          requiresGoogleAttribution: true,
        },
      },
      registry: governedRegistry({
        allowedUse: "public_republish",
        authorityLevel: 5,
        storesRawAllowed: true,
        publishesRawAllowed: true,
      }),
    });

    const governedRows = await db.query<{
      source_allowed_use: string;
      normalized_payload: {
        fieldMask: string;
        governedPolicy: {
          allowedUse: string;
          fieldMask: string;
          staleAt: string;
          retentionExpiresAt: string;
          auditUseAllowed: boolean;
          rawEvidenceAllowed: boolean;
          publicRepublishAllowed: boolean;
          requiresGoogleAttribution: boolean;
        };
      };
      snapshot_field_mask: string;
      snapshot_stale_at: Date;
      snapshot_retention_expires_at: Date;
      storage_policy: string;
      attribution_json: {
        fieldMask: string;
        requiresGoogleAttribution: boolean;
      };
      details_stale_at: Date;
      details_retention_expires_at: Date;
      candidate_name: string;
      candidate_source_record_id: string;
      raw_location: string;
      raw_category: string;
    }>(`
      select
        sr.allowed_use as source_allowed_use,
        sr.normalized_payload,
        gps.field_mask as snapshot_field_mask,
        gps.stale_at as snapshot_stale_at,
        gps.retention_expires_at as snapshot_retention_expires_at,
        gps.storage_policy,
        gps.attribution_json,
        gpd.stale_at as details_stale_at,
        gpd.retention_expires_at as details_retention_expires_at,
        ce.candidate_name,
        ce.source_record_id as candidate_source_record_id,
        ce.raw_location,
        ce.raw_category
      from source_records sr
      join google_place_snapshots gps on gps.source_record_id = sr.id
      join google_place_details gpd on gpd.place_id = gps.place_id
      join candidate_entities ce on ce.source_record_id = sr.id
      where sr.id = 'record_google_places_details_place_governed'
    `);
    const factPolicyRows = await db.query<{
      public_republish_allowed: boolean;
      audit_use_allowed: boolean;
      raw_evidence_allowed: boolean;
      source_authority: number;
      confidence_label: string;
    }>(`
      select distinct
        public_republish_allowed,
        audit_use_allowed,
        raw_evidence_allowed,
        source_authority,
        confidence_label
      from facts
      order by source_authority
    `);
    const evidenceRows = await db.query<{
      allowed_use: string;
      public_republish_allowed: boolean;
    }>(`
      select distinct allowed_use, public_republish_allowed
      from evidence
    `);

    expect(summaries[0]).toMatchObject({
      placeId: "place_governed",
      requestKind: "details_identity_contact",
      sourceRecordId: "record_google_places_details_place_governed",
      snapshotUpserted: true,
      detailsUpserted: true,
    });
    expect(governedRows.rows[0]).toMatchObject({
      source_allowed_use: "public_republish",
      normalized_payload: {
        fieldMask,
        governedPolicy: {
          allowedUse: "public_republish",
          fieldMask,
          staleAt: "2026-06-29T00:00:00.000Z",
          retentionExpiresAt: "2026-07-04T00:00:00.000Z",
          auditUseAllowed: true,
          rawEvidenceAllowed: true,
          publicRepublishAllowed: true,
          requiresGoogleAttribution: true,
        },
      },
      snapshot_field_mask: fieldMask,
      storage_policy: "google_attribution_required_cache",
      attribution_json: {
        fieldMask,
        requiresGoogleAttribution: true,
      },
      candidate_name: "Governed Cafe",
      candidate_source_record_id: "record_google_places_details_place_governed",
      raw_location: "Tourism Road, General Luna",
      raw_category: "restaurant",
    });
    expect(governedRows.rows[0]?.snapshot_stale_at.toISOString()).toBe("2026-06-29T00:00:00.000Z");
    expect(governedRows.rows[0]?.snapshot_retention_expires_at.toISOString()).toBe(
      "2026-07-04T00:00:00.000Z",
    );
    expect(governedRows.rows[0]?.details_stale_at.toISOString()).toBe("2026-06-29T00:00:00.000Z");
    expect(governedRows.rows[0]?.details_retention_expires_at.toISOString()).toBe(
      "2026-07-04T00:00:00.000Z",
    );
    expect(factPolicyRows.rows).toEqual([
      {
        public_republish_allowed: true,
        audit_use_allowed: true,
        raw_evidence_allowed: true,
        source_authority: 5,
        confidence_label: "medium",
      },
    ]);
    expect(evidenceRows.rows).toEqual([
      {
        allowed_use: "public_republish",
        public_republish_allowed: true,
      },
    ]);

    await db.close();
  });

  test("fails closed when the database source profile is missing", async () => {
    const db = await openEnrichmentTestDatabase({ seedSourceProfile: false });

    await expect(persistGooglePlacesDetailsEnrichment(db, [captureDetails()])).rejects.toThrow(
      `Source profile ${googlePlacesDiscoverySourceProfileId} is missing. Run bun run db:seed before enrichment.`,
    );

    const counts = await db.query<{ source_records: number; snapshots: number; details: number }>(`
      select
        (select count(*)::int from source_records) as source_records,
        (select count(*)::int from google_place_snapshots) as snapshots,
        (select count(*)::int from google_place_details) as details
    `);

    expect(counts.rows[0]).toEqual({
      source_records: 0,
      snapshots: 0,
      details: 0,
    });

    await db.close();
  });

  test("fails closed when request policy metadata is missing", async () => {
    const db = await openEnrichmentTestDatabase({ seedSourceProfile: true });
    await seedCandidate(db);
    const options = {
      policies: {
        details_identity_contact: {
          freshnessDays: 4,
          retentionDays: 9,
          storagePolicy: "google_attribution_required_cache",
          requiresGoogleAttribution: true,
        },
      },
    } satisfies PersistGooglePlacesDetailsEnrichmentOptions;

    await expect(
      persistGooglePlacesDetailsEnrichment(db, [captureDetails()], options),
    ).rejects.toThrow("missing an explicit field mask");

    const counts = await db.query<{ governed_records: number; snapshots: number; details: number }>(
      `
      select
        (
          select count(*)::int
          from source_records
          where id = 'record_google_places_details_place_governed'
        ) as governed_records,
        (select count(*)::int from google_place_snapshots) as snapshots,
        (select count(*)::int from google_place_details) as details
    `,
    );

    expect(counts.rows[0]).toEqual({
      governed_records: 0,
      snapshots: 0,
      details: 0,
    });

    await db.close();
  });
});

async function openEnrichmentTestDatabase({ seedSourceProfile }: { seedSourceProfile: boolean }) {
  const db = new PGlite();
  await runInitialMigration(db);

  if (!seedSourceProfile) {
    await db.query(`delete from source_profiles where id = $1`, [
      googlePlacesDiscoverySourceProfileId,
    ]);
  } else {
    await db.query(
      `
        insert into source_profiles (
          id,
          provider_id,
          source_name,
          source_type,
          access_method,
          allowed_use,
          freshness_window_days,
          authority_level,
          stores_raw_allowed,
          publishes_raw_allowed
        )
        values ($1, 'provider_google_places', 'Google Places', 'licensed_api', 'api', 'citation_only', 30, 3, false, false)
        on conflict (id) do nothing
      `,
      [googlePlacesDiscoverySourceProfileId],
    );
  }

  return db;
}

async function seedCandidate(db: PGlite) {
  await db.query(
    `
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
        'record_google_places_discovery_place_governed',
        $1,
        'place_governed',
        'accommodation',
        'Ungoverned Discovery Name',
        '{}'::jsonb,
        '2026-06-20T00:00:00.000Z',
        'citation_only'
      )
    `,
    [googlePlacesDiscoverySourceProfileId],
  );
  await db.query(
    `
      insert into candidate_entities (
        id,
        candidate_name,
        candidate_type,
        source_profile_id,
        source_record_id,
        discovery_confidence
      )
      values ($1, 'Ungoverned Discovery Name', 'accommodation', $2, 'record_google_places_discovery_place_governed', 0.3)
    `,
    [createGooglePlacesCandidateEntityId("place_governed"), googlePlacesDiscoverySourceProfileId],
  );
}

function captureDetails(fieldMask = googlePlacesDetailsFieldMask) {
  return {
    placeId: "place_governed",
    resourceName: "places/place_governed",
    displayName: "Governed Cafe",
    displayNameJson: { text: "Governed Cafe", languageCode: "en" },
    formattedAddress: "Tourism Road, General Luna",
    locationJson: { latitude: 9.803, longitude: 126.161 },
    latitude: 9.803,
    longitude: 126.161,
    types: ["restaurant", "food", "point_of_interest"],
    primaryType: "restaurant",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=456",
    currentOpeningHoursJson: { openNow: true },
    rating: 4.8,
    userRatingCount: 221,
    attributionsJson: [{ provider: "Google" }],
    reviews: [],
    fieldMask,
    fetchedAt: "2026-06-25T00:00:00.000Z",
  } satisfies GooglePlacesCaptureDetails;
}

function governedRegistry(profile: Partial<SourceProfile> = {}) {
  return new SourceRegistry([
    {
      id: googlePlacesDiscoverySourceProfileId,
      sourceName: "Google Places API",
      sourceType: "licensed_api",
      accessMethod: "api",
      allowedUse: "citation_only",
      rateLimit: "test",
      freshnessWindowDays: 30,
      authorityLevel: 3,
      storesRawAllowed: false,
      publishesRawAllowed: false,
      requiresPartnerApproval: false,
      knownStaleRisk: "medium",
      knownAiOrSeoContentRisk: "low",
      ...profile,
    },
  ]);
}

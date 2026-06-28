import postgres from "postgres";

import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";
import { createComponentLogger } from "@/server/observability/logger";

type QueryRunner = (
  query: TemplateStringsArray,
  ...params: unknown[]
) => PromiseLike<Record<string, unknown>[]>;

type SeedCounts = {
  areas: string;
  routes: string;
  sources: string;
};

export async function seedSiargaoBaseline(query: QueryRunner) {
  await Promise.all([
    Promise.all(
      siargaoTaxonomy.areas.map(
        (area) => query`
      insert into areas (id, slug, name, municipality, description)
       values (${area.id}, ${area.slug}, ${area.name}, ${area.municipality}, ${area.description})
       on conflict (id) do update set
         slug = excluded.slug,
         name = excluded.name,
         municipality = excluded.municipality,
         description = excluded.description`,
      ),
    ),

    Promise.all(
      siargaoTaxonomy.routes.map(
        (route) => query`
      insert into routes (id, slug, name, origin, destination, transport_modes, risk_notes)
       values (
         ${route.id},
         ${route.slug},
         ${route.name},
         ${route.origin},
         ${route.destination},
         ${JSON.stringify(route.transportModes)}::jsonb,
         ${JSON.stringify(route.riskNotes)}::jsonb
       )
       on conflict (id) do update set
         slug = excluded.slug,
         name = excluded.name,
         origin = excluded.origin,
         destination = excluded.destination,
         transport_modes = excluded.transport_modes,
         risk_notes = excluded.risk_notes`,
      ),
    ),

    query`
    insert into providers (id, slug, name, provider_type)
     values
       ('provider_official_transport', 'official-transport-sources', 'Official transport sources', 'official_transport'),
       ('provider_open_meteo', 'open-meteo', 'Open-Meteo', 'weather_api'),
       ('provider_tide_forecast', 'tide-forecast', 'Tide-Forecast', 'marine_forecast_page'),
       ('provider_google_places', 'google-places', 'Google Places', 'places_api'),
       ('provider_user_evidence', 'user-submitted-evidence', 'User-submitted evidence', 'user_submitted_evidence')
     on conflict (id) do nothing`,
  ]);

  await query`
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
       publishes_raw_allowed,
       requires_partner_approval,
       notes
     )
     values
       (
         'source_official_transport',
         'provider_official_transport',
         'Official transport source profile',
         'official',
         'official_page',
         'citation_only',
         1,
         5,
         false,
         false,
         false,
         'Seed profile for official ferry, airport, port, and transport policy sources.'
       ),
       (
         'source_open_meteo',
         'provider_open_meteo',
         'Open-Meteo weather API profile',
         'licensed_api',
         'api',
         'public_republish',
         1,
         4,
         true,
         true,
         false,
         'Seed profile for weather forecast and historical weather facts.'
       ),
       (
         'source_open_meteo_marine',
         'provider_open_meteo',
         'Open-Meteo Marine API profile',
         'licensed_api',
         'api',
         'public_republish',
         1,
         4,
         true,
         true,
         false,
         'Seed profile for modelled tide-proxy sea level, waves, swell, currents, and sea-surface temperature. Not official tide-gauge, navigation, or safety authority data.'
       ),
       (
         'source_tide_forecast_dev',
         'provider_tide_forecast',
         'Tide-Forecast Dapa page profile',
         'permitted_public_web',
         'crawl',
         'citation_only',
         1,
         2,
         false,
         false,
         true,
         'Development/testing profile for Tide-Forecast Dapa tide table and embedded sea-condition periods. Commercial production use needs Tide-Forecast/Meteo365 permission or license.'
       ),
       (
         'source_google_places',
         'provider_google_places',
         'Google Places API profile',
         'licensed_api',
         'api',
         'citation_only',
         30,
         3,
         false,
         false,
         false,
         'Google Places API source for Place ID discovery and refreshable accommodation/POI evidence. Store durable Place IDs, not copied public directory content.'
       ),
       (
         'source_user_submitted',
         'provider_user_evidence',
         'User-submitted trip evidence profile',
         'user_submitted',
         'user_submitted',
         'audit_only',
         30,
         2,
         true,
         false,
         false,
         'Private audit evidence supplied directly by the user or host.'
       )
     on conflict (id) do nothing`;

  const [counts] = (await query`
    select
       (select count(*) from areas)::text as areas,
       (select count(*) from routes)::text as routes,
       (select count(*) from source_profiles)::text as sources`) as SeedCounts[];

  if (!counts) {
    throw new Error("Seed completed but count query returned no rows.");
  }

  return counts;
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;
  const seedLogger = createComponentLogger("db.seed");

  if (!databaseUrl) {
    seedLogger.error("DATABASE_URL is required to seed the database.");
    throw new Error("DATABASE_URL is required to seed the database.");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const startedAt = performance.now();

  try {
    seedLogger.info(
      {
        databaseUrl: databaseUrlForLog(databaseUrl),
      },
      "Database seed started.",
    );

    const counts = await seedSiargaoBaseline((query, ...params) =>
      sql(query, ...(params as never[])),
    );

    seedLogger.info(
      {
        areaCount: Number(counts.areas),
        databaseUrl: databaseUrlForLog(databaseUrl),
        durationMs: Math.round(performance.now() - startedAt),
        routeCount: Number(counts.routes),
        sourceProfileCount: Number(counts.sources),
      },
      "Database seed completed.",
    );
  } catch (error) {
    seedLogger.error(
      {
        databaseUrl: databaseUrlForLog(databaseUrl),
        durationMs: Math.round(performance.now() - startedAt),
        err: error,
      },
      "Database seed failed.",
    );
    throw error;
  } finally {
    await sql.end();
    seedLogger.debug("Database seed connection closed.");
  }
}

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

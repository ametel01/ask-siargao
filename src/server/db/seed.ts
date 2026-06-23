import postgres from "postgres";

import { siargaoTaxonomy } from "@/server/audit/destinations/siargao/taxonomy";

type QueryRunner = (query: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

type SeedCounts = {
  areas: string;
  routes: string;
  sources: string;
};

export async function seedSiargaoBaseline(query: QueryRunner) {
  for (const area of siargaoTaxonomy.areas) {
    await query(
      `insert into areas (id, slug, name, municipality, description)
       values ($1, $2, $3, $4, $5)
       on conflict (id) do update set
         slug = excluded.slug,
         name = excluded.name,
         municipality = excluded.municipality,
         description = excluded.description`,
      [area.id, area.slug, area.name, area.municipality, area.description],
    );
  }

  for (const route of siargaoTaxonomy.routes) {
    await query(
      `insert into routes (id, slug, name, origin, destination, transport_modes, risk_notes)
       values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
       on conflict (id) do update set
         slug = excluded.slug,
         name = excluded.name,
         origin = excluded.origin,
         destination = excluded.destination,
         transport_modes = excluded.transport_modes,
         risk_notes = excluded.risk_notes`,
      [
        route.id,
        route.slug,
        route.name,
        route.origin,
        route.destination,
        JSON.stringify(route.transportModes),
        JSON.stringify(route.riskNotes),
      ],
    );
  }

  await query(
    `insert into providers (id, slug, name, provider_type)
     values
       ('provider_official_transport', 'official-transport-sources', 'Official transport sources', 'official_transport'),
       ('provider_open_meteo', 'open-meteo', 'Open-Meteo', 'weather_api'),
       ('provider_user_evidence', 'user-submitted-evidence', 'User-submitted evidence', 'user_submitted_evidence')
     on conflict (id) do nothing`,
  );

  await query(
    `insert into source_profiles (
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
     on conflict (id) do nothing`,
  );

  const [counts] = (await query(
    `select
       (select count(*) from areas)::text as areas,
       (select count(*) from routes)::text as routes,
       (select count(*) from source_profiles)::text as sources`,
  )) as SeedCounts[];

  if (!counts) {
    throw new Error("Seed completed but count query returned no rows.");
  }

  return counts;
}

if (import.meta.main) {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to seed the database.");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });

  try {
    const counts = await seedSiargaoBaseline(async (query, params = []) => {
      return sql.unsafe(query, params as never[]) as Promise<Record<string, unknown>[]>;
    });

    console.log(
      `Seeded ${counts.areas} areas, ${counts.routes} routes, and ${counts.sources} source profiles in ${databaseUrlForLog(
        databaseUrl,
      )}.`,
    );
  } finally {
    await sql.end();
  }
}

function databaseUrlForLog(url: string) {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, "://$1:***@");
}

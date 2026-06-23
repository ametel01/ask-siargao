import { optionalRiskModules, riskCategories } from "@/server/audit/enums";

const siargaoAreas = [
  {
    id: "area_general_luna",
    slug: "general-luna",
    name: "General Luna",
    municipality: "General Luna",
    description:
      "Main tourism base near Cloud 9, restaurants, surf schools, and island-hopping docks.",
  },
  {
    id: "area_cloud_9",
    slug: "cloud-9",
    name: "Cloud 9",
    municipality: "General Luna",
    description: "Surf-focused area with boardwalk access and more dependence on local transfers.",
  },
  {
    id: "area_malinao",
    slug: "malinao",
    name: "Malinao",
    municipality: "General Luna",
    description: "Quieter beach area south of the main General Luna strip.",
  },
  {
    id: "area_dapa",
    slug: "dapa",
    name: "Dapa",
    municipality: "Dapa",
    description: "Port town for ferry arrivals and onward transfers to tourist areas.",
  },
  {
    id: "area_del_carmen",
    slug: "del-carmen",
    name: "Del Carmen",
    municipality: "Del Carmen",
    description: "Airport and mangrove access area with longer transfers to General Luna.",
  },
] as const;

const siargaoRoutes = [
  {
    id: "route_iaopuerto_to_general_luna",
    slug: "sayak-airport-to-general-luna",
    name: "Sayak Airport to General Luna",
    origin: "Sayak Airport",
    destination: "General Luna",
    transportModes: ["van", "private_transfer", "tricycle"],
    riskNotes: [
      "Late arrivals may have fewer transfer options.",
      "Confirm accommodation pickup window.",
    ],
  },
  {
    id: "route_dapa_port_to_general_luna",
    slug: "dapa-port-to-general-luna",
    name: "Dapa Port to General Luna",
    origin: "Dapa Port",
    destination: "General Luna",
    transportModes: ["van", "tricycle", "motorbike"],
    riskNotes: ["Ferry delays can compress check-in and dinner options."],
  },
  {
    id: "route_surigao_to_dapa",
    slug: "surigao-city-to-dapa-ferry",
    name: "Surigao City to Dapa Ferry",
    origin: "Surigao City",
    destination: "Dapa Port",
    transportModes: ["ferry"],
    riskNotes: [
      "Schedule freshness is critical before payment.",
      "Weather can disrupt ferry legs.",
    ],
  },
] as const;

const siargaoRiskCategories = riskCategories.map((slug) => ({
  slug,
  destination: "siargao",
}));

const siargaoProviderCategories = [
  "official_transport",
  "weather_api",
  "accommodation_partner",
  "review_summary_api",
  "local_verified_record",
  "user_submitted_evidence",
] as const;

const siargaoServiceCategories = [
  "airport_transfer",
  "ferry",
  "medical_clinic",
  "pharmacy",
  "atm_cash",
  "sim_connectivity",
  "coworking",
  "surf_school",
  "island_hopping_operator",
] as const;

const siargaoOptionalModules = optionalRiskModules.map((slug) => ({
  slug,
  destination: "siargao",
}));

export const siargaoTaxonomy = {
  destination: "siargao",
  areas: siargaoAreas,
  routes: siargaoRoutes,
  riskCategories: siargaoRiskCategories,
  providerCategories: siargaoProviderCategories,
  serviceCategories: siargaoServiceCategories,
  optionalModules: siargaoOptionalModules,
} as const;

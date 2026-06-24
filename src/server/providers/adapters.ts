import type { SourceProfile } from "@/server/providers/source-registry";
import { SourceRegistry } from "@/server/providers/source-registry";

export type ProviderAdapterKind =
  | "official_public_sector"
  | "weather"
  | "maps_geocoding"
  | "accommodation_api"
  | "review_poi_api"
  | "user_submitted"
  | "local_partner";

export type ProviderAdapterContract = {
  id: string;
  kind: ProviderAdapterKind;
  profile: SourceProfile;
  retryPolicy: {
    maxAttempts: number;
    backoffMs: number;
  };
  rateLimit: string;
  freshnessWindowDays: number;
};

const officialTransportAdapter: ProviderAdapterContract = {
  id: "adapter_official_transport",
  kind: "official_public_sector",
  profile: {
    id: "source_official_transport",
    sourceName: "Official transport and public-sector sources",
    sourceType: "official",
    accessMethod: "official_page",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    termsUrl: "https://example.gov.ph/terms",
    rateLimit: "manual-profiled official pages only",
    freshnessWindowDays: 1,
    authorityLevel: 5,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "low",
    knownAiOrSeoContentRisk: "low",
    notes: "Use for policy, fees, transport, accreditation, closures, and public-sector facts.",
  },
  retryPolicy: { maxAttempts: 2, backoffMs: 1_000 },
  rateLimit: "manual-profiled official pages only",
  freshnessWindowDays: 1,
};

const openMeteoAdapter: ProviderAdapterContract = {
  id: "adapter_open_meteo",
  kind: "weather",
  profile: {
    id: "source_open_meteo",
    sourceName: "Open-Meteo weather API",
    sourceType: "licensed_api",
    accessMethod: "api",
    allowedUse: "public_republish",
    termsUrl: "https://open-meteo.com/en/terms",
    rateLimit: "fair-use API",
    freshnessWindowDays: 1,
    authorityLevel: 4,
    storesRawAllowed: true,
    publishesRawAllowed: true,
    requiresPartnerApproval: false,
    knownStaleRisk: "low",
    knownAiOrSeoContentRisk: "low",
    notes: "Permitted low-risk weather source for forecast and historical weather facts.",
  },
  retryPolicy: { maxAttempts: 3, backoffMs: 500 },
  rateLimit: "fair-use API",
  freshnessWindowDays: 1,
};

const googlePlacesAdapter: ProviderAdapterContract = {
  id: "adapter_google_places",
  kind: "review_poi_api",
  profile: {
    id: "source_google_places",
    sourceName: "Google Places API",
    sourceType: "licensed_api",
    accessMethod: "api",
    allowedUse: "citation_only",
    termsUrl: "https://cloud.google.com/maps-platform/terms",
    rateLimit: "quota-controlled Google Maps Platform API",
    freshnessWindowDays: 30,
    authorityLevel: 3,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "low",
    notes:
      "Use for Place ID discovery and refreshable accommodation/POI evidence. Store durable Place IDs, not a copied public Google directory.",
  },
  retryPolicy: { maxAttempts: 2, backoffMs: 1_000 },
  rateLimit: "quota-controlled Google Maps Platform API",
  freshnessWindowDays: 30,
};

const publicTourismDirectoryAdapter: ProviderAdapterContract = {
  id: "adapter_public_tourism_directory",
  kind: "official_public_sector",
  profile: {
    id: "source_public_tourism_directory",
    sourceName: "Public tourism directory",
    sourceType: "official",
    accessMethod: "official_page",
    allowedUse: "public_republish",
    robotsPolicy: "respect_robots_and_terms",
    termsUrl: "https://siargao.example/public-directory-terms",
    rateLimit: "static public directory fixtures",
    freshnessWindowDays: 30,
    authorityLevel: 4,
    storesRawAllowed: false,
    publishesRawAllowed: true,
    requiresPartnerApproval: false,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "low",
    notes: "Permitted public directory facts for static public knowledge fixtures.",
  },
  retryPolicy: { maxAttempts: 2, backoffMs: 1_000 },
  rateLimit: "static public directory fixtures",
  freshnessWindowDays: 30,
};

const userSubmittedEvidenceAdapter: ProviderAdapterContract = {
  id: "adapter_user_submitted_evidence",
  kind: "user_submitted",
  profile: {
    id: "source_user_submitted",
    sourceName: "User-submitted trip evidence",
    sourceType: "user_submitted",
    accessMethod: "user_submitted",
    allowedUse: "audit_only",
    rateLimit: "per intake",
    freshnessWindowDays: 30,
    authorityLevel: 2,
    storesRawAllowed: true,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "low",
    notes: "Can support a private paid audit but must not become public by default.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  rateLimit: "per intake",
  freshnessWindowDays: 30,
};

const disallowedScrapeAdapter: ProviderAdapterContract = {
  id: "adapter_disallowed_scrape",
  kind: "review_poi_api",
  profile: {
    id: "source_disallowed_scrape",
    sourceName: "Disallowed scrape source",
    sourceType: "permitted_public_web",
    accessMethod: "crawl",
    allowedUse: "disallowed",
    rateLimit: "none",
    freshnessWindowDays: 0,
    authorityLevel: 1,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: true,
    knownStaleRisk: "high",
    knownAiOrSeoContentRisk: "high",
    notes: "Test fixture profile for prohibited or unapproved sources.",
  },
  retryPolicy: { maxAttempts: 0, backoffMs: 0 },
  rateLimit: "none",
  freshnessWindowDays: 0,
};

export function createDefaultSourceRegistry() {
  return new SourceRegistry([
    officialTransportAdapter.profile,
    openMeteoAdapter.profile,
    googlePlacesAdapter.profile,
    publicTourismDirectoryAdapter.profile,
    userSubmittedEvidenceAdapter.profile,
    disallowedScrapeAdapter.profile,
  ]);
}

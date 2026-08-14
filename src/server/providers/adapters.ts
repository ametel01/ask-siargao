import type { SourceProfile } from "@/server/providers/source-registry";
import { SourceRegistry } from "@/server/providers/source-registry";

export type ProviderAdapterKind =
  | "official_public_sector"
  | "event_source"
  | "weather"
  | "marine"
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

const openMeteoMarineAdapter: ProviderAdapterContract = {
  id: "adapter_open_meteo_marine",
  kind: "marine",
  profile: {
    id: "source_open_meteo_marine",
    sourceName: "Open-Meteo Marine API",
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
    notes:
      "Permitted low-risk modelled marine source for tide-proxy sea level, waves, swell, currents, and sea-surface temperature. Not official tide-gauge, navigation, or safety authority data.",
  },
  retryPolicy: { maxAttempts: 3, backoffMs: 500 },
  rateLimit: "fair-use API",
  freshnessWindowDays: 1,
};

const tideForecastDevAdapter: ProviderAdapterContract = {
  id: "adapter_tide_forecast_dev",
  kind: "marine",
  profile: {
    id: "source_tide_forecast_dev",
    sourceName: "Tide-Forecast Dapa page",
    sourceType: "permitted_public_web",
    accessMethod: "crawl",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    termsUrl: "https://www.tide-forecast.com/pages/terms",
    rateLimit: "dev/test low-rate page fetches only",
    freshnessWindowDays: 1,
    authorityLevel: 2,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: true,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "low",
    notes:
      "Development/testing source for Tide-Forecast Dapa tide table and embedded sea-condition periods. Production/commercial use needs appropriate Tide-Forecast/Meteo365 permission or license.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "dev/test low-rate page fetches only",
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

const nightlifeOfficialVenueWebsiteAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_official_venue_websites",
  kind: "event_source",
  profile: {
    id: "source_nightlife_official_venue_websites",
    sourceName: "Official nightlife venue websites",
    sourceType: "official",
    accessMethod: "official_page",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    rateLimit: "manual-profiled venue pages only",
    freshnessWindowDays: 1,
    authorityLevel: 5,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "low",
    notes:
      "Primary event schedule source for a venue's own weekly or date-specific nightlife programming.",
  },
  retryPolicy: { maxAttempts: 2, backoffMs: 1_000 },
  rateLimit: "manual-profiled venue pages only",
  freshnessWindowDays: 1,
};

const nightlifeOfficialMultiVenueEventPageAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_official_multi_venue_event_pages",
  kind: "event_source",
  profile: {
    id: "source_nightlife_official_multi_venue_event_pages",
    sourceName: "Official multi-venue nightlife event pages",
    sourceType: "official",
    accessMethod: "official_page",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    rateLimit: "manual-profiled event pages only",
    freshnessWindowDays: 1,
    authorityLevel: 5,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "low",
    notes: "Use for organizer-owned event schedules spanning multiple General Luna venues.",
  },
  retryPolicy: { maxAttempts: 2, backoffMs: 1_000 },
  rateLimit: "manual-profiled event pages only",
  freshnessWindowDays: 1,
};

const nightlifeLocalEventDirectoryAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_local_event_directories",
  kind: "event_source",
  profile: {
    id: "source_nightlife_local_event_directories",
    sourceName: "Local nightlife event directories",
    sourceType: "permitted_public_web",
    accessMethod: "crawl",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    rateLimit: "low-rate profiled event pages only",
    freshnessWindowDays: 1,
    authorityLevel: 3,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "medium",
    notes:
      "Use for normalized event occurrence facts with source URL attribution; recheck daily for tonight answers.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "low-rate profiled event pages only",
  freshnessWindowDays: 1,
};

const nightlifeVenueSubmittedEventAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_venue_submitted_events",
  kind: "event_source",
  profile: {
    id: "source_nightlife_venue_submitted_events",
    sourceName: "Venue-submitted nightlife events",
    sourceType: "host_submitted",
    accessMethod: "partner",
    allowedUse: "public_republish",
    rateLimit: "per partner submission",
    freshnessWindowDays: 1,
    authorityLevel: 4,
    storesRawAllowed: true,
    publishesRawAllowed: true,
    requiresPartnerApproval: true,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "low",
    notes:
      "Use only when the venue or approved partner explicitly submits event facts with permission to display them.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  rateLimit: "per partner submission",
  freshnessWindowDays: 1,
};

const nightlifePublicOfficialSocialPostAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_public_official_social_posts",
  kind: "event_source",
  profile: {
    id: "source_nightlife_public_official_social_posts",
    sourceName: "Public official venue social posts",
    sourceType: "permitted_public_web",
    accessMethod: "official_page",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    rateLimit: "manual-profiled public official pages only",
    freshnessWindowDays: 1,
    authorityLevel: 4,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "high",
    knownAiOrSeoContentRisk: "low",
    notes:
      "Use public official venue posts as a same-day event check; do not store raw captions, media, comments, or private group content.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "manual-profiled public official pages only",
  freshnessWindowDays: 1,
};

const nightlifeLocalGuideAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_local_guides",
  kind: "event_source",
  profile: {
    id: "source_nightlife_local_guides",
    sourceName: "Nightlife local guides",
    sourceType: "local_verified",
    accessMethod: "crawl",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    rateLimit: "low-rate profiled guide pages only",
    freshnessWindowDays: 7,
    authorityLevel: 3,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "high",
    knownAiOrSeoContentRisk: "medium",
    notes:
      "Use for recurring baseline and discovery; do not treat stale guide rows as same-day event truth.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "low-rate profiled guide pages only",
  freshnessWindowDays: 7,
};

const nightlifeTravelNewsCorroborationAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_travel_news_corroboration",
  kind: "event_source",
  profile: {
    id: "source_nightlife_travel_news_corroboration",
    sourceName: "Travel and news nightlife corroboration",
    sourceType: "permitted_public_web",
    accessMethod: "rss",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    rateLimit: "low-rate profiled pages only",
    freshnessWindowDays: 30,
    authorityLevel: 2,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "high",
    knownAiOrSeoContentRisk: "medium",
    notes:
      "Use as corroboration or source discovery only; it cannot verify tonight's event schedule by itself.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "low-rate profiled pages only",
  freshnessWindowDays: 30,
};

const nightlifeReviewTravelPlatformAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_review_travel_platforms",
  kind: "review_poi_api",
  profile: {
    id: "source_nightlife_review_travel_platforms",
    sourceName: "Review and travel platforms for nightlife",
    sourceType: "licensed_api",
    accessMethod: "api",
    allowedUse: "citation_only",
    rateLimit: "licensed/quota-controlled API only",
    freshnessWindowDays: 30,
    authorityLevel: 2,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: true,
    knownStaleRisk: "high",
    knownAiOrSeoContentRisk: "medium",
    notes:
      "Use for venue context or discovery only; platform review/travel content cannot rank or verify tonight's event schedule.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "licensed/quota-controlled API only",
  freshnessWindowDays: 30,
};

const nightlifeRedditPublicThreadAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_reddit_public_threads",
  kind: "event_source",
  profile: {
    id: "source_nightlife_reddit_public_threads",
    sourceName: "Reddit public nightlife threads",
    sourceType: "permitted_public_web",
    accessMethod: "crawl",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    rateLimit: "manual-profiled public threads only",
    freshnessWindowDays: 30,
    authorityLevel: 1,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "high",
    knownAiOrSeoContentRisk: "medium",
    notes:
      "Low-confidence community rhythm signal only; never overrides official/event sources or verifies tonight's schedule.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "manual-profiled public threads only",
  freshnessWindowDays: 30,
};

const nightlifeYouTubeVideoAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_youtube_videos",
  kind: "event_source",
  profile: {
    id: "source_nightlife_youtube_videos",
    sourceName: "YouTube nightlife videos",
    sourceType: "permitted_public_web",
    accessMethod: "api",
    allowedUse: "citation_only",
    termsUrl: "https://www.youtube.com/t/terms",
    rateLimit: "official API or manual-profiled public pages only",
    freshnessWindowDays: 90,
    authorityLevel: 1,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: true,
    knownStaleRisk: "high",
    knownAiOrSeoContentRisk: "medium",
    notes: "Atmosphere and geography signal only; never valid as proof of tonight's schedule.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "official API or manual-profiled public pages only",
  freshnessWindowDays: 90,
};

const nightlifeBroadTravelBlogAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_broad_travel_blogs",
  kind: "event_source",
  profile: {
    id: "source_nightlife_broad_travel_blogs",
    sourceName: "Broad travel blogs for nightlife",
    sourceType: "permitted_public_web",
    accessMethod: "crawl",
    allowedUse: "citation_only",
    robotsPolicy: "respect_robots_and_terms",
    rateLimit: "low-rate profiled pages only",
    freshnessWindowDays: 90,
    authorityLevel: 1,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "high",
    knownAiOrSeoContentRisk: "high",
    notes:
      "Discovery and background only; verify against official, directory, or submitted event profiles before answering tonight.",
  },
  retryPolicy: { maxAttempts: 1, backoffMs: 1_000 },
  rateLimit: "low-rate profiled pages only",
  freshnessWindowDays: 90,
};

const nightlifePrivateSocialGroupAdapter: ProviderAdapterContract = {
  id: "adapter_nightlife_private_social_groups",
  kind: "event_source",
  profile: {
    id: "source_nightlife_private_social_groups",
    sourceName: "Private or semi-private nightlife social groups",
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
    notes:
      "Disallowed unless content is explicitly submitted by a user, venue, or partner with permission through an approved submitted-source profile.",
  },
  retryPolicy: { maxAttempts: 0, backoffMs: 0 },
  rateLimit: "none",
  freshnessWindowDays: 0,
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

const curatedAskSiargaoGuideAdapter: ProviderAdapterContract = {
  id: "adapter_curated_ask_siargao_guide",
  kind: "local_partner",
  profile: {
    id: "source_curated_ask_siargao_guide",
    sourceName: "Ask Siargao curated local guide",
    sourceType: "local_verified",
    accessMethod: "partner",
    allowedUse: "public_republish",
    rateLimit: "product-maintained content only",
    freshnessWindowDays: 180,
    authorityLevel: 3,
    storesRawAllowed: false,
    publishesRawAllowed: false,
    requiresPartnerApproval: false,
    knownStaleRisk: "medium",
    knownAiOrSeoContentRisk: "low",
    notes:
      "Stable product-maintained Siargao planning knowledge; live schedules, prices, availability, and safety status still require current checks.",
  },
  retryPolicy: { maxAttempts: 0, backoffMs: 0 },
  rateLimit: "product-maintained content only",
  freshnessWindowDays: 180,
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
    openMeteoMarineAdapter.profile,
    tideForecastDevAdapter.profile,
    googlePlacesAdapter.profile,
    nightlifeOfficialVenueWebsiteAdapter.profile,
    nightlifeOfficialMultiVenueEventPageAdapter.profile,
    nightlifeLocalEventDirectoryAdapter.profile,
    nightlifeVenueSubmittedEventAdapter.profile,
    nightlifePublicOfficialSocialPostAdapter.profile,
    nightlifeLocalGuideAdapter.profile,
    nightlifeTravelNewsCorroborationAdapter.profile,
    nightlifeReviewTravelPlatformAdapter.profile,
    nightlifeRedditPublicThreadAdapter.profile,
    nightlifeYouTubeVideoAdapter.profile,
    nightlifeBroadTravelBlogAdapter.profile,
    nightlifePrivateSocialGroupAdapter.profile,
    publicTourismDirectoryAdapter.profile,
    curatedAskSiargaoGuideAdapter.profile,
    userSubmittedEvidenceAdapter.profile,
    disallowedScrapeAdapter.profile,
  ]);
}

export const nightlifeEventSourceProfileIds = [
  "source_nightlife_official_venue_websites",
  "source_nightlife_official_multi_venue_event_pages",
  "source_nightlife_local_event_directories",
  "source_nightlife_venue_submitted_events",
  "source_nightlife_public_official_social_posts",
] as const;

export const nightlifeCommunitySourceProfileIds = [
  "source_nightlife_local_guides",
  "source_nightlife_travel_news_corroboration",
  "source_nightlife_review_travel_platforms",
  "source_nightlife_reddit_public_threads",
  "source_nightlife_youtube_videos",
  "source_nightlife_broad_travel_blogs",
] as const;

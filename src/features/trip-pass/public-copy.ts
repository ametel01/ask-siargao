import { tripPassProductCatalog } from "@/server/trip-pass/catalog";

export const tripPassPublicOffer = {
  label: tripPassProductCatalog.label,
  headline: tripPassProductCatalog.presentation.headline,
  priceLabel: tripPassProductCatalog.presentation.launchPriceLabel,
  priceAuthority: tripPassProductCatalog.presentation.priceAuthority,
  durationDays: tripPassProductCatalog.durationDays,
  freeWindowDays: tripPassProductCatalog.freeWindowDays,
  freeLimits: {
    chat: tripPassProductCatalog.freeMeterLimits.chat_message,
    live: tripPassProductCatalog.freeMeterLimits.live_refresh,
    heavy: tripPassProductCatalog.freeMeterLimits.heavy_recommendation,
  },
  paidLimits: {
    chat: tripPassProductCatalog.paidMeterLimits.chat_message,
    live: tripPassProductCatalog.paidMeterLimits.live_refresh,
    heavy: tripPassProductCatalog.paidMeterLimits.heavy_recommendation,
    weather: tripPassProductCatalog.paidMeterLimits.weather_refresh,
    route: tripPassProductCatalog.paidMeterLimits.route_lookup,
  },
  links: {
    chat: "/chat",
    legal: "/legal/trip-pass",
    pricing: "/#trip-pass",
    settings: "/settings#pass",
  },
} as const;

export const tripPassDifferentiators = [
  "Local trip context for where you stay, how you move, and what kind of day you are planning.",
  "Governed Siargao knowledge with source, freshness, and not-checked boundaries shown.",
  "Current evidence checks when weather, surf, Places, events, or routes matter.",
  "Map-ready recommendations and practical fallbacks when live evidence is unavailable.",
] as const;

export const tripPassPolicyPoints = [
  {
    title: "Activation and expiry",
    body: "A Trip Pass starts only after a verified Stripe payment event is matched to your signed-in account. Redirects do not activate access. The pass lasts 14 days from activation.",
  },
  {
    title: "Limits and reset windows",
    body: "The free trial runs for seven days. Paid chat and live-decision limits last until the pass expires; burst and concurrency limits can still ask you to wait temporarily.",
  },
  {
    title: "Refunds and disputes",
    body: "Full refunds revoke remaining pass access. Disputes suspend access while they are reviewed. Partial refunds require operator review instead of automatic meter changes.",
  },
  {
    title: "Provider availability",
    body: "Weather, surf, Places, web research, and route evidence can be unavailable or stale. Ask Siargao labels those limits and may use cached or local evidence instead.",
  },
  {
    title: "Privacy and support",
    body: "Account status is owner-scoped. Public analytics and support notes must not include raw prompts, precise coordinates, Stripe secrets, or full provider payloads.",
  },
] as const;

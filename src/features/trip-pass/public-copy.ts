import { tripPassProductCatalog } from "@/server/trip-pass/catalog";

export const tripPassPublicOffer = {
  label: tripPassProductCatalog.label,
  headline: tripPassProductCatalog.presentation.headline,
  priceLabel: tripPassProductCatalog.presentation.launchPriceLabel,
  priceAuthority: tripPassProductCatalog.presentation.priceAuthority,
  durationDays: tripPassProductCatalog.durationDays,
  freeWindowDays: tripPassProductCatalog.freeWindowDays,
  freeAnswerLimit: tripPassProductCatalog.freeMeterLimits.chat_message,
  paidAnswerLimit: tripPassProductCatalog.paidMeterLimits.chat_message,
  links: {
    chat: "/chat",
    legal: "/legal/trip-pass",
    pricing: "/#trip-pass",
    settings: "/sign-in?redirect_url=%2Fsettings%23pass",
  },
} as const;

export const tripPassDifferentiators = [
  "On-demand hotel, itinerary, immediate-plan, surf-session, and disruption reality checks.",
  "Local trip context for where you stay, how you move, and what kind of day you are planning.",
  "Governed Siargao knowledge with source, freshness, and not-checked boundaries shown.",
  "Request-time condition, surf, Places, event, and public-fact evidence when it matters.",
  "Practical recommendations and truthful fallbacks when current evidence is unavailable.",
] as const;

export const tripPassPolicyPoints = [
  {
    title: "Activation and expiry",
    body: "A Trip Pass starts only after a verified Stripe payment event is matched to your signed-in account. Redirects do not activate access. The pass lasts 14 days from activation.",
  },
  {
    title: "Answers and reset windows",
    body: "The free trial includes 10 travel answers over seven days. The paid pass includes 150 travel answers until it expires; temporary rate limits can still ask you to wait.",
  },
  {
    title: "Refunds and disputes",
    body: "Full refunds revoke remaining pass access. Disputes suspend access while they are reviewed. Partial refunds require operator review instead of automatic meter changes.",
  },
  {
    title: "Provider availability",
    body: "Weather, surf, Places, and public web evidence can be unavailable or stale. Ask Siargao labels those limits and may use cached or local evidence instead.",
  },
  {
    title: "Privacy and support",
    body: "Account status is owner-scoped. Public analytics and support notes must not include raw prompts, precise coordinates, Stripe secrets, or full provider payloads.",
  },
] as const;

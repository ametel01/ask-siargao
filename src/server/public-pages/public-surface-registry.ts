export const publicSurfaceRegistry = {
  accommodations: {
    family: "accommodations",
    catalogFamilyKey: "accommodations",
    routeSegment: "accommodations",
    hubPath: "/accommodations",
    hubTitle: "Where to stay in Siargao",
    hubDescription:
      "Compare Siargao accommodation areas and practical stay options using checked public guidance.",
    humanRoutePattern: "/accommodations/[slug]",
    llmMarkdownRoutePattern: "/accommodations/[slug]/llm.md",
    jsonRoutePattern: "/api/public/accommodations/[slug].json",
    includeInSitemap: true,
    includeInLlmsTxt: true,
  },
  areas: {
    family: "areas",
    catalogFamilyKey: "areas",
    routeSegment: "areas",
    hubPath: "/areas",
    hubTitle: "Siargao areas",
    hubDescription:
      "Explore Siargao's visitor areas and the practical tradeoffs that matter when choosing a base.",
    humanRoutePattern: "/areas/[slug]",
    llmMarkdownRoutePattern: "/areas/[slug]/llm.md",
    jsonRoutePattern: "/api/public/areas/[slug].json",
    includeInSitemap: true,
    includeInLlmsTxt: true,
  },
  routes: {
    family: "routes",
    catalogFamilyKey: "routes",
    routeSegment: "routes",
    hubPath: "/routes",
    hubTitle: "Getting to and around Siargao",
    hubDescription:
      "Plan common Siargao arrival and transfer routes with clear caveats for details that can change.",
    humanRoutePattern: "/routes/[slug]",
    llmMarkdownRoutePattern: "/routes/[slug]/llm.md",
    jsonRoutePattern: "/api/public/routes/[slug].json",
    includeInSitemap: true,
    includeInLlmsTxt: true,
  },
  operators: {
    family: "operators",
    catalogFamilyKey: "operators",
    routeSegment: "operators",
    hubPath: "/operators",
    hubTitle: "Choosing Siargao operators",
    hubDescription:
      "Use practical verification guidance when choosing transport and tourism operators in Siargao.",
    humanRoutePattern: "/operators/[slug]",
    llmMarkdownRoutePattern: "/operators/[slug]/llm.md",
    jsonRoutePattern: "/api/public/operators/[slug].json",
    includeInSitemap: true,
    includeInLlmsTxt: true,
  },
  risks: {
    family: "risks",
    catalogFamilyKey: "risks",
    routeSegment: "risks",
    hubPath: "/risks",
    hubTitle: "Siargao travel risks",
    hubDescription:
      "Understand common Siargao planning risks, their limits, and the fallbacks worth arranging.",
    humanRoutePattern: "/risks/[slug]",
    llmMarkdownRoutePattern: "/risks/[slug]/llm.md",
    jsonRoutePattern: "/api/public/risks/[slug].json",
    includeInSitemap: true,
    includeInLlmsTxt: true,
  },
} as const;

export type PublicPageFamily = keyof typeof publicSurfaceRegistry;
export type PublicSurfaceDefinition = (typeof publicSurfaceRegistry)[PublicPageFamily];

export const publicPageFamilies = Object.freeze(
  Object.keys(publicSurfaceRegistry) as PublicPageFamily[],
);

const publicPageFamilySet = new Set<string>(publicPageFamilies);
const publicSurfacesByRouteSegment = new Map<string, PublicSurfaceDefinition>(
  publicPageFamilies.map((family) => {
    const surface = publicSurfaceRegistry[family];
    return [surface.routeSegment, surface];
  }),
);

export function isPublicPageFamily(value: string): value is PublicPageFamily {
  return publicPageFamilySet.has(value);
}

export function getPublicSurface(family: PublicPageFamily) {
  return publicSurfaceRegistry[family];
}

export function getPublicSurfaceByRouteSegment(routeSegment: string) {
  return publicSurfacesByRouteSegment.get(routeSegment);
}

export function buildPublicHumanPath(family: PublicPageFamily, slug: string) {
  return `/${getPublicSurface(family).routeSegment}/${slug}`;
}

export function buildPublicHubPath(family: PublicPageFamily) {
  return getPublicSurface(family).hubPath;
}

export function buildPublicLlmMarkdownPath(family: PublicPageFamily, slug: string) {
  return `${buildPublicHumanPath(family, slug)}/llm.md`;
}

export function buildPublicJsonApiPath(family: PublicPageFamily, slug: string) {
  return `/api/public/${getPublicSurface(family).routeSegment}/${slug}.json`;
}

export function buildPublicCanonicalUrl(appUrl: string, family: PublicPageFamily, slug: string) {
  return `${appUrl.replace(/\/$/, "")}${buildPublicHumanPath(family, slug)}`;
}

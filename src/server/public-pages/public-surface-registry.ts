export const publicSurfaceRegistry = {
  accommodations: {
    family: "accommodations",
    catalogFamilyKey: "accommodations",
    routeSegment: "accommodations",
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

export function buildPublicLlmMarkdownPath(family: PublicPageFamily, slug: string) {
  return `${buildPublicHumanPath(family, slug)}/llm.md`;
}

export function buildPublicJsonApiPath(family: PublicPageFamily, slug: string) {
  return `/api/public/${getPublicSurface(family).routeSegment}/${slug}.json`;
}

export function buildPublicCanonicalUrl(appUrl: string, family: PublicPageFamily, slug: string) {
  return `${appUrl.replace(/\/$/, "")}${buildPublicHumanPath(family, slug)}`;
}

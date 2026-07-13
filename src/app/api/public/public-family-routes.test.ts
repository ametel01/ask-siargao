import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { GET as accommodationsGet } from "@/app/api/public/accommodations/[...slug]/route";
import { GET as areasGet } from "@/app/api/public/areas/[...slug]/route";
import { GET as operatorsGet } from "@/app/api/public/operators/[...slug]/route";
import { GET as risksGet } from "@/app/api/public/risks/[...slug]/route";
import { GET as routesGet } from "@/app/api/public/routes/[...slug]/route";
import {
  createFixturePublicKnowledgeCatalog,
  resetPublicKnowledgeCatalogForTests,
} from "@/server/public-pages/public-catalog";
import {
  buildPublicHumanPath,
  buildPublicJsonApiPath,
  buildPublicLlmMarkdownPath,
  type PublicPageFamily,
  publicPageFamilies,
} from "@/server/public-pages/public-surface-registry";
import { resetRateLimitStoreForTests } from "@/server/security/rate-limit";

type PublicJsonRouteGet = (
  request: Request,
  context: { params: Promise<{ slug: string[] }> },
) => Promise<Response>;

const familyRouteCases = {
  accommodations: {
    get: accommodationsGet,
    slug: "example-surf-stay",
    title: "Example Surf Stay",
  },
  areas: {
    get: areasGet,
    slug: "general-luna",
    title: "General Luna",
  },
  routes: {
    get: routesGet,
    slug: "surigao-to-dapa",
    title: "Surigao to Dapa route",
  },
  operators: {
    get: operatorsGet,
    slug: "licensed-van-transfer",
    title: "Licensed van transfer",
  },
  risks: {
    get: risksGet,
    slug: "late-arrival-transfer-risk",
    title: "Late arrival transfer risk",
  },
} satisfies Record<
  PublicPageFamily,
  {
    get: PublicJsonRouteGet;
    slug: string;
    title: string;
  }
>;

describe("public catalog family JSON routes", () => {
  beforeEach(() => {
    resetPublicKnowledgeCatalogForTests(createFixturePublicKnowledgeCatalog());
    resetRateLimitStoreForTests();
  });

  afterEach(() => {
    resetPublicKnowledgeCatalogForTests();
    resetRateLimitStoreForTests();
  });

  test("serve every registered fixture family with .json suffix normalization", async () => {
    for (const family of publicPageFamilies) {
      const route = familyRouteCases[family];
      const response = await route.get(
        new Request(`https://siargao.test${buildPublicJsonApiPath(family, route.slug)}`),
        { params: Promise.resolve({ slug: [`${route.slug}.json`] }) },
      );
      const body = (await response.json()) as {
        title: string;
        humanPath: string;
        llmMarkdownPath: string;
        jsonApiPath: string;
      };

      expect(response.status).toBe(200);
      expect(body.title).toBe(route.title);
      expect(body.humanPath).toBe(buildPublicHumanPath(family, route.slug));
      expect(body.llmMarkdownPath).toBe(buildPublicLlmMarkdownPath(family, route.slug));
      expect(body.jsonApiPath).toBe(buildPublicJsonApiPath(family, route.slug));
    }
  });

  test("keeps the public_api rate-limit 429 headers and shape on family JSON routes", async () => {
    let response: Response | undefined;

    for (let index = 0; index < 121; index += 1) {
      response = await accommodationsGet(
        new Request("https://siargao.test/api/public/accommodations/example-surf-stay.json"),
        { params: Promise.resolve({ slug: ["example-surf-stay.json"] }) },
      );
    }

    if (!response) {
      throw new Error("Expected rate limit response.");
    }

    const body = (await response.json()) as { error: string; resetAt: string };

    expect(response.status).toBe(429);
    expect(response.headers.get("x-ratelimit-limit")).toBe("120");
    expect(response.headers.get("x-ratelimit-remaining")).toBe("0");
    expect(response.headers.get("x-ratelimit-reset")).toBe(body.resetAt);
    expect(body.error).toBe("rate_limited");
    expect(body.resetAt).toBeTruthy();
  });
});

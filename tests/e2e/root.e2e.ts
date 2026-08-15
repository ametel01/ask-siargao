import { expect, type Page, test } from "@playwright/test";

const protectedUiHarnessHeader = {
  "x-ask-siargao-protected-ui-harness": "1",
  "x-ask-siargao-protected-ui-harness-token":
    "ask-siargao-playwright-protected-ui-harness-token-2026",
};

async function enableProtectedUiHarness(page: Page, headers: Record<string, string> = {}) {
  await page.setExtraHTTPHeaders({ ...protectedUiHarnessHeader, ...headers });
}

test("renders the Ask Siargao landing shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /live, local Siargao travel advice/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask in chat" })).toHaveAttribute("href", "/chat");
  await expect(page.getByLabel("Example Reality Check")).toContainText(
    "Given today's weather and tide, should we still go to Cloud 9?",
  );
  await expect(
    page.getByText("Opens chat with this example ready to review before you send it."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Planning inputs available in chat" }),
  ).toBeAttached();
  await expect(page.getByText("Weather", { exact: true })).toBeVisible();
  await expect(page.getByText("Places", { exact: true })).toBeVisible();
  await expect(page.getByText("Local caveats", { exact: true })).toBeVisible();
  await expect(page.getByText("Can check forecasts when asked")).toBeVisible();
  await expect(page.getByText("Can check places when asked")).toBeVisible();
  await expect(page.getByText("Checked on request")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "One clear Siargao travel pass" })).toBeVisible();
  await expect(page.locator("#trip-pass").getByText("$9.99", { exact: true })).toBeVisible();
  await expect(page.getByText("150 Siargao travel answers for 14 days")).toBeVisible();
  await expect(page.getByRole("link", { name: "Read terms" })).toHaveAttribute(
    "href",
    "/legal/trip-pass",
  );
  await expect(page.getByText(/\bExplorer\b|\bExtended\b|\bunlimited\b/i)).toHaveCount(0);
  await expect(page.locator("svg.lucide-check")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Match a surf session" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Replace a disrupted plan" })).toBeVisible();
  await expect(
    page.getByLabel("Example Reality Check").getByRole("link", { name: "Try this example" }),
  ).toHaveAttribute("href", /\/chat\?prompt=/);
  await expect(page.getByRole("link", { name: "Check a stay" })).toHaveAttribute(
    "href",
    /\/chat\?prompt=Reality-check/,
  );
});

test("loads Trip Pass pricing telemetry without a React script warning", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  const scriptResponse = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === "/scripts/trip-pass-pricing-telemetry.js";
  });

  await page.goto("/");
  await page.locator("#trip-pass").scrollIntoViewIfNeeded();

  expect((await scriptResponse).status()).toBe(200);
  expect(consoleErrors).not.toContain(
    expect.stringContaining("Encountered a script tag while rendering React component"),
  );
});

test("keeps Clerk client chunks off the unconfigured public landing route", async ({ page }) => {
  await page.goto("/");

  const clerkChunkSources = await page
    .locator("script[src]")
    .evaluateAll((scripts) =>
      scripts
        .map((script) => script.getAttribute("src") ?? "")
        .filter((source) => decodeURIComponent(source).toLowerCase().includes("clerk")),
    );
  expect(clerkChunkSources).toEqual([]);
});

test("uses one eager responsive hero image across mobile and desktop", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");

  const heroPreloads = page.locator('head link[rel="preload"][as="image"]');
  expect(await heroPreloads.count()).toBeLessThanOrEqual(1);
  const heroImage = page.getByTestId("responsive-hero-image");
  await expect(heroImage).toHaveCount(1);
  await expect(heroImage).toHaveAttribute("loading", "eager");
  await expect(heroImage).toHaveAttribute("fetchpriority", "high");
  await expect(heroImage).toHaveAttribute(
    "sizes",
    "(min-width: 1536px) 42vw, (min-width: 1024px) 38vw, 100vw",
  );
  await expect(heroImage).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(heroImage).toBeVisible();
});

test("@production-perf removes the landing render and hydration waterfalls", async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  const fontResponses: Array<{ status: number; url: string }> = [];
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith(".woff2")) {
      fontResponses.push({ status: response.status(), url: response.url() });
    }
  });
  await page.route("**/api/observability/events", async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ body: JSON.stringify({ status: "accepted" }), status: 200 });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/", { waitUntil: "networkidle" });

  await expect(page.locator('link[rel="stylesheet"]')).toHaveCount(0);
  await expect(page.locator("style")).not.toHaveCount(0);

  const heroImage = page.getByTestId("responsive-hero-image");
  await expect(heroImage).toHaveAttribute("loading", "eager");
  await expect(heroImage).toHaveAttribute("fetchpriority", "high");

  const loadedFonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => new URL(name).pathname.endsWith(".woff2"));
  });
  expect(loadedFonts).toHaveLength(2);
  expect(fontResponses).toHaveLength(2);
  expect(fontResponses.map(({ status }) => status)).toEqual([200, 200]);
  expect(
    fontResponses.every(({ url }) => new URL(url).pathname.startsWith("/_next/static/media/")),
  ).toBe(true);

  await page.locator("#trip-pass").scrollIntoViewIfNeeded();
  await expect
    .poll(() => events.find((event) => event.name === "trip_pass_pricing_viewed"))
    .toMatchObject({ surface: "landing" });
});

test("keeps every primary landing action on one contrast-stable color role", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const primaryActions = [
    page.getByRole("link", { name: "Try this example" }),
    page.getByRole("link", { name: "Start 10 free answers" }),
    page.getByRole("link", { name: "Get the 14-day Trip Pass — $9.99" }).first(),
    page.getByRole("link", { name: "Get the 14-day Trip Pass — $9.99" }).last(),
  ];

  for (const action of primaryActions) {
    await expect(action).toHaveCSS("background-color", "rgb(10, 111, 103)");
    await expect(action).toHaveCSS("color", "rgb(255, 249, 233)");
    await action.hover();
    await expect(action).toHaveCSS("background-color", "rgb(20, 184, 166)");
    await expect(action).toHaveCSS("color", "rgb(13, 16, 74)");
  }
});

test("applies the documented landing typography roles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const heroHeading = page.getByRole("heading", {
    name: /live, local Siargao travel advice/i,
  });
  await expect(heroHeading).toHaveCSS("font-family", /cormorantGaramond/);
  await expect(page.getByText("Can check forecasts when asked")).toHaveCSS("font-size", "12px");

  const planningIntroduction = page.getByText(
    "Ask when a choice matters. You get current evidence, local context, a practical next move, and a clear note on what still needs checking.",
  );
  await expect(planningIntroduction).toHaveCSS("font-family", /nunitoSans/);
  await expect(planningIntroduction).toHaveCSS("font-size", "16px");
  await expect(planningIntroduction).toHaveCSS("line-height", "24px");
  await expect(planningIntroduction).toHaveCSS("font-weight", "400");

  for (const title of [
    page.getByRole("heading", { name: "Match a surf session" }),
    page.getByRole("heading", { name: "Replace a disrupted plan" }),
    page.getByRole("heading", { name: "Try the decision desk" }),
    page.getByRole("heading", { name: "From a real plan to one workable next move" }),
  ]) {
    await expect(title).toHaveCSS("font-size", "24px");
    await expect(title).toHaveCSS("font-weight", "600");
  }
  await expect(page.getByRole("heading", { name: "14-day Siargao Trip Pass" })).toHaveCSS(
    "font-size",
    "30px",
  );

  const evidenceSummary = page.getByText("What may inform this check", { exact: true });
  await expect(evidenceSummary).toHaveCSS("font-size", "14px");
  await expect(evidenceSummary).toHaveCSS("font-weight", "800");
});

test("keeps planning guides in primary navigation on mobile and desktop", async ({ page }) => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 1000 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");

    await expect(
      page.locator("header").first().getByText("Ask Siargao", { exact: true }),
    ).toBeVisible();

    const guidesLink = page.locator("header").first().getByRole("link", {
      exact: true,
      name: "Guides",
    });
    await expect(guidesLink).toBeVisible();
    await expect(guidesLink).toHaveAttribute("href", "/guides");
  }

  await page.locator("header").first().getByRole("link", { exact: true, name: "Guides" }).click();
  await expect(page).toHaveURL(/\/guides$/);
  await expect(
    page.getByRole("heading", { name: "Plan the island. Then check reality." }),
  ).toBeVisible();

  for (const guideTitle of [
    "Complete Siargao Travel Guide",
    "Siargao First-Timer Guide",
    "3-Day Siargao Itinerary",
    "5-Day Siargao Itinerary",
    "7-Day Siargao Itinerary",
    "Best Time to Visit Siargao",
    "Siargao by Month",
  ]) {
    await expect(page.getByRole("link", { exact: true, name: guideTitle })).toBeVisible();
  }
});

test("exposes real desktop navigation in keyboard reading order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Landing page" });
  await expect(navigation).toBeVisible();
  for (const [label, target] of [
    ["Example", "#example-reality-check"],
    ["Planning inputs", "#planning-inputs"],
    ["Plan smarter", "#plan-smarter"],
    ["Trip Pass", "#trip-pass"],
    ["Travel guides", "#travel-guides"],
  ] as const) {
    const link = navigation.getByRole("link", { name: label });
    await expect(link).toHaveAttribute("href", target);
    await expect(page.locator(target)).toHaveCount(1);
  }

  const expectedTabOrder = [
    { link: page.getByRole("link", { name: "Ask Siargao home" }), rgb: [142, 230, 216] },
    {
      link: navigation.getByRole("link", { name: "Example" }),
      rgb: [142, 230, 216],
    },
    {
      link: navigation.getByRole("link", { name: "Planning inputs" }),
      rgb: [142, 230, 216],
    },
    {
      link: navigation.getByRole("link", { name: "Plan smarter" }),
      rgb: [142, 230, 216],
    },
    {
      link: navigation.getByRole("link", { name: "Trip Pass" }),
      rgb: [142, 230, 216],
    },
    {
      link: navigation.getByRole("link", { name: "Travel guides" }),
      rgb: [142, 230, 216],
    },
    { link: page.getByRole("link", { exact: true, name: "Guides" }), rgb: [142, 230, 216] },
    { link: page.getByRole("link", { name: "Ask in chat" }), rgb: [142, 230, 216] },
    {
      link: page
        .getByLabel("Example Reality Check")
        .getByRole("link", { name: "Try this example" }),
      rgb: [10, 111, 103],
    },
    { link: page.getByRole("link", { name: "Check a stay" }), rgb: [142, 230, 216] },
    { link: page.getByRole("link", { name: "Review a route" }), rgb: [142, 230, 216] },
    {
      link: page.getByRole("link", { name: "See full pricing and terms" }),
      rgb: [142, 230, 216],
    },
    {
      link: page.getByRole("link", { name: "Run this check" }).nth(0),
      rgb: [10, 111, 103],
    },
    {
      link: page.getByRole("link", { name: "Run this check" }).nth(1),
      rgb: [10, 111, 103],
    },
  ];

  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();

  for (const { link, rgb } of expectedTabOrder) {
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    const outline = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        throw new Error("Canvas 2D context is required to verify the focus outline color");
      }
      context.fillStyle = style.outlineColor;
      context.fillRect(0, 0, 1, 1);
      return {
        color: Array.from(context.getImageData(0, 0, 1, 1).data),
        serializedColor: style.outlineColor,
        style: style.outlineStyle,
        width: style.outlineWidth,
      };
    });
    expect(outline.style).toBe("solid");
    expect(outline.width).toBe("3px");
    expect(outline.color[3], `outline must be opaque: ${outline.serializedColor}`).toBe(255);
    for (const [channel, expected] of rgb.entries()) {
      expect(
        Math.abs((outline.color[channel] ?? Number.NaN) - expected),
        `outline must resolve to rgb(${rgb.join(", ")}): ${outline.serializedColor}`,
      ).toBeLessThanOrEqual(1);
    }
  }
});

test("landing prompt actions preserve exact chat handoff without submitting", async ({ page }) => {
  const actions = [
    {
      link: () =>
        page.getByLabel("Example Reality Check").getByRole("link", { name: "Try this example" }),
      prompt: "Given today's weather and tide, should we still go to Cloud 9?",
    },
    {
      link: () => page.getByRole("link", { name: "Check a stay" }),
      prompt:
        "Reality-check this Siargao hotel before I book: is it a good fit for quiet sleep and no scooter?",
    },
    {
      link: () =>
        page
          .getByRole("article")
          .filter({ has: page.getByRole("heading", { name: "Replace a disrupted plan" }) })
          .getByRole("link", { name: "Run this check" }),
      prompt: "Our island tour was cancelled. Give us a workable replacement in General Luna.",
    },
  ];
  let chatSubmissions = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/chat") {
      chatSubmissions += 1;
    }
  });

  for (const action of actions) {
    await page.goto("/");
    const link = action.link();
    await expect(link).toHaveAttribute("href", `/chat?prompt=${encodeURIComponent(action.prompt)}`);
    await link.click();

    await expect(page.getByLabel("Ask anything about Siargao")).toHaveValue(action.prompt);
    expect(new URL(page.url()).searchParams.get("prompt")).toBe(action.prompt);
    expect(chatSubmissions).toBe(0);
  }
});

for (const viewport of [
  { name: "compact-320", width: 320, height: 720 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "wide-1920", width: 1920, height: 1080 },
] as const) {
  test(`landing remains intentional and overflow-free at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /live, local Siargao travel advice/i }),
    ).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      const visibleImages = Array.from(document.images).filter(
        (image) => image.getClientRects().length > 0,
      );
      await Promise.all(visibleImages.map((image) => image.decode().catch(() => {})));
    });

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await expect(
      page.getByLabel("Example Reality Check").getByRole("link", { name: "Try this example" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Reality-check a Siargao plan" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "One clear Siargao travel pass" }),
    ).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Landing page" })).toBeVisible({
      visible: viewport.width >= 1024,
    });
    const landingSurfaceChrome = await page
      .getByLabel("Example Reality Check")
      .evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
        };
      });
    expect(Number.parseFloat(landingSurfaceChrome.borderRadius)).toBeLessThanOrEqual(20);
    expect(landingSurfaceChrome.boxShadow).not.toContain("48px");
    if (viewport.width <= 390) {
      const rightMargin = 20;
      const criticalElements = [
        {
          name: "header chat CTA",
          locator: page.getByRole("link", { name: "Chat", exact: true }),
        },
        { name: "example prompt card", locator: page.getByLabel("Example Reality Check") },
        {
          name: "example prompt CTA",
          locator: page
            .getByLabel("Example Reality Check")
            .getByRole("link", { name: "Try this example" }),
        },
        { name: "planning inputs panel", locator: page.locator("#planning-inputs") },
        { name: "trip pass pricing", locator: page.locator("#trip-pass") },
      ];

      for (const { locator, name } of criticalElements) {
        const bounds = await locator.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right };
        });
        expect(
          bounds.left,
          `${name} must stay inside the left viewport edge`,
        ).toBeGreaterThanOrEqual(0);
        expect(bounds.right, `${name} must preserve its right page margin`).toBeLessThanOrEqual(
          viewport.width - rightMargin + 0.5,
        );
      }
    }
    await page.screenshot({
      fullPage: true,
      path: `test-results/issue-110-landing-${viewport.name}.png`,
    });
    if (viewport.name === "mobile-390" || viewport.name === "desktop-1440") {
      await page.screenshot({
        fullPage: true,
        path: `test-results/issue-120-landing-${viewport.name}.png`,
      });
    }
  });
}

test("renders Trip Pass pricing and legal copy without unsupported promises", async ({ page }) => {
  for (const viewport of [
    { name: "mobile-390", width: 390, height: 844 },
    { name: "desktop-1440", width: 1440, height: 1000 },
  ] as const) {
    await page.setViewportSize(viewport);
    await page.goto("/#trip-pass");
    const pricing = page.locator("#trip-pass");
    await expect(pricing).toContainText("10 Siargao travel answers over 7 days");
    await expect(pricing).toContainText("$9.99");
    await expect(pricing).toContainText("150 Siargao travel answers for 14 days");
    await expect(
      pricing.getByRole("heading", { name: "From a real plan to one workable next move" }),
    ).toBeVisible();
    const exampleFlow = pricing.getByRole("list", { name: "Four-step decision flow" });
    await expect(exampleFlow.getByRole("listitem")).toHaveCount(4);
    await expect(exampleFlow).toContainText(
      "Cloud 9 today, with weather and tide in the decision.",
    );
    await expect(exampleFlow).toContainText("Keep, change, avoid, or confirm locally.");
    await expect(exampleFlow).toContainText("One practical action and what still needs checking.");
    const evidenceDisclosure = pricing
      .locator("details")
      .filter({ hasText: "What may inform this check" });
    expect(
      await evidenceDisclosure.evaluate((details) => (details as HTMLDetailsElement).open),
    ).toBe(false);
    const disclosureSummary = evidenceDisclosure.getByText("What may inform this check", {
      exact: true,
    });
    await disclosureSummary.click();
    await expect(evidenceDisclosure).toContainText("request-time weather, surf, Places");
    await expect(evidenceDisclosure).toContainText("does not guarantee exact surf-break safety");
    await disclosureSummary.click();
    expect(
      await evidenceDisclosure.evaluate((details) => (details as HTMLDetailsElement).open),
    ).toBe(false);
    await expect(pricing).toContainText(
      "Sign in to continue your purchase. Your 14-day Trip Pass activates only after payment is confirmed.",
    );
    await expect(pricing.getByRole("link", { name: "Start 10 free answers" })).toHaveAttribute(
      "href",
      "/chat",
    );
    const paidActions = pricing.getByRole("link", {
      name: "Get the 14-day Trip Pass — $9.99",
    });
    await expect(paidActions).toHaveCount(2);
    await expect(paidActions.first()).toHaveAttribute(
      "href",
      "/sign-in?redirect_url=%2Fsettings%23pass",
    );
    await expect(paidActions.last()).toHaveAttribute(
      "href",
      "/sign-in?redirect_url=%2Fsettings%23pass",
    );
    await expect(
      pricing.getByRole("link", { name: "Trip Pass terms and refunds" }),
    ).toHaveAttribute("href", "/legal/trip-pass");
    await expect(pricing.getByRole("link", { name: "Privacy notice" })).toHaveAttribute(
      "href",
      "/legal/privacy",
    );
    await expect(
      pricing.getByText(/\bExplorer\b|\bExtended\b|\bunlimited\b|\bguaranteed\b/i),
    ).toHaveCount(0);
    await expect(
      pricing.getByText(/live decisions|deep-planning|weather checks|route checks/i),
    ).toHaveCount(0);
    await expect(
      pricing.getByRole("heading", {
        name: "Built for Siargao decisions, not generic destination prose",
      }),
    ).toHaveCount(0);
    await page.screenshot({
      fullPage: true,
      path: `test-results/trip-pass-landing-${viewport.name}.png`,
    });
  }

  await page.goto("/legal/trip-pass");
  await expect(page.getByRole("heading", { name: "Siargao Trip Pass" })).toBeVisible();
  const legalBackLink = page.getByRole("link", { name: "Back to Ask Siargao" });
  const legalBackLinkBox = await legalBackLink.boundingBox();
  expect(legalBackLinkBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  const legalPrimaryAction = page.getByRole("link", { name: "Start in chat" });
  await expect(legalPrimaryAction).toHaveCSS("background-color", "rgb(15, 143, 129)");
  await expect(legalPrimaryAction).toHaveCSS("color", "rgb(5, 8, 42)");
  await legalPrimaryAction.hover();
  await expect(legalPrimaryAction).toHaveCSS("background-color", "rgb(10, 111, 103)");
  await expect(legalPrimaryAction).toHaveCSS("color", "rgb(255, 249, 233)");
  await expect(page.getByText("verified Stripe payment event")).toBeVisible();
  await expect(page.getByText("Full refunds revoke remaining pass access.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Provider availability" })).toBeVisible();
  const purchaseAction = page.getByRole("link", {
    name: "Get the 14-day Trip Pass — $9.99",
  });
  await expect(purchaseAction).toHaveAttribute("href", "/sign-in?redirect_url=%2Fsettings%23pass");
  await expect(
    page.getByText(/\bExplorer\b|\bExtended\b|\bunlimited\b|\bguaranteed\b/i),
  ).toHaveCount(0);

  await purchaseAction.click();
  await expect(page).toHaveURL("/sign-in?redirect_url=%2Fsettings%23pass");
  await expect(page.getByRole("heading", { name: "Sign in unavailable" })).toBeVisible();
});

test("landing remains usable at a 200 percent zoom equivalent with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/");

  const askInChat = page.getByRole("link", { name: "Ask in chat" });
  expect(
    await askInChat.evaluate((element) => getComputedStyle(element).transitionDuration),
  ).not.toBe("0.001s");

  const reducedMotionDisclosure = page
    .locator("details")
    .filter({ hasText: "What may inform this check" });
  await reducedMotionDisclosure.getByText("What may inform this check", { exact: true }).click();
  expect(
    await reducedMotionDisclosure
      .locator("summary svg")
      .evaluate((element) => getComputedStyle(element).transform),
  ).toBe("none");

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  for (const link of [
    page.getByRole("link", { name: "Ask in chat" }),
    page.getByLabel("Example Reality Check").getByRole("link", { name: "Try this example" }),
    page.getByRole("link", { name: "Check a stay" }),
    page.getByRole("link", { name: "Review a route" }),
  ]) {
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(721);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("denies protected surfaces when Clerk is disabled", async ({ page }) => {
  for (const pathname of [
    "/settings",
    "/profile",
    "/admin/diagnostics",
    "/audits/audit_123/status?state=awaiting_payment",
  ]) {
    const response = await page.goto(pathname);
    expect(response?.status(), pathname).toBe(404);
    await expect(page.getByText("clerk_disabled_protected_route")).toBeVisible();
  }
});

test("shows processing state after checkout return", async ({ page }) => {
  await enableProtectedUiHarness(page);
  await page.goto("/audits/audit_123/status?state=awaiting_payment");

  await expect(
    page.getByRole("heading", { name: "Waiting for Stripe confirmation" }),
  ).toBeVisible();
  await expect(page.getByText(/does not unlock the report/i)).toBeVisible();
  await expect(page.getByText(/Verified Stripe webhook marks the audit paid/i)).toBeVisible();
  await expect(page.locator("main h1, main h2").first()).toHaveText(
    "Waiting for Stripe confirmation",
  );
});

test("renders final report with evidence and limitations", async ({ page }) => {
  await page.goto("/audits/demo/report");

  await expect(page.getByRole("heading", { name: "Siargao trip risk audit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top risks" })).toBeVisible();
  await expect(page.getByText("ev_route", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes and limitations" })).toBeVisible();
  await expect(page.getByText(/Exact room noise level is not verified/i)).toBeVisible();
});

test("renders live-shaped local admin diagnostics without sample or private data", async ({
  page,
}) => {
  await enableProtectedUiHarness(page, {
    "x-admin-token": process.env.ADMIN_ACCESS_TOKEN ?? "replace-me",
  });
  await page.goto("/admin/diagnostics");

  await expect(page.getByRole("heading", { name: "Audit diagnostics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Blocked audits" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Operational findings" })).toBeVisible();
  await expect(page.getByText("No operational findings", { exact: true })).toBeVisible();
  await expect(page.getByText("audit_blocked_001")).toHaveCount(0);
  await expect(page.getByText("Weather source")).toHaveCount(0);
  await expect(page.getByText("traveler@example.com")).toHaveCount(0);
  await expect(page.getByText(/sk_test_should_not_render/i)).toHaveCount(0);
});

test("edits profile details and reloads the persisted values", async ({ page }) => {
  await enableProtectedUiHarness(page);
  let patchPayload: Record<string, unknown> | null = null;
  const patchPayloads: Record<string, unknown>[] = [];
  let profileSaveMode:
    | "success"
    | "delayed"
    | "invalid"
    | "invalidConstraints"
    | "invalidMultiValue"
    | "server"
    | "network" = "success";
  let profile = {
    identity: {
      email: "traveler@example.com",
      firstName: "Alex",
      lastName: "Traveler",
    },
    profile: {
      displayName: "Alex",
      homeCountry: "Australia",
      travelStyle: "Surf mornings",
      budgetLevel: "mid_range",
      dietaryNotes: "",
      foodNeeds: [],
      accessibilityNotes: "",
      surfAbility: "Intermediate",
      quietSleepPreference: null,
      weatherPreference: "avoid_rain" as const,
      interests: ["surf"],
      preferredAreas: ["Cloud 9"],
      tripContext: {
        accommodation: "Near Cloud 9",
        dateRange: "Aug 1 - 6",
        currentArea: "Cloud 9",
        travelerType: "Couple",
        transportMode: "scooter" as const,
        rideTimeLimitMinutes: 25,
        durableConstraints: ["rain_avoidance"],
        notes: "Arriving in August",
      },
      marketingConsent: false,
      createdAt: "2026-06-29T04:00:00.000Z",
      updatedAt: "2026-06-29T04:00:00.000Z",
    },
  };

  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as Partial<typeof profile.profile>;
      patchPayload = patch as Record<string, unknown>;
      patchPayloads.push(patchPayload);
      if (profileSaveMode === "invalid") {
        await route.fulfill({
          contentType: "application/json",
          status: 400,
          body: JSON.stringify({
            error: "invalid_profile_request",
            issues: [
              { path: "surfAbility", message: "Choose a surf ability in 80 characters or fewer." },
            ],
          }),
        });
        return;
      }
      if (profileSaveMode === "invalidConstraints") {
        await route.fulfill({
          contentType: "application/json",
          status: 400,
          body: JSON.stringify({
            error: "invalid_profile_request",
            issues: [
              {
                path: "tripContext.durableConstraints",
                message: "Choose supported group needs only.",
              },
            ],
          }),
        });
        return;
      }
      if (profileSaveMode === "invalidMultiValue") {
        await route.fulfill({
          contentType: "application/json",
          status: 400,
          body: JSON.stringify({
            error: "invalid_profile_request",
            issues: [
              { path: "interests.1", message: "Interests must be unique." },
              { path: "preferredAreas.0", message: "Choose a supported area." },
              { path: "foodNeeds.0", message: "Choose a supported food need." },
            ],
          }),
        });
        return;
      }
      if (profileSaveMode === "server") {
        await route.fulfill({
          contentType: "application/json",
          status: 500,
          body: JSON.stringify({ error: "profile_save_failed" }),
        });
        return;
      }
      if (profileSaveMode === "network") {
        await route.abort("failed");
        return;
      }
      if (profileSaveMode === "delayed") {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      profile = {
        ...profile,
        profile: {
          ...profile.profile,
          ...patch,
          ...(patch.tripContext
            ? { tripContext: { ...profile.profile.tripContext, ...patch.tripContext } }
            : {}),
          updatedAt: "2026-06-29T05:00:00.000Z",
        },
      };
    }

    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(profile),
    });
  });
  await page.route("**/api/chat/threads", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        threads: [
          {
            id: "chat_thread_cloud9",
            userId: "private-profile-owner",
            title: "Cloud 9 quiet sleep",
            lastMessageAt: "2026-06-29T05:00:00.000Z",
            updatedAt: "2026-06-29T05:00:00.000Z",
          },
          {
            id: "chat_thread_ferry",
            userId: "private-profile-owner",
            title: "Airport ferry timing",
            lastMessageAt: "2026-06-28T05:00:00.000Z",
            updatedAt: "2026-06-28T05:00:00.000Z",
          },
        ],
      }),
    });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        tripId: "saved_trip_e2e_profile",
        items: [
          {
            id: "saved_item_cloud9",
            kind: "place",
            title: "Cloud 9 dinner shortlist",
            updatedAt: "2026-06-29T05:00:00.000Z",
          },
          {
            id: "saved_item_rain",
            kind: "itinerary",
            title: "Rainy afternoon plan",
            updatedAt: "2026-06-28T05:00:00.000Z",
          },
        ],
      }),
    });
  });

  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { exact: true, name: "How should Ask Siargao plan for me?" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Current trip" })).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "Traveler preferences" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Account" })).toBeVisible();
  const accountPanel = page.locator("#account");
  await expect(accountPanel).toContainText("Alex");
  await expect(accountPanel).toContainText("traveler@example.com");
  await expect(accountPanel).toContainText("Signed in");
  const manageAccountButton = accountPanel.getByRole("button", { name: "Manage account" });
  await expect(manageAccountButton).toBeVisible();
  await manageAccountButton.focus();
  await expect(manageAccountButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("Clerk user ID")).toHaveCount(0);
  await expect(page.getByText("user_e2e_profile")).toHaveCount(0);
  await expect(page.getByText("clerkUserId")).toHaveCount(0);
  await expect(page.getByRole("heading", { exact: true, name: "Privacy" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Pass" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent chat history" })).toBeVisible();
  await expect(page.getByText("2 private threads")).toBeVisible();
  await expect(page.getByRole("link", { name: /Open chat: Cloud 9 quiet sleep/ })).toHaveAttribute(
    "href",
    "/chat?threadId=chat_thread_cloud9",
  );
  await expect(page.getByText("Cloud 9 quiet sleep")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved planning items" })).toBeVisible();
  await expect(page.getByText("2 saved items")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open saved item: Cloud 9 dinner shortlist/ }),
  ).toHaveAttribute("href", "/chat?savedItemId=saved_item_cloud9");
  await expect(page.getByText("Cloud 9 dinner shortlist")).toBeVisible();
  const settingsSurfaceChrome = await page
    .getByRole("heading", { name: "Recent chat history" })
    .locator("xpath=ancestor::section[1]")
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        borderRadius: style.borderRadius,
        boxShadow: style.boxShadow,
      };
    });
  expect(Number.parseFloat(settingsSurfaceChrome.borderRadius)).toBeLessThanOrEqual(10);
  expect(settingsSurfaceChrome.boxShadow).not.toContain("48px");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "test-results/issue-120-settings-desktop.png",
    fullPage: true,
  });

  profileSaveMode = "delayed";
  await page.getByLabel("Display name").fill("Alex in Siargao");
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await page.getByLabel("Display name").fill("Alex");
  const pendingSaveButton = page.getByRole("button", { name: "Saving trip brief" });
  await expect(pendingSaveButton).toBeDisabled();
  await pendingSaveButton.click({ force: true });
  await page.waitForTimeout(100);
  expect(patchPayloads).toHaveLength(1);
  expect(patchPayloads[0]).toMatchObject({ displayName: "Alex in Siargao" });
  await expect(page.getByRole("button", { name: "Save trip brief" })).toBeEnabled();
  await expect(page.getByLabel("Display name")).toHaveValue("Alex");
  await expect(page.getByText("You have unsaved changes")).toBeVisible();

  profileSaveMode = "success";
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await expect(page.getByText("Trip brief saved")).toBeVisible();
  expect(patchPayloads).toHaveLength(2);
  expect(patchPayloads[1]).toEqual({ displayName: "Alex" });
  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Alex");

  await page.getByLabel("Display name").fill("Alex in Siargao");
  await page.getByLabel("Add preferred area").fill("Pacifico");
  await page.getByLabel("Add preferred area").press("Enter");
  const removePacificoButton = page.getByRole("button", { name: "Remove Pacifico" });
  const removePacificoBox = await removePacificoButton.boundingBox();
  expect(removePacificoBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(removePacificoBox?.width ?? 0).toBeGreaterThanOrEqual(44);
  await removePacificoButton.click();
  await expect(page.getByLabel("Add preferred area")).toBeFocused();
  await page.getByLabel("Add preferred area").fill("Pacifico");
  await page.getByLabel("Add preferred area").press("Enter");
  await page.getByLabel("Current area").selectOption("Dapa");
  await page.getByLabel("Traveler or group type").selectOption("family_with_kids");
  await page.getByLabel("Transport mode").selectOption("van");
  await page.getByLabel("Maximum ride time in minutes").fill("45");
  await page.getByLabel("Budget level").selectOption("premium");
  await page.getByLabel("Weather preference").selectOption("flexible");
  const veganCheckbox = page.getByLabel("Vegan");
  const veganTargetBox = await veganCheckbox.locator("xpath=..").boundingBox();
  expect(veganTargetBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await veganCheckbox.check();
  await page.getByLabel("Gluten-free").check();
  await page.getByRole("button", { name: "Add Food", exact: true }).click();
  await page.getByLabel("Quiet sleep matters").check();
  await page.getByLabel("Accommodation").fill("Pacifico beach stay");
  await page.getByLabel("Trip notes").fill("Arriving in September");
  const marketingCheckbox = page.getByLabel("Send occasional Ask Siargao product updates");
  const marketingTargetBox = await marketingCheckbox.locator("xpath=..").boundingBox();
  expect(marketingTargetBox?.height ?? 0).toBeGreaterThanOrEqual(44);
  await marketingCheckbox.check();
  await expect(page.getByText("You have unsaved changes")).toBeVisible();

  profileSaveMode = "delayed";
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await page.getByLabel("Trip notes").fill("Arriving in October");
  await page.waitForTimeout(600);
  await expect(page.getByLabel("Trip notes")).toHaveValue("Arriving in October");
  await expect(page.getByText("You have unsaved changes")).toBeVisible();

  profileSaveMode = "invalid";
  await page.getByLabel("Surf ability").selectOption("advanced");
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await expect(page.locator("#profile-surf-ability-error")).toContainText("Choose a surf ability");
  await expect(page.getByLabel("Surf ability")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Surf ability")).toHaveAttribute(
    "aria-describedby",
    "profile-surf-ability-error",
  );

  profileSaveMode = "invalidConstraints";
  await page.getByLabel("Traveling with children").check();
  await page.getByRole("button", { name: "Save trip brief" }).click();
  const groupNeeds = page.getByRole("group", { name: "Group needs" });
  await expect(groupNeeds).toHaveAttribute("aria-invalid", "true");
  await expect(groupNeeds).toHaveAttribute("aria-describedby", "profile-durable-constraints-error");
  await expect(page.locator("#profile-durable-constraints-error")).toContainText(
    "Choose supported group needs",
  );
  await expect(page.getByLabel("Traveling with children")).toHaveAttribute("aria-invalid", "true");

  profileSaveMode = "invalidMultiValue";
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await expect(page.getByRole("button", { name: "Remove Food" })).toHaveAttribute(
    "aria-describedby",
    "profile-interests-error-item-1",
  );
  await expect(page.locator("#profile-interests-error-item-1")).toContainText(
    "Interests must be unique.",
  );
  await expect(page.getByRole("button", { name: "Remove Cloud 9" })).toHaveAttribute(
    "aria-describedby",
    "profile-preferred-areas-error-item-0",
  );
  await expect(page.getByLabel("Vegan")).toHaveAttribute(
    "aria-describedby",
    "profile-food-needs-error-item-0",
  );
  await expect(page.getByLabel("Gluten-free")).not.toHaveAttribute("aria-invalid", "true");

  profileSaveMode = "server";
  await page.getByLabel("Surf ability").selectOption("intermediate");
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await expect(page.getByText("Check your entries and try again.")).toBeVisible();
  await expect(page.getByLabel("Accommodation")).toHaveValue("Pacifico beach stay");
  await expect(page.getByLabel("Trip notes")).toHaveValue("Arriving in October");

  profileSaveMode = "network";
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await expect(
    page.getByText("Your changes are still here. Check your connection and try again."),
  ).toBeVisible();
  await expect(page.getByLabel("Trip notes")).toHaveValue("Arriving in October");
  await expect(page.getByLabel("Vegan")).toBeChecked();
  await expect(page.getByLabel("Gluten-free")).toBeChecked();
  await expect(page.getByText("Food", { exact: true })).toBeVisible();

  profileSaveMode = "success";
  await page.getByRole("button", { name: "Save trip brief" }).click();

  await expect(page.getByText("Trip brief saved")).toBeVisible();
  expect(patchPayload).toEqual({
    surfAbility: "intermediate",
    tripContext: {
      durableConstraints: ["rain_avoidance", "with_kids"],
      notes: "Arriving in October",
    },
  });
  for (const confirmedOrUnchangedField of [
    "displayName",
    "budgetLevel",
    "foodNeeds",
    "preferredAreas",
    "quietSleepPreference",
    "weatherPreference",
    "marketingConsent",
    "tripContext.accommodation",
    "tripContext.currentArea",
    "tripContext.dateRange",
    "tripContext.travelerType",
    "tripContext.transportMode",
    "tripContext.rideTimeLimitMinutes",
  ]) {
    expect(patchPayload).not.toHaveProperty(confirmedOrUnchangedField);
  }
  await page.getByLabel("Send occasional Ask Siargao product updates").check();
  await page.getByRole("button", { name: "Save consent" }).click();
  await expect(page.getByText("Marketing consent saved")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Alex in Siargao");
  await expect(page.getByText("Pacifico", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Trip notes")).toHaveValue("Arriving in October");
  await expect(page.getByLabel("Accommodation")).toHaveValue("Pacifico beach stay");
  await expect(page.getByLabel("Vegan")).toBeChecked();
  await expect(page.getByLabel("Gluten-free")).toBeChecked();
  await expect(page.getByLabel("Send occasional Ask Siargao product updates")).toBeChecked();

  await page.goto("/profile");
  await expect(page.getByRole("heading", { exact: true, name: "Current trip" })).toBeVisible();
  await expect(
    page.getByRole("heading", { exact: true, name: "Traveler preferences" }),
  ).toBeVisible();
  const travelerPreferencesLink = page.getByRole("link", { name: "Traveler preferences" });
  await travelerPreferencesLink.focus();
  await expect(travelerPreferencesLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(travelerPreferencesLink).toHaveAttribute("aria-current", "location");
  await expect(page.locator("#traveler-preferences")).toBeFocused();
  await page.screenshot({ path: "test-results/issue-114-trip-brief-desktop.png", fullPage: true });

  await page.setViewportSize({ width: 360, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({
    path: "test-results/issue-122-structured-controls-mobile-360.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  const has390HorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(has390HorizontalOverflow).toBe(false);
  await page.screenshot({
    path: "test-results/issue-122-structured-controls-mobile-390.png",
    fullPage: true,
  });
  await page.screenshot({
    path: "test-results/issue-120-settings-mobile-390.png",
    fullPage: true,
  });
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(page.getByLabel("Add preferred area")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save trip brief" })).toBeVisible();
  const hasZoomedHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasZoomedHorizontalOverflow).toBe(false);
  await page.screenshot({
    path: "test-results/issue-122-structured-controls-mobile-390-zoom-200.png",
    fullPage: true,
  });
});

test("manages privacy controls with deliberate confirmation and local cleanup after success", async ({
  page,
}) => {
  await enableProtectedUiHarness(page);
  const savedTripStorageKey = "ask-siargao:saved-trip:v1";
  const tripContextStorageKey = "ask-siargao:trip-context:v1";
  let privacyMode: "success" | "server" | "auth" = "success";
  let chatDeleted = false;
  let savedDeleted = false;
  let profile = {
    identity: {
      email: "privacy@example.com",
      firstName: "Privacy",
      lastName: "Traveler",
    },
    profile: {
      displayName: "Privacy Traveler",
      homeCountry: "Australia",
      travelStyle: "Quiet planning",
      budgetLevel: "mid_range",
      dietaryNotes: "",
      foodNeeds: [],
      accessibilityNotes: "",
      surfAbility: "intermediate",
      quietSleepPreference: false,
      weatherPreference: "flexible" as const,
      interests: ["surf"],
      preferredAreas: ["Cloud 9"],
      tripContext: {
        accommodation: "Cloud 9 private stay",
        currentArea: "Cloud 9",
        dateRange: "Aug 1 - 6",
        notes: "Keep the ferry note",
      },
      marketingConsent: false,
      createdAt: "2026-06-29T04:00:00.000Z",
      updatedAt: "2026-06-29T04:00:00.000Z",
    },
  };
  let savedTrips = {
    tripId: "saved_trip_privacy",
    items: [
      {
        id: "saved_item_privacy",
        kind: "place",
        title: "Private saved cafe",
        updatedAt: "2026-06-29T05:00:00.000Z",
      },
    ],
  };
  let chatThreads = {
    threads: [
      {
        id: "chat_thread_privacy",
        title: "Private cafe chat",
        updatedAt: "2026-06-29T05:00:00.000Z",
      },
    ],
  };

  await page.addInitScript(
    ({ savedTripStorageKey, tripContextStorageKey }) => {
      localStorage.setItem(
        savedTripStorageKey,
        JSON.stringify({
          tripId: "saved_trip_privacy",
          items: [{ id: "saved_item_privacy", title: "Private saved cafe" }],
          updatedAt: "2026-06-29T05:00:00.000Z",
        }),
      );
      localStorage.setItem(
        tripContextStorageKey,
        JSON.stringify({
          accommodation: "Browser private stay",
          dateRange: "Aug 1 - 6",
          travelerType: "Couple",
          nearbyArea: "Cloud 9",
        }),
      );
    },
    { savedTripStorageKey, tripContextStorageKey },
  );
  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as Partial<typeof profile.profile>;
      profile = { ...profile, profile: { ...profile.profile, ...patch } };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(profile) });
  });
  await page.route("**/api/chat/threads", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(chatThreads) });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(savedTrips) });
  });
  await page.route("**/api/me/privacy", async (route) => {
    const body = route.request().postDataJSON() as {
      action: string;
      confirmation: string;
    };
    if (privacyMode === "auth") {
      await route.fulfill({
        contentType: "application/json",
        status: 401,
        body: JSON.stringify({ error: "unauthenticated" }),
      });
      return;
    }
    if (privacyMode === "server") {
      await route.fulfill({
        contentType: "application/json",
        status: 500,
        body: JSON.stringify({ error: "privacy_action_failed" }),
      });
      return;
    }
    const expectedConfirmation =
      body.action === "delete_chat_history"
        ? "DELETE CHAT HISTORY"
        : body.action === "delete_saved_planning_data"
          ? "DELETE SAVED PLANNING DATA"
          : "CLEAR LOCATION CONTEXT";
    if (body.confirmation !== expectedConfirmation) {
      await route.fulfill({
        contentType: "application/json",
        status: 400,
        body: JSON.stringify({ error: "invalid_privacy_request" }),
      });
      return;
    }
    if (body.action === "delete_chat_history") {
      const status = chatDeleted ? "already_empty" : "success";
      chatDeleted = true;
      chatThreads = { threads: [] };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          action: body.action,
          status,
          counts: {
            chatRatingsDeleted: status === "success" ? 1 : 0,
            chatMessagesDeleted: 2,
            chatThreadsDeleted: status === "success" ? 1 : 0,
          },
          requestId: "privacy-chat",
        }),
      });
      return;
    }
    if (body.action === "delete_saved_planning_data") {
      const status = savedDeleted ? "already_empty" : "success";
      savedDeleted = true;
      savedTrips = { tripId: "saved_trip_privacy", items: [] };
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          action: body.action,
          status,
          counts: {
            savedTripsDeleted: status === "success" ? 1 : 0,
            savedItemsDeleted: status === "success" ? 1 : 0,
            sharedPlansInvalidated: status === "success" ? 1 : 0,
          },
          requestId: "privacy-saved",
        }),
      });
      return;
    }
    profile = {
      ...profile,
      profile: {
        ...profile.profile,
        tripContext: {
          dateRange: profile.profile.tripContext.dateRange,
          notes: profile.profile.tripContext.notes,
        } as typeof profile.profile.tripContext,
      },
    };
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        action: body.action,
        status: "success",
        counts: { profileFieldsCleared: 2 },
        profile,
        requestId: "privacy-location",
      }),
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings#privacy");
  await expect(page.getByRole("heading", { exact: true, name: "Privacy" })).toBeVisible();
  await expect(page.getByText("exact browser coordinates")).toBeVisible();
  await expect(page.getByText("global purge duration")).toBeVisible();
  await expect(page.getByText("secret-token-value")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );

  privacyMode = "server";
  await page.getByRole("button", { name: "Delete all saved planning data" }).click();
  let dialog = page.getByRole("dialog", { name: "Delete all saved planning data?" });
  await expect(
    dialog.getByRole("button", { name: "Delete all saved planning data" }),
  ).toBeDisabled();
  await dialog
    .getByLabel("Type DELETE SAVED PLANNING DATA to continue")
    .fill("DELETE SAVED PLANNING DATA");
  await dialog.getByRole("button", { name: "Delete all saved planning data" }).click();
  await expect(page.getByText("No local data was cleared.")).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}").items.length,
      savedTripStorageKey,
    ),
  ).toBe(1);

  privacyMode = "success";
  await dialog.getByRole("button", { name: "Delete all saved planning data" }).click();
  await expect(page.getByText("Deleted 1 saved item and invalidated 1 share link.")).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}").items.length,
      savedTripStorageKey,
    ),
  ).toBe(0);

  await page.getByRole("button", { name: "Delete all chat history" }).click();
  dialog = page.getByRole("dialog", { name: "Delete all chat history?" });
  await dialog.getByLabel("Type DELETE CHAT HISTORY to continue").fill("DELETE CHAT HISTORY");
  await dialog.getByRole("button", { name: "Delete all chat history" }).click();
  await expect(page.getByText("Deleted 1 chat thread from active records.")).toBeVisible();
  await page.getByRole("button", { name: "Delete all chat history" }).click();
  dialog = page.getByRole("dialog", { name: "Delete all chat history?" });
  await dialog.getByLabel("Type DELETE CHAT HISTORY to continue").fill("DELETE CHAT HISTORY");
  await dialog.getByRole("button", { name: "Delete all chat history" }).click();
  await expect(page.getByText("Chat history was already empty.")).toBeVisible();

  await page.getByLabel("Send occasional Ask Siargao product updates").check();
  await page.getByRole("button", { name: "Save consent" }).click();
  await expect(page.getByText("Marketing consent saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Send occasional Ask Siargao product updates")).toBeChecked();

  await page.getByRole("button", { name: "Clear stored location context" }).click();
  dialog = page.getByRole("dialog", { name: "Clear stored location context?" });
  await dialog.getByLabel("Type CLEAR LOCATION CONTEXT to continue").fill("CLEAR LOCATION CONTEXT");
  await dialog.getByRole("button", { name: "Clear stored location context" }).click();
  await expect(page.getByText("Stored area and accommodation context were cleared.")).toBeVisible();
  expect(
    await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "{}"),
      tripContextStorageKey,
    ),
  ).toMatchObject({ accommodation: "", nearbyArea: "Siargao Island", dateRange: "Aug 1 - 6" });
  await expect(page.getByText("Cloud 9 private stay")).toHaveCount(0);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.reload();
  await expect(page.getByRole("heading", { exact: true, name: "Privacy" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false,
  );
});

test("keeps privacy confirmations modal and preserves deterministic failure states", async ({
  page,
}) => {
  await enableProtectedUiHarness(page);
  let privacyMode: "auth" | "validation" | "network" | "pending" | "success" = "auth";
  let releasePending = () => {};
  const profile = {
    identity: { email: "privacy-states@example.com", firstName: "Privacy", lastName: "States" },
    profile: {
      displayName: "Privacy States",
      homeCountry: "Australia",
      travelStyle: "Quiet planning",
      budgetLevel: "mid_range" as const,
      dietaryNotes: "",
      foodNeeds: [],
      accessibilityNotes: "",
      surfAbility: "intermediate" as const,
      quietSleepPreference: false,
      weatherPreference: "flexible" as const,
      interests: ["surf"],
      preferredAreas: ["Cloud 9"],
      tripContext: { dateRange: "Aug 1 - 6" },
      marketingConsent: false,
      createdAt: "2026-06-29T04:00:00.000Z",
      updatedAt: "2026-06-29T04:00:00.000Z",
    },
  };

  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(profile) });
  });
  await page.route("**/api/chat/threads", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ threads: [] }) });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ tripId: null, items: [] }),
    });
  });
  await page.route("**/api/me/privacy", async (route) => {
    if (privacyMode === "auth") {
      await route.fulfill({
        contentType: "application/json",
        status: 401,
        body: JSON.stringify({ error: "unauthenticated" }),
      });
      return;
    }
    if (privacyMode === "validation") {
      await route.fulfill({
        contentType: "application/json",
        status: 400,
        body: JSON.stringify({ error: "invalid_privacy_request" }),
      });
      return;
    }
    if (privacyMode === "network") {
      await route.abort("failed");
      return;
    }
    if (privacyMode === "pending") {
      await new Promise<void>((resolve) => {
        releasePending = resolve;
      });
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        action: "delete_chat_history",
        status: "success",
        counts: { chatRatingsDeleted: 0, chatMessagesDeleted: 0, chatThreadsDeleted: 0 },
        requestId: "server-privacy-request",
      }),
    });
  });

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1280, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/settings#privacy");
    const trigger = page
      .getByRole("button", { name: "Delete all chat history", exact: true })
      .first();

    privacyMode = "auth";
    await trigger.click();
    let dialog = page.getByRole("dialog", { name: "Delete all chat history?" });
    const confirmationInput = dialog.getByRole("textbox");
    await expect(confirmationInput).toBeFocused();
    for (const control of [
      confirmationInput,
      dialog.getByRole("button", { name: "Cancel" }),
      dialog.getByRole("button", { name: "Delete all chat history", exact: true }),
    ]) {
      const box = await control.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
    }
    await dialog.getByLabel("Type DELETE CHAT HISTORY to continue").fill("DELETE CHAT HISTORY");
    await page.keyboard.press("Tab");
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      dialog.getByRole("button", { name: "Delete all chat history", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(confirmationInput).toBeFocused();
    await dialog.getByRole("button", { name: "Delete all chat history", exact: true }).click();
    await expect(
      page.getByText("Your session expired. Sign in again before changing privacy settings."),
    ).toBeVisible();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(trigger).toBeFocused();

    privacyMode = "validation";
    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Delete all chat history?" });
    await dialog.getByLabel("Type DELETE CHAT HISTORY to continue").fill("DELETE CHAT HISTORY");
    await dialog.getByRole("button", { name: "Delete all chat history", exact: true }).click();
    await expect(
      page.getByText("The confirmation did not match this privacy action. Try again."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    privacyMode = "network";
    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Delete all chat history?" });
    await dialog.getByLabel("Type DELETE CHAT HISTORY to continue").fill("DELETE CHAT HISTORY");
    await dialog.getByRole("button", { name: "Delete all chat history", exact: true }).click();
    await expect(
      page.getByText("Network error. Server data and local browser data were left unchanged."),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();

    privacyMode = "pending";
    await trigger.click();
    dialog = page.getByRole("dialog", { name: "Delete all chat history?" });
    const confirmButton = dialog.locator("button").nth(1);
    await dialog.getByLabel("Type DELETE CHAT HISTORY to continue").fill("DELETE CHAT HISTORY");
    await confirmButton.click();
    await expect(confirmButton).toHaveText("Deleting");
    await expect(confirmButton).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox").focus();

    await page.evaluate(() => {
      const backgroundTrigger = [...document.querySelectorAll("button")].find(
        (button) => button.textContent?.trim() === "Delete all chat history",
      );
      backgroundTrigger?.focus();
    });
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(() =>
        Array.from(document.body.children)
          .filter((element) => element.tagName !== "DIALOG")
          .every(
            (element) =>
              element instanceof HTMLElement &&
              element.inert &&
              element.getAttribute("aria-hidden") === "true",
          ),
      ),
    ).toBe(true);
    expect(await page.evaluate(() => document.activeElement?.closest("dialog") !== null)).toBe(
      true,
    );
    await expect(confirmButton).toBeDisabled();

    releasePending();
    await expect(page.getByText("Deleted 0 chat threads from active records.")).toBeVisible();
    await expect(trigger).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
  }
});

test("preserves untouched legacy multi-value tokens byte-for-byte on an unrelated save", async ({
  page,
}) => {
  await enableProtectedUiHarness(page);
  let patchPayload: Record<string, unknown> | null = null;
  let profile = {
    identity: {
      email: "legacy@example.com",
      firstName: "Legacy",
      lastName: "Traveler",
    },
    profile: {
      displayName: "Legacy",
      homeCountry: null,
      travelStyle: null,
      budgetLevel: "slow_travel",
      dietaryNotes: null,
      foodNeeds: ["vegan", "plant_forward_custom"],
      accessibilityNotes: null,
      surfAbility: "Ocean whisperer",
      quietSleepPreference: null,
      weatherPreference: null,
      interests: ["Surf, yoga", "  Food  "],
      preferredAreas: ["Cloud 9", "  Secret corner  "],
      tripContext: {
        travelerType: "Remote work retreat",
        durableConstraints: ["quiet_sleep", "legacy_low_ferry"],
      },
      marketingConsent: false,
      createdAt: "2026-06-29T04:00:00.000Z",
      updatedAt: "2026-06-29T04:00:00.000Z",
    },
  };

  await page.route("**/api/me/profile", async (route) => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON() as Partial<typeof profile.profile>;
      patchPayload = patch as Record<string, unknown>;
      profile = {
        ...profile,
        profile: { ...profile.profile, ...patch, updatedAt: "2026-06-29T05:00:00.000Z" },
      };
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(profile) });
  });

  await page.goto("/settings");
  await expect(page.getByText("Surf, yoga", { exact: true })).toBeVisible();
  await expect(page.getByText("Food", { exact: true })).toBeVisible();
  await expect(page.getByText("Secret corner", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Vegan")).toBeChecked();
  await expect(page.getByLabel("Legacy value: plant_forward_custom")).toBeChecked();
  await expect(page.getByLabel("Surf ability")).toHaveValue("Ocean whisperer");
  await expect(page.getByLabel("Budget level")).toHaveValue("slow_travel");
  await expect(page.getByLabel("Traveler or group type")).toHaveValue("Remote work retreat");
  await page.getByLabel("Display name").fill("Renamed traveler");
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await expect(page.getByText("Trip brief saved")).toBeVisible();

  expect(patchPayload).toEqual({ displayName: "Renamed traveler" });
  expect(profile.profile.interests).toEqual(["Surf, yoga", "  Food  "]);
  expect(profile.profile.preferredAreas).toEqual(["Cloud 9", "  Secret corner  "]);
  expect(profile.profile.foodNeeds).toEqual(["vegan", "plant_forward_custom"]);
  expect(profile.profile.tripContext.durableConstraints).toEqual([
    "quiet_sleep",
    "legacy_low_ferry",
  ]);
});

test("renders safe account identity across settings states and narrow layouts", async ({
  page,
}) => {
  await enableProtectedUiHarness(page);
  const longName = "María-Luisa Ngọc Nguyễn surf planning ".repeat(5).trim();
  let profileMode: "long" | "partial" | "server" | "anonymous" = "long";

  await page.route("**/api/me/profile", async (route) => {
    if (profileMode === "anonymous") {
      await route.fulfill({
        contentType: "application/json",
        status: 401,
        body: JSON.stringify({ error: "unauthenticated" }),
      });
      return;
    }
    if (profileMode === "server") {
      await route.fulfill({
        contentType: "application/json",
        status: 500,
        body: JSON.stringify({ error: "profile_load_failed" }),
      });
      return;
    }

    const profile = {
      identity:
        profileMode === "partial"
          ? { email: "partial@example.com", firstName: "Taylor", lastName: null }
          : { email: null, firstName: null, lastName: null },
      profile: {
        displayName: profileMode === "partial" ? null : longName,
        homeCountry: null,
        travelStyle: null,
        budgetLevel: null,
        dietaryNotes: null,
        foodNeeds: [],
        accessibilityNotes: null,
        surfAbility: null,
        quietSleepPreference: null,
        weatherPreference: null,
        interests: [],
        preferredAreas: [],
        tripContext: {},
        marketingConsent: false,
        createdAt: null,
        updatedAt: null,
      },
    };
    const responseBody = JSON.stringify(profile);
    expect(responseBody).not.toContain("user_safe_identity");
    expect(responseBody).not.toContain("clerkUserId");
    await route.fulfill({ contentType: "application/json", body: responseBody });
  });
  await page.route("**/api/chat/threads", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ threads: [] }) });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });

  await page.goto("/settings");
  const accountPanel = page.locator("#account");
  await expect(accountPanel).toContainText(longName);
  await expect(accountPanel).toContainText("Email unavailable");
  await expect(accountPanel).toContainText("Signed in");
  await expect(accountPanel.getByRole("button", { name: "Manage account" })).toBeVisible();
  await expect(page.getByText("Clerk user ID")).toHaveCount(0);
  await expect(page.getByText("user_safe_identity")).toHaveCount(0);
  await expect(
    page.getByText("unavailable+user_safe_identity@clerk.ask-siargao.local"),
  ).toHaveCount(0);

  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await accountPanel.getByRole("button", { name: "Manage account" }).focus();
    await expect(accountPanel.getByRole("button", { name: "Manage account" })).toBeFocused();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  }
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  await expect(accountPanel.getByRole("button", { name: "Manage account" })).toBeVisible();
  const zoomedOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(zoomedOverflow).toBe(false);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "";
  });

  profileMode = "partial";
  await page.goto("/profile");
  await expect(page.locator("#account")).toContainText("Taylor");
  await expect(page.locator("#account")).toContainText("partial@example.com");
  await expect(page.getByText("Clerk user ID")).toHaveCount(0);

  profileMode = "server";
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings unavailable" })).toBeVisible();
  await expect(page.getByText(longName)).toHaveCount(0);
  await expect(page.getByText("partial@example.com")).toHaveCount(0);

  profileMode = "anonymous";
  await page.goto("/settings");
  await expect(
    page.getByRole("heading", { name: "Sign in to manage your settings" }),
  ).toBeVisible();
  await expect(page.getByText("Taylor")).toHaveCount(0);
});

test("renders Trip Pass account states and checkout return handling", async ({ page }) => {
  await enableProtectedUiHarness(page);
  let passMode: "free" | "pending" | "active" | "expired" | "unavailable" | "fetch_error" = "free";
  let checkoutCalls = 0;
  let releaseCheckout: (() => void) | undefined;
  const checkoutPending = new Promise<void>((resolve) => {
    releaseCheckout = resolve;
  });

  await page.route("**/api/me/profile", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(settingsProfile()),
    });
  });
  await page.route("**/api/chat/threads", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ threads: [] }) });
  });
  await page.route("**/api/trips/saved", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/me/trip-pass/checkout", async (route) => {
    checkoutCalls += 1;
    await checkoutPending;
    passMode = "pending";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        status: "started",
        checkoutUrl: "/settings?trip_pass_checkout=return#pass",
      }),
    });
  });
  await page.route("**/api/me/trip-pass", async (route) => {
    if (passMode === "fetch_error") {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "trip_pass_status_unavailable" }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(settingsTripPass(passMode)),
    });
  });

  await page.goto("/settings#pass");
  const passPanel = page.locator("#pass");
  const refreshPassPanel = async () => {
    await passPanel.getByRole("button", { name: "Refresh" }).click();
  };
  await expect(passPanel).toContainText("Free travel answers");
  await expect(passPanel).toContainText("Free travel answers reset every seven days.");
  const checkoutButton = passPanel.getByRole("button", { name: /Start checkout|Starting/ });
  await checkoutButton.click();
  await expect(checkoutButton).toBeDisabled();
  await expect(checkoutButton).toContainText("Starting");
  await expect.poll(() => checkoutCalls).toBe(1);
  releaseCheckout?.();
  await page.waitForURL("**/settings?trip_pass_checkout=return#pass");
  await expect(passPanel).toContainText("Checkout is waiting for confirmation");
  await expect(passPanel).toContainText("Payment is being confirmed");

  passMode = "active";
  await page.goto("/settings#pass");
  await expect(passPanel).toContainText("Trip Pass is active");
  await expect(passPanel).toContainText("Expires 18 Jul");
  await expect(passPanel).toContainText("Travel answers are near the limit: 20 left.");
  await expect(passPanel).not.toContainText("Live refreshes");
  await expect(passPanel).not.toContainText("Route lookups");
  await expect(passPanel.getByRole("button", { name: "Start checkout" })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/trip-pass-settings-desktop-active.png",
    fullPage: true,
  });

  passMode = "expired";
  await refreshPassPanel();
  await expect(passPanel).toContainText("Trip Pass has expired");
  await expect(passPanel).toContainText("Expired 3 Jul");

  passMode = "unavailable";
  await refreshPassPanel();
  await expect(passPanel).toContainText("Trip Pass checkout is unavailable");
  await expect(passPanel).toContainText("Checkout cannot start right now.");

  passMode = "fetch_error";
  await refreshPassPanel();
  await expect(passPanel).toContainText("Trip Pass status is temporarily unavailable");
  await expect(passPanel).toContainText("Status could not be refreshed.");

  await page.setViewportSize({ width: 390, height: 844 });
  passMode = "active";
  await page.goto("/settings#pass");
  await refreshPassPanel();
  await expect(passPanel).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: "test-results/trip-pass-settings-mobile-active.png",
    fullPage: true,
  });
});

function settingsProfile() {
  return {
    identity: {
      email: "trip-pass@example.com",
      firstName: "Trip",
      lastName: "Traveler",
    },
    profile: {
      displayName: "Trip Traveler",
      homeCountry: null,
      travelStyle: null,
      budgetLevel: null,
      dietaryNotes: null,
      foodNeeds: [],
      accessibilityNotes: null,
      surfAbility: null,
      quietSleepPreference: null,
      weatherPreference: null,
      interests: [],
      preferredAreas: [],
      tripContext: {},
      marketingConsent: false,
      createdAt: null,
      updatedAt: null,
    },
  };
}

function settingsTripPass(status: "free" | "pending" | "active" | "expired" | "unavailable") {
  const isPaidState = status === "active" || status === "expired";
  const allowances =
    status === "active"
      ? [{ meterType: "chat_message", used: 130, limit: 150, remaining: 20, warning: true }]
      : [{ meterType: "chat_message", used: 0, limit: 10, remaining: 10, warning: true }];

  return {
    status,
    product: {
      label: "Siargao Trip Pass",
      durationDays: 14,
    },
    validity: {
      startsAt: isPaidState ? "2026-07-04T08:00:00.000Z" : null,
      expiresAt:
        status === "active"
          ? "2026-07-18T08:00:00.000Z"
          : status === "expired"
            ? "2026-07-03T08:00:00.000Z"
            : null,
    },
    allowances,
    attention: {
      lowChatMessages: status === "active",
      expiresSoon: false,
    },
    checkout: {
      status: status === "unavailable" || status === "active" ? "unavailable" : "available",
      reason: status === "unavailable" ? "checkout_unavailable" : null,
    },
    actions: {
      startCheckout: status !== "active" && status !== "unavailable",
    },
  };
}

test("renders public human, markdown, JSON, sitemap, and llms surfaces", async ({ page }) => {
  await page.goto("/accommodations/example-surf-stay");

  await expect(page.getByRole("heading", { exact: true, name: "Example Surf Stay" })).toBeVisible();
  await expect(page.getByText("public_ev_example_surf_stay_area", { exact: true })).toBeVisible();
  await expect(page.getByText(/Room-level noise, private bookings/i)).toBeVisible();

  const markdown = await page.request.get("/accommodations/example-surf-stay/llm.md");
  expect(await markdown.text()).toContain(
    "Example Surf Stay is listed as a General Luna accommodation.",
  );

  const json = await page.request.get("/api/public/accommodations/example-surf-stay.json");
  const body = await json.json();
  expect(body.claims[0].claim).toBe("Example Surf Stay is listed as a General Luna accommodation.");

  const sitemap = await page.request.get("/sitemap.xml");
  const sitemapText = await sitemap.text();
  expect(sitemapText).toContain("<loc>https://www.asksiargao.com/</loc>");
  expect(sitemapText).toContain("<loc>https://www.asksiargao.com/accommodations</loc>");
  expect(sitemapText).toContain(
    "<loc>https://www.asksiargao.com/accommodations/example-surf-stay</loc>",
  );

  await page.goto("/accommodations");
  await expect(page.getByRole("heading", { name: "Where to stay in Siargao" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Example Surf Stay/ })).toBeVisible();

  const llms = await page.request.get("/llms.txt");
  const llmsText = await llms.text();
  expect(llmsText.startsWith("# Ask Siargao\n")).toBe(true);
  expect(llmsText).toContain("[Public entities](https://www.asksiargao.com/api/public/entities)");
  expect(llmsText).toContain(
    "[Complete Siargao Travel Guide](https://www.asksiargao.com/guides/complete-siargao-travel-guide)",
  );
});

test("tracks a planning guide view through its Reality Check handoff", async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  await page.route("**/api/observability/events", async (route) => {
    events.push(route.request().postDataJSON());
    await route.fulfill({ body: JSON.stringify({ status: "accepted" }), status: 200 });
  });

  await page.goto("/guides/siargao-5-day-itinerary");
  await expect
    .poll(() => events.find((event) => event.name === "planning_guide_viewed"))
    .toMatchObject({
      guideSlug: "siargao-5-day-itinerary",
      surface: "planning_guide",
    });

  await page.locator('[data-reality-check-surface="panel"]').first().click();
  await expect(page).toHaveURL(/\/chat\?prompt=/u);
  await expect
    .poll(() => events.find((event) => event.name === "planning_guide_reality_check_clicked"))
    .toMatchObject({
      action: "weather",
      guideSlug: "siargao-5-day-itinerary",
      surface: "panel",
    });

  const clickEvent = events.find((event) => event.name === "planning_guide_reality_check_clicked");
  const viewJourneyIds = events
    .filter((event) => event.name === "planning_guide_viewed")
    .map((event) => event.journeyId);
  expect(viewJourneyIds).toHaveLength(1);
  expect(viewJourneyIds).toContain(clickEvent?.journeyId);
  expect(JSON.stringify(events)).not.toContain("Adapt this guide");
});

test("publishes crawl rules that keep private audit surfaces out of indexes", async ({ page }) => {
  const robots = await page.request.get("/robots.txt");
  const robotsText = await robots.text();

  expect(robotsText).toContain("Disallow: /audits/");
  expect(robotsText).toContain("Disallow: /admin/");
  expect(robotsText).toContain("Sitemap: https://www.asksiargao.com/sitemap.xml");

  const report = await page.goto("/audits/audit_123/report");
  expect(report?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.getByRole("heading", { name: "Siargao trip risk audit" })).toHaveCount(0);
});

test("allows same-origin browser geolocation while blocking unrelated sensitive APIs", async ({
  page,
}) => {
  const response = await page.request.get("/chat");
  const permissionsPolicy = response.headers()["permissions-policy"];

  expect(permissionsPolicy).toContain("geolocation=(self)");
  expect(permissionsPolicy).toContain("camera=()");
  expect(permissionsPolicy).toContain("microphone=()");
});

for (const width of [390, 768, 1024, 1366]) {
  test(`does not create horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /live, local Siargao travel advice/i }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}

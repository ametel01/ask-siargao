import { expect, test } from "@playwright/test";

test("renders the Ask Siargao landing shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /plan the island around your real constraints/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask in chat" })).toHaveAttribute("href", "/chat");
  await expect(page.getByLabel("Example Ask Siargao prompt")).toContainText(
    "What should we do today if rain hits Cloud 9?",
  );
  await expect(
    page.getByRole("heading", { name: "Planning inputs available in chat" }),
  ).toBeAttached();
  await expect(page.getByText("Weather", { exact: true })).toBeVisible();
  await expect(page.getByText("Places", { exact: true })).toBeVisible();
  await expect(page.getByText("Local caveats", { exact: true })).toBeVisible();
  await expect(page.getByText("Checked on request")).toHaveCount(2);
  await expect(page.locator("svg.lucide-check")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Choose the right base" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Make the weather call" })).toBeVisible();
  await expect(
    page.getByLabel("Example Ask Siargao prompt").getByRole("link", { name: "Ask Siargao" }),
  ).toHaveAttribute("href", /\/chat\?prompt=/);
  await expect(page.getByRole("link", { name: "Quiet base" })).toHaveAttribute(
    "href",
    /\/chat\?prompt=Where%20should%20we%20stay/,
  );
});

test("exposes real desktop navigation in keyboard reading order", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Landing page" });
  await expect(navigation).toBeVisible();
  for (const [label, target] of [
    ["Start a question", "#start-a-question"],
    ["Planning inputs", "#planning-inputs"],
    ["Plan smarter", "#plan-smarter"],
  ] as const) {
    const link = navigation.getByRole("link", { name: label });
    await expect(link).toHaveAttribute("href", target);
    await expect(page.locator(target)).toHaveCount(1);
  }

  const expectedTabOrder = [
    { link: page.getByRole("link", { name: "Ask Siargao home" }), color: "rgb(142, 230, 216)" },
    {
      link: navigation.getByRole("link", { name: "Start a question" }),
      color: "rgb(142, 230, 216)",
    },
    {
      link: navigation.getByRole("link", { name: "Planning inputs" }),
      color: "rgb(142, 230, 216)",
    },
    {
      link: navigation.getByRole("link", { name: "Plan smarter" }),
      color: "rgb(142, 230, 216)",
    },
    { link: page.getByRole("link", { name: "Ask in chat" }), color: "rgb(142, 230, 216)" },
    {
      link: page
        .getByLabel("Example Ask Siargao prompt")
        .getByRole("link", { name: "Ask Siargao" }),
      color: "rgb(10, 111, 103)",
    },
    { link: page.getByRole("link", { name: "Quiet base" }), color: "rgb(142, 230, 216)" },
    { link: page.getByRole("link", { name: "Food route" }), color: "rgb(142, 230, 216)" },
    {
      link: page.getByRole("link", { name: "Ask about this" }).nth(0),
      color: "rgb(10, 111, 103)",
    },
    {
      link: page.getByRole("link", { name: "Ask about this" }).nth(1),
      color: "rgb(10, 111, 103)",
    },
  ];

  for (const { color, link } of expectedTabOrder) {
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    const outline = await link.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        color: style.outlineColor,
        style: style.outlineStyle,
        width: style.outlineWidth,
      };
    });
    expect(outline).toEqual({ color, style: "solid", width: "3px" });
  }
});

test("landing prompt actions preserve exact chat handoff without submitting", async ({ page }) => {
  const actions = [
    {
      link: () =>
        page.getByLabel("Example Ask Siargao prompt").getByRole("link", { name: "Ask Siargao" }),
      prompt: "What should we do today if rain hits Cloud 9?",
    },
    {
      link: () => page.getByRole("link", { name: "Quiet base" }),
      prompt:
        "Where should we stay in Siargao if we want quiet sleep, surf access, and easy dinner options?",
    },
    {
      link: () =>
        page
          .getByRole("article")
          .filter({ has: page.getByRole("heading", { name: "Make the weather call" }) })
          .getByRole("link", { name: "Ask about this" }),
      prompt: "Build a Siargao plan for today that adapts if rain gets heavy around Cloud 9.",
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
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 1000 },
  { name: "wide-1920", width: 1920, height: 1080 },
] as const) {
  test(`landing remains intentional and overflow-free at ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("heading", { name: /plan the island around your real constraints/i }),
    ).toBeVisible();
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).map((image) => image.decode().catch(() => {})));
    });

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await expect(
      page.getByLabel("Example Ask Siargao prompt").getByRole("link", { name: "Ask Siargao" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Plan smarter in Siargao" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Landing page" })).toBeVisible({
      visible: viewport.width >= 1024,
    });
    await page.screenshot({
      fullPage: true,
      path: `test-results/issue-110-landing-${viewport.name}.png`,
    });
  });
}

test("landing remains usable at a 200 percent zoom equivalent with reduced motion", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 720, height: 900 });
  await page.goto("/");

  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  for (const link of [
    page.getByRole("link", { name: "Ask in chat" }),
    page.getByLabel("Example Ask Siargao prompt").getByRole("link", { name: "Ask Siargao" }),
    page.getByRole("link", { name: "Quiet base" }),
    page.getByRole("link", { name: "Food route" }),
  ]) {
    await expect(link).toBeVisible();
    const box = await link.boundingBox();
    expect(box).not.toBeNull();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(721);
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
});

test("shows processing state after checkout return", async ({ page }) => {
  await page.goto("/audits/audit_123/status?state=awaiting_payment");

  await expect(
    page.getByRole("heading", { name: "Waiting for Stripe confirmation" }),
  ).toBeVisible();
  await expect(page.getByText(/does not unlock the report/i)).toBeVisible();
  await expect(page.getByText(/Verified Stripe webhook marks the audit paid/i)).toBeVisible();
});

test("renders final report with evidence and limitations", async ({ page }) => {
  await page.goto("/audits/demo/report");

  await expect(page.getByRole("heading", { name: "Siargao trip risk audit" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top risks" })).toBeVisible();
  await expect(page.getByText("ev_route", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Notes and limitations" })).toBeVisible();
  await expect(page.getByText(/Exact room noise level is not verified/i)).toBeVisible();
});

test("renders local admin diagnostics without leaking sample secrets", async ({ page }) => {
  await page.setExtraHTTPHeaders({
    "x-admin-token": process.env.ADMIN_ACCESS_TOKEN ?? "replace-me",
  });
  await page.goto("/admin/diagnostics");

  await expect(page.getByRole("heading", { name: "Audit diagnostics" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Blocked audits" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "audit_blocked_001" }).first()).toBeVisible();
  await expect(page.getByText("Weather source").first()).toBeVisible();
  await expect(page.getByText("traveler@example.com")).toHaveCount(0);
  await expect(page.getByText(/sk_test_should_not_render/i)).toHaveCount(0);
});

test("edits profile details and reloads the persisted values", async ({ page }) => {
  let patchPayload: Record<string, unknown> | null = null;
  let profileSaveMode: "success" | "delayed" | "invalid" | "invalidConstraints" | "server" =
    "success";
  let profile = {
    identity: {
      userId: "user_e2e_profile",
      email: "traveler@example.com",
      firstName: "Alex",
      lastName: "Traveler",
      imageUrl: null,
    },
    profile: {
      displayName: "Alex",
      homeCountry: "Australia",
      travelStyle: "Surf mornings",
      budgetLevel: "mid_range",
      dietaryNotes: "",
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
      if (profileSaveMode === "server") {
        await route.fulfill({
          contentType: "application/json",
          status: 500,
          body: JSON.stringify({ error: "profile_save_failed" }),
        });
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
            userId: "user_e2e_profile",
            title: "Cloud 9 quiet sleep",
            lastMessageAt: "2026-06-29T05:00:00.000Z",
            updatedAt: "2026-06-29T05:00:00.000Z",
          },
          {
            id: "chat_thread_ferry",
            userId: "user_e2e_profile",
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
  await expect(page.getByRole("heading", { exact: true, name: "Privacy" })).toBeVisible();
  await expect(page.getByRole("heading", { exact: true, name: "Pass" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent chat history" })).toBeVisible();
  await expect(page.getByText("2 private threads")).toBeVisible();
  await expect(page.getByText("Cloud 9 quiet sleep")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Saved planning items" })).toBeVisible();
  await expect(page.getByText("2 saved items")).toBeVisible();
  await expect(page.getByText("Cloud 9 dinner shortlist")).toBeVisible();

  await page.getByLabel("Display name").fill("Alex in Siargao");
  await page.getByLabel("Preferred areas").fill("Cloud 9, Pacifico");
  await page.getByLabel("Accommodation").fill("Pacifico beach stay");
  await page.getByLabel("Trip notes").fill("Arriving in September");
  await page.getByLabel("Send occasional Ask Siargao product updates").check();
  await expect(page.getByText("You have unsaved changes")).toBeVisible();

  profileSaveMode = "delayed";
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await page.getByLabel("Trip notes").fill("Arriving in October");
  await page.waitForTimeout(600);
  await expect(page.getByLabel("Trip notes")).toHaveValue("Arriving in October");
  await expect(page.getByText("You have unsaved changes")).toBeVisible();

  profileSaveMode = "invalid";
  await page.getByLabel("Surf ability").fill("x".repeat(81));
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

  profileSaveMode = "server";
  await page.getByLabel("Surf ability").fill("Intermediate");
  await page.getByRole("button", { name: "Save trip brief" }).click();
  await expect(page.getByText("Check your entries and try again.")).toBeVisible();
  await expect(page.getByLabel("Accommodation")).toHaveValue("Pacifico beach stay");
  await expect(page.getByLabel("Trip notes")).toHaveValue("Arriving in October");

  profileSaveMode = "success";
  await page.getByRole("button", { name: "Save trip brief" }).click();

  await expect(page.getByText("Trip brief saved")).toBeVisible();
  expect(patchPayload).toMatchObject({
    surfAbility: "Intermediate",
    weatherPreference: "avoid_rain",
    tripContext: {
      accommodation: "Pacifico beach stay",
      dateRange: "Aug 1 - 6",
      currentArea: "Cloud 9",
      travelerType: "Couple",
      transportMode: "scooter",
      rideTimeLimitMinutes: 25,
      durableConstraints: ["rain_avoidance", "with_kids"],
      notes: "Arriving in October",
    },
  });
  expect(patchPayload).not.toHaveProperty("quietSleepPreference");

  await page.reload();
  await expect(page.getByLabel("Display name")).toHaveValue("Alex in Siargao");
  await expect(page.getByLabel("Preferred areas")).toHaveValue("Cloud 9, Pacifico");
  await expect(page.getByLabel("Trip notes")).toHaveValue("Arriving in October");
  await expect(page.getByLabel("Accommodation")).toHaveValue("Pacifico beach stay");
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

  await page.setViewportSize({ width: 195, height: 844 });
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({
    path: "test-results/issue-114-trip-brief-mobile-200.png",
    fullPage: true,
  });
});

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
  expect(await sitemap.text()).toContain("/accommodations/example-surf-stay");

  const llms = await page.request.get("/llms.txt");
  expect(await llms.text()).toContain("/api/public/entities");
});

test("publishes crawl rules that keep private audit surfaces out of indexes", async ({ page }) => {
  const robots = await page.request.get("/robots.txt");
  const robotsText = await robots.text();

  expect(robotsText).toContain("Disallow: /audits/");
  expect(robotsText).toContain("Disallow: /admin/");

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
      page.getByRole("heading", { name: /plan the island around your real constraints/i }),
    ).toBeVisible();

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}

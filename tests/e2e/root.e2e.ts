import { expect, test } from "@playwright/test";

test("renders the Ask Siargao landing shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /ask siargao anything about your trip/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /ask a trip question/i })).toHaveAttribute(
    "href",
    "/chat",
  );
  await expect(page.getByLabel("Example Ask Siargao prompt")).toContainText(
    "Staying near Cloud 9 for 10 days",
  );
  await expect(page.getByRole("heading", { name: "Planning checks for Siargao" })).toBeVisible();
  await expect(page.getByText("Start with a real trip constraint")).toBeVisible();
  await expect(page.getByText("GPT-backed answers", { exact: true })).toBeVisible();
  await expect(page.getByText("Weather snapshot support")).toBeVisible();
  await expect(page.getByText("Live local data")).toHaveCount(0);
  await expect(page.getByText("Freshness + confidence shown")).toHaveCount(0);
  await expect(page.getByText("Updated 12 min ago")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Choose the right base" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Make the weather call" })).toBeVisible();
  await expect(
    page.getByLabel("Example Ask Siargao prompt").getByRole("link", { name: /Ask Siargao/i }),
  ).toHaveAttribute("href", /\/chat\?prompt=/);
  await expect(page.getByRole("link", { name: "Cloud 9 quiet sleep" })).toHaveAttribute(
    "href",
    /\/chat\?prompt=Is%20my%20accommodation/,
  );
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
  await page.getByLabel("Add preferred area").fill("Pacifico");
  await page.getByLabel("Add preferred area").press("Enter");
  await page.getByRole("button", { name: "Remove Pacifico" }).click();
  await expect(page.getByLabel("Add preferred area")).toBeFocused();
  await page.getByLabel("Add preferred area").fill("Pacifico");
  await page.getByLabel("Add preferred area").press("Enter");
  await page.getByLabel("Current area").selectOption("Dapa");
  await page.getByLabel("Traveler or group type").selectOption("family_with_kids");
  await page.getByLabel("Transport mode").selectOption("van");
  await page.getByLabel("Maximum ride time in minutes").fill("45");
  await page.getByLabel("Budget level").selectOption("premium");
  await page.getByLabel("Weather preference").selectOption("flexible");
  await page.getByLabel("Vegan").check();
  await page.getByLabel("Gluten-free").check();
  await page.getByRole("button", { name: "Add Food", exact: true }).click();
  await page.getByLabel("Quiet sleep matters").check();
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
  expect(patchPayload).toMatchObject({
    budgetLevel: "premium",
    foodNeeds: ["vegan", "gluten_free"],
    surfAbility: "intermediate",
    quietSleepPreference: true,
    weatherPreference: "flexible",
    tripContext: {
      accommodation: "Pacifico beach stay",
      dateRange: "Aug 1 - 6",
      currentArea: "Dapa",
      travelerType: "family_with_kids",
      transportMode: "van",
      rideTimeLimitMinutes: 45,
      durableConstraints: ["rain_avoidance", "with_kids"],
      notes: "Arriving in October",
    },
  });

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

test("preserves untouched legacy multi-value tokens byte-for-byte on an unrelated save", async ({
  page,
}) => {
  let patchPayload: Record<string, unknown> | null = null;
  let profile = {
    identity: {
      userId: "user_e2e_legacy_tokens",
      email: "legacy@example.com",
      firstName: "Legacy",
      lastName: "Traveler",
      imageUrl: null,
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
    await page.goto("/");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  });
}

import { expect, test } from "@playwright/test";

test("renders the Ask Siargao landing shell", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /ask siargao anything about your trip/i }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /open assistant/i })).toHaveAttribute(
    "href",
    "/chat",
  );
  await expect(page.getByLabel("Example Ask Siargao prompt")).toContainText(
    "I'm staying near Cloud 9 for 10 days",
  );
  await expect(page.getByRole("heading", { name: "Planning checks for Siargao" })).toBeVisible();
  await expect(page.getByText("Try asking about...")).toBeVisible();
  await expect(page.getByText("GPT-backed answers", { exact: true })).toBeVisible();
  await expect(page.getByText("Weather snapshot support")).toBeVisible();
  await expect(page.getByText("Live local data")).toHaveCount(0);
  await expect(page.getByText("Freshness + confidence shown")).toHaveCount(0);
  await expect(page.getByText("Updated 12 min ago")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Find the right areas" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Weather-aware planning" })).toBeVisible();
  await expect(
    page.getByLabel("Example Ask Siargao prompt").getByRole("link", { name: /Ask Siargao/i }),
  ).toHaveAttribute("href", /\/chat\?prompt=/);
  await expect(page.getByRole("link", { name: "quiet hotel?" })).toHaveAttribute(
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

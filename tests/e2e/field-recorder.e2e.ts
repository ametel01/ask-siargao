import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const harnessHeaders = {
  "x-ask-siargao-protected-ui-harness": "1",
  "x-ask-siargao-protected-ui-harness-token":
    "ask-siargao-playwright-protected-ui-harness-token-2026",
};

const observationFields = [
  ["identity", "Displayed name"],
  ["opening_signal", "Opening state"],
  ["price", "Pricing unit"],
  ["route_duration", "Origin Subject"],
  ["route_wait", "Wait (seconds)"],
  ["road_condition", "Surface"],
  ["facility", "Facility state"],
  ["accessibility", "Accessibility feature"],
  ["payment_method", "Attempt outcome"],
  ["connectivity", "Measurement 3"],
  ["power", "Socket test permission"],
  ["crowd_snapshot", "Count boundary"],
  ["noise_snapshot", "Measurement position"],
  ["weather_condition", "Weather condition"],
  ["tide_context", "Shoreline state"],
  ["menu_item", "Dietary disclosure basis"],
  ["service_status", "Service state"],
  ["contact_channel", "Verification method"],
  ["local_caveat", "Local warning"],
] as const;

async function openCapture(page: import("@playwright/test").Page) {
  await page.setExtraHTTPHeaders(harnessHeaders);
  await page.goto("/operator/field/capture");
  await page.getByRole("button", { name: "Review safety and eligibility" }).click();
  for (const label of [
    "The route and site are safe now",
    "Access is currently allowed",
    "Required eligibility evidence is still valid",
  ]) {
    await page.getByLabel(label).check();
  }
  await page.getByRole("button", { name: "Safety confirmed — start Visit" }).click();
  await page.getByRole("button", { name: "Start Visit and pin this build" }).click();
  await page.getByRole("button", { name: "Capture evidence" }).click();
}

test("runs the keyboard-operable recorder sequence with persistent semantic status", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders(harnessHeaders);
  await page.goto("/operator/field/capture");

  await expect(page.getByRole("heading", { level: 1, name: "Evidence station" })).toBeVisible();
  await expect(page.getByLabel("Assignment status and sequence")).toBeVisible();
  await expect(page.locator('[aria-current="step"]')).toContainText("Briefing");
  await expect(page.locator("#field-recorder-scroll-owner")).toHaveCount(1);
  await expect(page.getByText("Saved durably")).toBeVisible();
  await expect(page.getByText("Current build pinned")).toBeVisible();
  await expect(page.getByText("available", { exact: false }).last()).toBeVisible();

  const continueButton = page.getByRole("button", { name: "Review safety and eligibility" });
  await continueButton.focus();
  await continueButton.press("Enter");
  await expect(
    page.getByRole("heading", { level: 2, name: "Confirm safety and eligibility" }),
  ).toBeFocused();

  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});

test("exposes every protocol Observation Kind through typed, controlled inputs", async ({
  page,
}) => {
  await openCapture(page);

  const picker = page.getByLabel("Protocol Observation Kind");
  for (const [kind, field] of observationFields) {
    await picker.selectOption(kind);
    await expect(
      page.getByText(
        `${kind.replaceAll("_", " ").replace(/^./u, (letter) => letter.toUpperCase())} value`,
      ),
    ).toBeVisible();
    await expect(
      field === "Measurement 3"
        ? page.getByRole("group", { name: field })
        : page.getByLabel(field).first(),
    ).toBeVisible();
  }

  await expect(page.getByText("JSON", { exact: false })).toHaveCount(0);
  await expect(page.locator('input[name="conditions"][type="text"]')).toHaveCount(0);
  await expect(page.locator('input[name="unit"][type="text"]')).toHaveCount(0);
});

test("shows every governed record branch and all eight Capture Exception reasons", async ({
  page,
}) => {
  await openCapture(page);

  const branches = [
    ["Route run", "Record a Route Run"],
    ["Source statement", "Record a Source Statement"],
    ["Translation", "Add a Statement Translation"],
    ["Photo or scan", "Add Photo or Scan"],
    ["Capture exception", "Record a Capture Exception"],
    ["Schema gap", "Record a Schema Gap"],
  ] as const;
  for (const [button, heading] of branches) {
    await page.getByRole("button", { name: button, exact: true }).click();
    await expect(page.getByRole("heading", { level: 3, name: heading })).toBeVisible();
  }

  await page.getByRole("button", { name: "Capture exception", exact: true }).click();
  const reason = page.getByLabel("Exception reason");
  await expect(reason.locator("option")).toHaveCount(8);
  for (const value of [
    "access_denied",
    "unsafe_conditions",
    "permission_declined",
    "subject_unavailable",
    "equipment_failure",
    "eligibility_changed",
    "interrupted",
    "not_applicable",
  ]) {
    await expect(reason.locator(`option[value="${value}"]`)).toHaveCount(1);
  }

  await page.getByRole("button", { name: "Observation", exact: true }).click();
  await page.waitForTimeout(400);
  const accessibility = await new AxeBuilder({ page }).include("main").analyze();
  expect(accessibility.violations).toEqual([]);
});

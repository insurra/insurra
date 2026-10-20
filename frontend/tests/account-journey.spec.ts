import { expect, test } from "@playwright/test";
import { newAccountSession } from "./helpers/workspace";

test("new account consents once, completes onboarding once, then follows document tour", async ({
  page,
}) => {
  const { token } = await newAccountSession(page);
  const headers = { Authorization: `Bearer ${token}` };

  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: "Before We Get Started" })).toBeVisible();
  const consentChoices = page.getByLabel("I agree");
  await consentChoices.nth(0).check();
  await consentChoices.nth(1).check();
  await page.getByRole("button", { name: /Agree & Continue/ }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByLabel("What brings you here?")).toBeVisible();
  await expect(page.getByText(/never your full birth date/i)).toHaveCount(0);
  await page.getByRole("button", { name: "Continue to Situation" }).click();
  await expect(page.getByLabel("Age range (optional)")).toBeVisible();
  await expect(page.getByText(/never your full birth date/i)).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Age range (optional)")).toBeVisible();

  const profile = await page.request.put("http://127.0.0.1:8177/api/v1/account/profile", {
    headers,
    data: {
      display_name: "Journey Test",
      country_code: "CN",
      residence_context: "ABROAD",
      city: "Shenzhen",
      occupation: "STUDENT",
      situation: "STUDENT",
      nationality: "ID",
      dependents: [],
      owned_coverage: [],
      priorities: [],
    },
  });
  expect(profile.status()).toBe(200);

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/home$/);

  await page.route("**/api/v1/account/documents", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ document_id: crypto.randomUUID(), status: "COMPLETED" }),
    });
  });
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents", exact: true })).toBeVisible();
  await page.goto("/completeness?from=documents");
  await expect(page.getByText(/Your documents have been processed and calculated/)).toBeVisible();
  await page.getByRole("link", { name: /Continue to Home/ }).click();
  await expect(page).toHaveURL(/\/home/);
});

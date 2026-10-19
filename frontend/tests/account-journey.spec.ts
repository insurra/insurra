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
  await page.goto("/documents?tour=upload");
  const welcome = page.getByRole("dialog");
  await expect(welcome.getByRole("heading", { name: "Yuk, isi brankas dokumenmu!" })).toBeVisible();
  await welcome.getByRole("button", { name: "Mulai unggah dokumen" }).click();
  await page.getByRole("button", { name: "Try This File" }).first().click();

  const completed = page.getByRole("dialog");
  await expect(completed.getByRole("heading", { name: "Datamu sudah bertambah!" })).toBeVisible();
  await completed.getByRole("link", { name: /Cek completeness/ }).click();
  await expect(page).toHaveURL(/\/completeness\?from=documents/);
  await expect(page.getByText("Dokumenmu sudah ikut dihitung.")).toBeVisible();
  await page.getByRole("link", { name: /Selesai, ke Home/ }).click();
  await expect(page).toHaveURL(/\/home$/);
});

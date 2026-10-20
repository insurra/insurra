import { expect, test } from "@playwright/test";

const apiBase = "http://127.0.0.1:8177";

test("demo personas provide isolated sessions for the supported countries", async ({
  page,
  context,
}) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Try the interactive demo" })).toBeVisible();
  await page.getByRole("button", { name: "Explore as Raka" }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("region", { name: "Demo mode" })).toBeVisible();
  const rakaToken = await page.evaluate(() => sessionStorage.getItem("insurra.demo-session"));
  expect(rakaToken).toBeTruthy();
  const rakaProfile = await page.request.get(`${apiBase}/api/v1/profile`, {
    headers: { "X-Demo-Session": rakaToken! },
  });
  expect(rakaProfile.status()).toBe(200);
  expect((await rakaProfile.json()).country_code).toBe("CN");
  await expect(page.getByTitle("Active Country: China")).toBeVisible();

  const sintaPage = await context.newPage();
  await sintaPage.goto("/");
  await sintaPage.getByRole("button", { name: "Explore as Sinta" }).click();
  await expect(sintaPage).toHaveURL(/\/home$/);
  await expect(sintaPage.getByRole("region", { name: "Demo mode" })).toBeVisible();
  const sintaToken = await sintaPage.evaluate(() =>
    sessionStorage.getItem("insurra.demo-session"),
  );
  expect(sintaToken).toBeTruthy();
  expect(sintaToken).not.toBe(rakaToken);
  const sintaProfile = await sintaPage.request.get(`${apiBase}/api/v1/profile`, {
    headers: { "X-Demo-Session": sintaToken! },
  });
  expect(sintaProfile.status()).toBe(200);
  expect((await sintaProfile.json()).country_code).toBe("ID");
  await expect(sintaPage.getByTitle("Active Country: Indonesia")).toBeVisible();
  await sintaPage.close();
});

test("changing a demo country preserves original policy and document countries", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Explore as Raka" }).click();
  await expect(page).toHaveURL(/\/home$/);
  const token = await page.evaluate(() => sessionStorage.getItem("insurra.demo-session"));
  if (!token) throw new Error("Expected a synthetic demo session");
  const headers = { "X-Demo-Session": token };

  const beforeResponse = await page.request.get(`${apiBase}/api/v1/home/summary`, { headers });
  expect(beforeResponse.status()).toBe(200);
  const before = await beforeResponse.json();
  expect(before.context.country_code).toBe("CN");
  expect(before.coverages.length).toBeGreaterThan(0);
  expect(before.coverages[0].country_code).toBe("CN");

  const updated = await page.request.put(`${apiBase}/api/v1/profile`, {
    headers,
    data: { country_code: "ID", residence_context: "DOMESTIC" },
  });
  expect(updated.status()).toBe(200);
  await page.reload();
  await expect(page.getByTitle("Active Country: Indonesia")).toBeVisible();

  const afterResponse = await page.request.get(`${apiBase}/api/v1/home/summary`, { headers });
  expect(afterResponse.status()).toBe(200);
  const after = await afterResponse.json();
  expect(after.context.country_code).toBe("ID");
  expect(after.coverages[0].country_code).toBe("CN");
});

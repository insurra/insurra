import { expect, test } from "@playwright/test";

test("demo claim cases remain owner-scoped and emergency guidance uses CN", async ({
  page,
  request,
}) => {
  const created = await request.post("http://127.0.0.1:8177/api/v1/demo/sessions", {
    data: { persona_id: "raka" },
  });
  expect(created.ok()).toBeTruthy();
  const { session_token: token } = await created.json();
  const headers = { "X-Demo-Session": token };
  const cases = await request.get("http://127.0.0.1:8177/api/v1/workflow/claims/cases", {
    headers,
  });
  expect(cases.status()).toBe(200);
  const ownedCases = (await cases.json()).cases;
  expect(ownedCases.length).toBeGreaterThan(0);

  await page.goto("/");
  await page.evaluate((value) => sessionStorage.setItem("insurra.demo-session", value), token);
  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: "Claims Center" })).toBeVisible();
  await expect(page.getByRole("button", { name: "New Claim" })).toBeVisible();
  await expect(page.getByText(/total cases in system/)).toBeVisible();

  const otherSession = await request.post("http://127.0.0.1:8177/api/v1/demo/sessions", {
    data: { persona_id: "sinta" },
  });
  expect(otherSession.ok()).toBeTruthy();
  const { session_token: otherToken } = await otherSession.json();
  const foreign = await request.get(
    `http://127.0.0.1:8177/api/v1/workflow/claims/cases/${ownedCases[0].id}`,
    { headers: { "X-Demo-Session": otherToken } },
  );
  expect(foreign.status()).toBe(404);

  await page.goto("/emergency");
  await expect(
    page.getByRole("heading", { name: "Emergency Guidance & Crisis Lines" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Official Emergency Contacts" })).toBeVisible();
  await expect(page.getByRole("link", { name: "120", exact: true })).toBeVisible();
  await page
    .getByPlaceholder(/severe chest pain and shortness of breath/)
    .fill("我今天胸痛很严重");
  await page.getByRole("button", { name: "Check Symptoms for Red Flags" }).click();
  await expect(page.getByText("CRITICAL RED FLAG DETECTED")).toBeVisible();
});

test("claims without a session offers Try Demo or Sign in and never creates a session", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => {
    sessionStorage.clear();
    localStorage.setItem("insurra.demo-session", "legacy-copy");
    localStorage.setItem("insurra_demo_token", "legacy-copy");
  });
  await page.goto("/claims");
  const required = page.getByTestId("session-required");
  await expect(required).toBeVisible();
  await expect(required.getByRole("link", { name: /Try Demo/ })).toBeVisible();
  await expect(required.getByRole("link", { name: /Sign in/ })).toHaveAttribute(
    "href",
    "/auth?redirect=%2Fclaims",
  );
  const stored = await page.evaluate(() => ({
    session: sessionStorage.getItem("insurra.demo-session"),
    legacy: localStorage.getItem("insurra.demo-session"),
    legacyToken: localStorage.getItem("insurra_demo_token"),
  }));
  expect(stored).toEqual({ session: null, legacy: null, legacyToken: null });
});

test("account routes redirect visitors to sign in and unsafe redirects are ignored", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => sessionStorage.clear());
  await page.goto("/account/privacy");
  await expect(page).toHaveURL(/\/auth\?redirect=%2Faccount%2Fprivacy/);
  await page.goto("/auth?redirect=//evil.example");
  await expect(page).toHaveURL(/\/auth/);
  await expect(page.getByTestId("email-delivery-notice")).toHaveCount(0);
  await page.getByRole("tab", { name: "Register" }).click();
  await expect(page.getByTestId("email-delivery-notice")).toContainText(
    "Email delivery is not configured on this server.",
  );
});

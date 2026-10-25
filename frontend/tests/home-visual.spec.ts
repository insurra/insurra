import { test, expect } from "@playwright/test";

test("Capture refined Home command center screenshot", async ({ page }) => {
  const res = await page.request.post("http://127.0.0.1:8177/api/v1/demo/sessions", {
    data: { persona_id: "raka" },
  });
  expect(res.status()).toBe(201);
  const data = await res.json();

  await page.goto("/");
  await page.evaluate((token) => {
    sessionStorage.removeItem("insurra.account-session");
    sessionStorage.setItem("insurra.demo-session", token);
  }, data.session_token);

  await page.goto("/home");
  await page.waitForTimeout(2000);

  // Assert expected elements from user criteria:
  await expect(page.getByText("Attention needed, Raka!")).toBeVisible();
  await expect(page.getByTestId("anti-lapse-agent-card")).toBeVisible();
  await expect(page.getByText("Renewal & Anti-Lapse Agent")).toBeVisible();
  await expect(page.getByText("View Agent Activity")).toBeVisible();
  await expect(page.getByText(/Review 76-Day Potential Coverage Gap/i)).toBeVisible();

  await page.screenshot({
    path: "test-results/home-command-center-refined.png",
    fullPage: true,
  });
});

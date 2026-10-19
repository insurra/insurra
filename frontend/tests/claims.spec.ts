import { expect, test } from "@playwright/test";

test("Joshua demo case ownership and honest unavailable states", async ({ page, request }) => {
  const created = await request.post("http://127.0.0.1:8177/api/v1/demo/sessions", {
    data: { persona_id: "raka" },
  });
  expect(created.ok()).toBeTruthy();
  const { session_token: token } = await created.json();
  const granted = await request.post("http://127.0.0.1:8177/api/v1/consents", {
    headers: { "X-Demo-Session": token },
    data: { purpose: "process_documents", granted: true },
  });
  expect(granted.ok()).toBeTruthy();

  await page.goto("/");
  await page.evaluate((value) => sessionStorage.setItem("insurra.demo-session", value), token);
  await page.goto("/claims");
  await expect(page.getByRole("heading", { name: "Pusat Klaim" })).toBeVisible();
  await expect(page.getByText("Belum ada kasus klaim")).toBeVisible();
  await page.getByRole("combobox", { name: "Polis" }).selectOption({ index: 1 });
  await page.getByRole("button", { name: "Buat kasus manual" }).click();
  await expect(page.locator(".claims-case")).toHaveCount(1);
  await page.locator(".claims-case").getByRole("link", { name: "Buka" }).click();
  await expect(page.getByText("Kesiapan belum dapat dihitung")).toBeVisible();
  await page.getByRole("tab", { name: "Draf klaim" }).click();
  await expect(page.getByText("Draf belum tersedia")).toBeVisible();

  await page.goto("/actions");
  await expect(page.getByText("Tidak ada tindakan")).toBeVisible();
  await page.goto("/emergency");
  await expect(page.getByText("Nomor belum tersedia · Sumber belum diverifikasi")).toBeVisible();
  await page.getByRole("combobox", { name: "Negara tempat Anda berada" }).selectOption("CN");
  await expect(page.getByRole("link", { name: "Telepon Ambulans / 急救 120" })).toBeVisible();
  await page.getByLabel("Jelaskan singkat situasi Anda").fill("呼吸困难");
  await page.getByRole("button", { name: "Periksa frasa" }).click();
  await expect(page.getByText("Frasa yang Anda tulis cocok dengan tanda bahaya medis.", { exact: false })).toBeVisible();
});

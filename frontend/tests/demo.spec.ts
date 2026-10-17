import { test, expect } from "@playwright/test";

test("persona, consent, dashboard, audit, revocation, and isolated switch", async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Mulai demo Raka" }).click();
  await expect(page).toHaveURL(/onboarding/);
  await expect(
    page.getByText("BELUM DISETUJUI", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Setuju & lanjutkan" }),
  ).toBeDisabled();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Setuju & lanjutkan" }).click();
  await expect(
    page.getByRole("heading", { name: "Selamat datang, Raka." }),
  ).toBeVisible();
  await expect(page.getByText("hari potensi jeda")).toBeVisible();
  await expect(page.locator(".gap-value strong")).toHaveText("76");
  await expect(
    page.getByRole("heading", { name: "OSHC", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("raka-dashboard.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(page.locator(".gap-value strong")).toHaveText("76");
  await page.getByRole("link", { name: "Dokumen saya", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "oshc-synthetic.txt" }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Riwayat aktivitas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Persetujuan diberikan" }),
  ).toBeVisible();
  await page.getByRole("combobox").selectOption("CONSENT_GRANTED");
  await expect(page.locator(".audit-row")).toHaveCount(1);
  await page
    .getByRole("link", { name: "Privasi & persetujuan", exact: true })
    .click();
  await page.getByRole("button", { name: "Cabut persetujuan" }).click();
  await expect(
    page.getByText("BELUM DISETUJUI", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Riwayat aktivitas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Persetujuan dicabut" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Ganti persona" }).click();
  await page.getByRole("button", { name: "Mulai demo Sinta" }).click();
  await expect(
    page.getByText("BELUM DISETUJUI", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Lihat data demo tanpa persetujuan" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Selamat datang, Sinta." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "BPJS", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "EMPLOYER", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Tidak berlaku", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "OSHC", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("link", { name: "Riwayat aktivitas", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sesi demo dibuat" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Persetujuan diberikan" }),
  ).toHaveCount(0);
  expect(runtimeErrors).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("country changes retain origin labels and do not revive a stale gap", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Mulai demo Raka" }).click();
  await expect(page).toHaveURL(/onboarding/);
  await page.getByRole("link", { name: "Lihat data demo tanpa persetujuan" }).click();
  await expect(page.locator(".gap-value strong")).toHaveText("76");
  const token = await page.evaluate(() => sessionStorage.getItem("insurra.demo-session"));
  if (!token) throw new Error("Expected an isolated synthetic demo session");
  const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";
  for (const [country_code, residence_context] of [["ID", "DOMESTIC"], ["AU", "ABROAD"]]) {
    const updated = await page.request.put(`${base}/api/v1/profile`, {
      headers: { "X-Demo-Session": token },
      data: { country_code, residence_context },
    });
    expect(updated.status()).toBe(200);
    await page.reload();
    await expect(page.locator(".profile-context")).toContainText(country_code);
    await expect(page.locator(".gap-value strong")).toHaveCount(0);
    await expect(page.locator(".assessment-card")).toContainText("PERLU VERIFIKASI");
    await expect(page.locator(".assessment-card")).not.toContainText("Tidak berlaku");
    await expect(page.locator(".policy-card")).toContainText("Negara catatan: AU");
    await page.getByRole("link", { name: "Dokumen saya", exact: true }).click();
    await expect(page.getByRole("heading", { name: "oshc-synthetic.txt" })).toBeVisible();
    await expect(page.locator(".document-row")).toContainText("Negara catatan: AU");
    await page.getByRole("link", { name: "Ringkasan", exact: true }).click();
  }
  await page.getByRole("link", { name: "Dokumen saya", exact: true }).click();
  await expect(page.getByRole("heading", { name: "oshc-synthetic.txt" })).toBeVisible();
  await expect(page.locator(".document-row")).toContainText("Negara catatan: AU");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

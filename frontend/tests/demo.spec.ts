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

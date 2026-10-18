import { test, expect } from "@playwright/test";
import { accountWorkspace } from "./helpers/workspace";

test("SC-05 account home shows deterministic counts, canonical links and visible emergency fallback", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await accountWorkspace(page);
  await expect(
    page.getByRole("heading", { name: "Halo, Raka." }),
  ).toBeVisible();
  const emergency = page.getByRole("complementary", {
    name: "Bantuan darurat",
  });
  await expect(emergency).toContainText("Periksa layanan darurat setempat");
  const box = await emergency.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThan(page.viewportSize()!.height);
  for (const [name, href] of [
    ["Tanya polis", "/ask"],
    ["Saya perlu berobat", "/pathways"],
    ["Siapkan klaim", "/claims"],
    ["Perlindungan apa yang aku butuhkan?", "/coverage-needs"],
  ]) {
    await expect(
      page
        .getByRole("navigation", { name: "Pintasan situasi" })
        .getByRole("link", { name, exact: true }),
    ).toHaveAttribute("href", href);
  }
  await page
    .locator("summary")
    .filter({ hasText: "Perlindungan aktif" })
    .click();
  await expect(page.locator("details[open]")).toContainText(
    "Fictional Test Provider",
  );
  await expect(page.locator("details[open]")).toContainText(
    "Negara catatan: AU",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("command-center.png"),
    fullPage: true,
  });
});

test("SC-14 account needs share the visa result and refresh after profile changes", async ({
  page,
}) => {
  const fixture = await accountWorkspace(page);
  const response = await page.request.get(
    "http://localhost:8000/api/v1/account/profile",
    { headers: fixture.headers },
  );
  const state = await response.json();
  const { id, created_at, updated_at, ...profile } = state.profile;
  void id;
  void created_at;
  void updated_at;
  profile.visa_expiry_date = "2027-06-30";
  expect(
    (
      await page.request.put("http://localhost:8000/api/v1/account/profile", {
        headers: fixture.headers,
        data: profile,
      })
    ).status(),
  ).toBe(200);
  await page.goto("/coverage-needs");
  await expect(
    page.getByRole("heading", {
      name: /Perlindungan yang kamu butuhkan di Australia/,
    }),
  ).toBeVisible();
  const oshc = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: /OSHC ·/ }) });
  await expect(oshc).toContainText("Sudah punya");
  await expect(oshc).toContainText("Ada jeda 76 hari");
  await expect(
    oshc.getByRole("link", { name: /Periksa jeda/ }),
  ).toHaveAttribute("href", "/completeness?task=visa_cover");
  const dental = page
    .locator("article")
    .filter({ has: page.getByRole("heading", { name: "Perlindungan gigi" }) });
  await expect(dental).toContainText("Belum punya");
  await expect(dental).toContainText("tidak ditemukan di dokumen");
  profile.occupation = "EMPLOYEE";
  expect(
    (
      await page.request.put("http://localhost:8000/api/v1/account/profile", {
        headers: fixture.headers,
        data: profile,
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Perlindungan kesehatan pekerja" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /OSHC ·/ })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

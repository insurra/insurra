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

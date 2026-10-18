import { test, expect } from "@playwright/test";
import { accountWorkspace } from "./helpers/workspace";
import type { components } from "../src/lib/api/types.gen";

type Comparison = components["schemas"]["PathwayComparison"];

async function pathwayFixture(page: import("@playwright/test").Page) {
  const fixture = await accountWorkspace(page);
  await page.route("**/api/v1/home/summary", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), triage_available: true },
    });
  });
  const comparison: Comparison = {
    comparison_id: crypto.randomUUID(),
    context_country_code: "AU",
    paths: ["Dokter umum (GP)", "Klinik urgent care"].map((name, i) => ({
      pathway_code: i ? "URGENT_CARE" : "GP",
      name,
      coverage_id: fixture.coverage_id,
      coverage_label: "OSHC · Fictional Test Provider",
      coverage_status: "MATCHED",
      description: "Test UI fixture only; not actual eligibility guidance.",
      emergency: false,
      best_for_priority: false,
      steps: [
        "Periksa kepesertaan",
        "Konfirmasi prosedur",
        "Cek jadwal atau booking online",
      ],
      requirements: ["Konfirmasi provider dalam jaringan"],
      docs: ["Ringkasan polis bila diminta"],
      uncertainties: [],
      sources: [],
      est_out_of_pocket: null,
    })),
    uncertainties: [
      {
        code: "provider_network",
        label: "Apakah provider dalam jaringan?",
        steps: ["Tanya fasilitas tentang jaringan dan pembayaran."],
      },
    ],
    warnings: ["Tarif belum tersedia; bukan jaminan pembayaran."],
  };
  await page.route("**/api/v1/pathways/compare", (route) =>
    route.fulfill({ json: comparison }),
  );
  return { ...fixture, comparison };
}

test("SC-07 live screen fails closed while triage data is unreviewed", async ({
  page,
}) => {
  await accountWorkspace(page);
  await page.goto("/pathways");
  await expect(
    page.getByRole("heading", { name: "Mau berobat ke mana?" }),
  ).toBeVisible();
  await expect(
    page.getByText("Basis tanda bahaya negara ini belum terverifikasi.", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Ceritakan keluhanmu" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Bandingkan jalur", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Dokter umum (GP)", exact: true }),
  ).toBeVisible();
});

test("SC-07 comparison form, unknown costs and copy questions work with a synthetic dependency seam", async ({
  page,
  context,
}) => {
  await pathwayFixture(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/pathways");
  const submit = page.getByRole("button", {
    name: "Bandingkan jalur",
    exact: true,
  });
  await expect(submit).toBeDisabled();
  await page
    .getByRole("textbox", { name: "Ceritakan keluhanmu" })
    .fill("Kebutuhan layanan non-darurat");
  await expect(submit).toBeDisabled();
  await page
    .getByRole("button", { name: "Dokter umum (GP)", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Kota", exact: true }),
  ).toHaveValue("Melbourne");
  const sent = page.waitForRequest((r) =>
    r.url().endsWith("/pathways/compare"),
  );
  await submit.click();
  expect((await sent).postDataJSON().timeframe).toBe("unknown");
  const cards = page
    .getByRole("region", { name: "Perbandingan jalur" })
    .getByRole("article");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Belum diketahui");
  await expect(
    page.getByRole("textbox", { name: "Ceritakan keluhanmu" }),
  ).toHaveValue("");
  await page
    .getByRole("button", { name: "Salin pertanyaan untuk klinik" })
    .click();
  await expect(page.getByText("Pertanyaan tersalin.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Apakah provider dalam jaringan?",
  );
  await expect(
    page.getByRole("button", { name: "Buat pengingat cek" }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

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

test("SC-06 live dependency fallback locks chat and exposes privacy and document guidance", async ({
  page,
}) => {
  const fixture = await accountWorkspace(page);
  await page.goto("/ask");
  await expect(
    page.getByRole("heading", { name: "Tanya polis", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Pemeriksaan tanda bahaya belum tersedia\. Tanya polis dihentikan/,
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Pertanyaan Anda" }),
  ).toBeDisabled();
  expect(
    (
      await page.request.post("http://localhost:8000/api/v1/account/consents", {
        headers: fixture.headers,
        data: { purpose: "external_ai", granted: false },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(
    page.getByRole("link", { name: "Privasi & Data Saya", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Kirim", exact: true }),
  ).toBeDisabled();
});

test("SC-06 mocked validated SSE opens a real owned source page and original document", async ({
  page,
}) => {
  // Only the provider/triage availability seam is mocked. Auth, ownership and source access use the real backend.
  const fixture = await accountWorkspace(page);
  const source = await page.request.get(
    `http://localhost:8000/api/v1/ask/sources/${fixture.document_id}/1`,
    { headers: fixture.headers },
  );
  expect(source.status()).toBe(200);
  const original = await source.json();
  const quote: string = original.text.split("\n")[1];
  await page.route("**/api/v1/home/summary", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({
      response,
      json: { ...body, triage_available: true },
    });
  });
  await page.route("**/api/v1/ask", async (route) => {
    const point = {
      text: "Perawatan gigi umum dikecualikan dalam polis fiktif ini.",
      label: "FROM_DOCUMENT",
      citations: [
        {
          doc: fixture.document_id,
          page: 1,
          quote,
          document_name: "fictional-policy.pdf",
        },
      ],
    };
    const answer = {
      answer_points: [point],
      warnings: ["Keputusan pembayaran ada pada penyedia."],
      disposition: "answered",
      context_country_code: "AU",
    };
    const event = (name: string, data: unknown) =>
      `event: ${name}\ndata: ${JSON.stringify({ event: name, data })}\n\n`;
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        event("progress", { stage: "retrieving" }) +
        event("answer_point", point) +
        event("complete", answer),
    });
  });
  await page.goto("/ask");
  await page
    .getByRole("combobox", { name: "Tanya tentang" })
    .selectOption(fixture.coverage_id);
  await page
    .getByRole("textbox", { name: "Pertanyaan Anda" })
    .fill("Periksa gigi ditanggung nggak?");
  const start = Date.now();
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await expect(
    page.getByText("Perawatan gigi umum dikecualikan dalam polis fiktif ini.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(Date.now() - start).toBeLessThan(5000);
  await page
    .getByRole("button", { name: "fictional-policy.pdf · hal. 1", exact: true })
    .click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(quote);
  await expect(drawer).toContainText(
    "Kutipan cocok dengan halaman sumber saat ini",
  );
  await drawer.getByRole("link", { name: "Buka dokumen · halaman 1" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/documents/${fixture.document_id}#page-1`),
  );
  await expect(page.locator("#page-1")).toHaveAttribute("open", "");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("SC-06 cancellation and retry keep incomplete answers out of history", async ({
  page,
}) => {
  await accountWorkspace(page);
  await page.route("**/api/v1/home/summary", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), triage_available: true },
    });
  });
  let slow = true;
  await page.route("**/api/v1/ask", async (route) => {
    if (slow) await new Promise((resolve) => setTimeout(resolve, 500));
    const data = {
      answer_points: [],
      warnings: ["Tidak ditemukan di dokumen."],
      disposition: "no_match",
    };
    await route
      .fulfill({
        contentType: "text/event-stream",
        body: `event: complete\ndata: ${JSON.stringify({ event: "complete", data })}\n\n`,
      })
      .catch(() => undefined);
  });
  await page.goto("/ask");
  await page
    .getByRole("textbox", { name: "Pertanyaan Anda" })
    .fill("Manfaat yang belum ditemukan?");
  const request = page.waitForRequest((r) => r.url().endsWith("/api/v1/ask"));
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await request;
  await page.getByRole("button", { name: "Batalkan", exact: true }).click();
  await expect(page.locator(".vn").getByRole("alert")).toContainText(
    "Permintaan dibatalkan",
  );
  await expect(page.getByRole("log").locator("article")).toHaveCount(0);
  slow = false;
  await page.getByRole("button", { name: "Coba lagi", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Tidak ditemukan di dokumen",
      exact: true,
    }),
  ).toBeVisible();
});

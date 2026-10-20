import { expect, test, type Page } from "@playwright/test";
import { accountWorkspace } from "./helpers/workspace";
import type { components } from "../src/lib/api/types.gen";

type Comparison = components["schemas"]["PathwayComparison"];
const apiBase = "http://127.0.0.1:8177";

async function setSummary(page: Page, patch: Record<string, unknown>) {
  await page.route("**/api/v1/home/summary", async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), ...patch } });
  });
}

async function pathwayFixture(page: Page) {
  const fixture = await accountWorkspace(page);
  await setSummary(page, {
    triage_available: true,
    service_types: [{ code: "GP", label: "General Practitioner" }],
  });
  const comparison: Comparison = {
    comparison_id: crypto.randomUUID(),
    context_country_code: "CN",
    paths: ["General Practitioner", "Urgent Care Clinic"].map((name, index) => ({
      pathway_code: index ? "URGENT_CARE" : "GP",
      name,
      coverage_id: fixture.coverage_id,
      coverage_label: "INTERNATIONAL_STUDENT · Fictional Test Provider",
      coverage_status: "MATCHED",
      description: "Synthetic browser fixture only; not eligibility guidance.",
      emergency: false,
      best_for_priority: false,
      steps: ["Verify policy details", "Confirm provider network", "Check availability"],
      requirements: ["Confirm network status with the provider"],
      docs: ["Policy summary if requested"],
      uncertainties: [],
      sources: [],
      est_out_of_pocket: null,
    })),
    uncertainties: [
      {
        code: "provider_network",
        label: "Is the provider in network?",
        steps: ["Ask the facility about network status and payment."],
      },
    ],
    warnings: ["Tariffs are unavailable; this is not a payment guarantee."],
  };
  await page.route("**/api/v1/pathways/compare", (route) =>
    route.fulfill({ json: comparison }),
  );
  return { ...fixture, comparison };
}

test("SC-05 document deletion clears retained pages and Q&A requires source evidence", async ({
  page,
}) => {
  const fixture = await accountWorkspace(page);
  const deleted = await page.request.delete(
    `${apiBase}/api/v1/account/documents/${fixture.document_id}`,
    { headers: fixture.headers, data: { confirm: "HAPUS" } },
  );
  expect(deleted.status()).toBe(200);
  const documents = await page.request.get(`${apiBase}/api/v1/account/documents`, {
    headers: fixture.headers,
  });
  expect(documents.status()).toBe(200);
  expect(await documents.json()).toEqual([]);

  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents & AI Intelligence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No insurance documents uploaded yet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Upload Your First Document" })).toBeVisible();
  await page.goto("/ask");
  await expect(page.getByRole("textbox", { name: "Pertanyaan Anda" })).toBeDisabled();
  await expect(page.getByRole("link", { name: "Unggah dokumen", exact: true })).toHaveAttribute(
    "href",
    "/documents",
  );
});

test("SC-05 and SC-14 Indonesian account stays within ID context", async ({ page }) => {
  const fixture = await accountWorkspace(page, "ID");
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  const profile = await page.request.get(`${apiBase}/api/v1/account/profile`, {
    headers: fixture.headers,
  });
  expect(profile.status()).toBe(200);
  expect((await profile.json()).profile.country_code).toBe("ID");
  await expect(page.getByTitle("Active Country: Indonesia")).toBeVisible();
  await page.goto("/coverage-needs");
  await expect(page.getByRole("heading", { name: "Coverage Needs & Gap Analysis" })).toBeVisible();
  await expect(page.getByText(/Evaluated for Indonesia context/)).toBeVisible();
  await expect(page.getByText(/BPJS/).first()).toBeVisible();
  await expect(page.getByText(/Australia|OSHC/)).toHaveCount(0);
});

test("SC-07 account profile rejects AU outside the active CN/ID scope", async ({
  page,
}) => {
  const fixture = await accountWorkspace(page);
  const current = await page.request.get(`${apiBase}/api/v1/account/profile`, {
    headers: fixture.headers,
  });
  expect(current.status()).toBe(200);
  const { id, created_at, updated_at, ...profile } = (await current.json()).profile;
  void id;
  void created_at;
  void updated_at;
  const rejected = await page.request.put(`${apiBase}/api/v1/account/profile`, {
    headers: fixture.headers,
    data: { ...profile, country_code: "AU", residence_context: "ABROAD" },
  });
  expect(rejected.status()).toBe(422);
  const unchanged = await page.request.get(`${apiBase}/api/v1/account/profile`, {
    headers: fixture.headers,
  });
  expect((await unchanged.json()).profile.country_code).toBe("CN");
});

test("SC-07 confirmation cancels without a case and retries with the same idempotency key", async ({
  page,
}) => {
  const fixture = await pathwayFixture(page);
  fixture.comparison.paths![0].direct_billing = true;
  const requests: { key: string | undefined; body: unknown }[] = [];
  const caseId = crypto.randomUUID();
  await page.route("**/api/v1/claims", async (route) => {
    requests.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    });
    if (requests.length === 1)
      await route.fulfill({
        status: 503,
        json: {
          code: "DATABASE_UNAVAILABLE",
          message: "Retry this confirmation.",
          request_id: "synthetic",
        },
      });
    else await route.fulfill({ status: 201, json: { claim_case_id: caseId } });
  });

  await page.goto("/pathways");
  await page.getByRole("textbox", { name: "Describe your care need" }).fill("Non-emergency outpatient care");
  await page.getByRole("button", { name: "General Practitioner", exact: true }).click();
  await page.getByRole("button", { name: "Compare pathways" }).click();
  await page.getByRole("button", { name: "Select this pathway" }).first().click();
  const dialog = page.getByRole("dialog", { name: "Confirm Care Pathway" });
  await expect(dialog).toContainText("A Draft claim case records your selected pathway");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(requests).toHaveLength(0);

  await page.getByRole("button", { name: "Select this pathway" }).first().click();
  await dialog.getByRole("button", { name: "Create claim draft" }).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(dialog.getByRole("alert")).toContainText("Retry this confirmation");
  expect(requests).toHaveLength(1);
  await dialog.getByRole("button", { name: "Create claim draft" }).click();
  await expect(page.getByRole("heading", { name: "Claim Case Created", exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[0].key).toBeTruthy();
  expect(requests[1].key).toBe(requests[0].key);
  expect(requests[1].body).toEqual({
    path: "GP",
    coverage_id: fixture.coverage_id,
    comparison_id: fixture.comparison.comparison_id,
  });
  await expect(page.getByText(`Status Draft · ID ${caseId}`)).toBeVisible();
  await expect(page.getByText("Draft claim case saved.")).toBeVisible();
});

test("SC-07 emergency pathway opens guidance without creating a case", async ({ page }) => {
  const fixture = await pathwayFixture(page);
  fixture.comparison.paths![0].emergency = true;
  fixture.comparison.paths![0].name = "Emergency Department · synthetic fixture";
  let calls = 0;
  await page.route("**/api/v1/claims", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/pathways");
  await page.getByRole("textbox", { name: "Describe your care need" }).fill("Non-emergency outpatient care");
  await page.getByRole("button", { name: "General Practitioner", exact: true }).click();
  await page.getByRole("button", { name: "Compare pathways" }).click();
  await page.getByRole("button", { name: "Emergency guidance" }).click();
  await expect(page.locator(".vn").getByRole("alert")).toContainText(
    "Comparison stopped: Emergency symptoms detected",
  );
  expect(calls).toBe(0);
});

test("SC-07 comparisons preserve unknown costs and copy verification questions", async ({
  page,
  context,
}) => {
  await pathwayFixture(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/pathways");
  const submit = page.getByRole("button", { name: "Compare pathways" });
  await expect(submit).toBeDisabled();
  await page.getByRole("textbox", { name: "Describe your care need" }).fill("Non-emergency outpatient care");
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: "General Practitioner", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "City", exact: true })).toHaveValue("Shenzhen");
  const sent = page.waitForRequest((request) => request.url().endsWith("/pathways/compare"));
  await submit.click();
  expect((await sent).postDataJSON().timeframe).toBe("unknown");
  const cards = page.getByRole("region", { name: "Pathway comparison" }).getByRole("article");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText("Not available");
  await expect(page.getByRole("textbox", { name: "Describe your care need" })).toHaveValue("");
  await page.getByRole("button", { name: "Copy questions" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Is the provider in network?",
  );
  await expect(page.getByRole("button", { name: "Prepare insurer inquiry" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("SC-05 account home links to current workflows and shows verified emergency contact", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "mobile") await page.setViewportSize({ width: 375, height: 812 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await accountWorkspace(page);
  await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
  const emergency = page.getByTestId("home-emergency-contact");
  await expect(emergency).toContainText("Local Emergency (China): 120");
  for (const [name, href] of [
    ["Review Coverage Needs", "/coverage-needs"],
    ["Ask INSURRA", "/ask"],
    ["Continue Claim →", "/claims"],
    ["Emergency Guidance →", "/emergency"],
  ]) {
    await expect(page.getByRole("link", { name, exact: true }).first()).toHaveAttribute("href", href);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("command-center.png"), fullPage: true });
});

test("SC-14 profile and coverage needs retain CN context after edits", async ({ page }) => {
  const fixture = await accountWorkspace(page);
  const response = await page.request.get(`${apiBase}/api/v1/account/profile`, {
    headers: fixture.headers,
  });
  const state = await response.json();
  const { id, created_at, updated_at, ...profile } = state.profile;
  void id;
  void created_at;
  void updated_at;
  profile.visa_expiry_date = "2027-06-30";
  expect(
    (
      await page.request.put(`${apiBase}/api/v1/account/profile`, {
        headers: fixture.headers,
        data: profile,
      })
    ).status(),
  ).toBe(200);
  await page.goto("/coverage-needs");
  await expect(page.getByRole("heading", { name: "Coverage Needs & Gap Analysis" })).toBeVisible();
  await expect(page.getByText(/Evaluated for China context/)).toBeVisible();
  await expect(page.getByText(/Australia|OSHC/)).toHaveCount(0);

  profile.occupation = "EMPLOYEE";
  expect(
    (
      await page.request.put(`${apiBase}/api/v1/account/profile`, {
        headers: fixture.headers,
        data: profile,
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Coverage Needs & Gap Analysis" })).toBeVisible();
  await expect(page.getByText(/Evaluated for China context/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("SC-06 unavailable triage blocks Q&A and revoked AI consent stays blocked", async ({ page }) => {
  const fixture = await accountWorkspace(page);
  await setSummary(page, { triage_available: false });
  await page.goto("/ask");
  await expect(page.getByRole("heading", { name: "Ask INSURRA", exact: true })).toBeVisible();
  await expect(page.getByText(/Pemeriksaan tanda bahaya belum tersedia/)).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Pertanyaan Anda" })).toBeDisabled();
  expect(
    (
      await page.request.post(`${apiBase}/api/v1/account/consents`, {
        headers: fixture.headers,
        data: { purpose: "external_ai", granted: false },
      })
    ).status(),
  ).toBe(200);
  await page.reload();
  await expect(page.getByRole("link", { name: "Settings & Privacy", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kirim", exact: true })).toBeDisabled();
});

test("SC-06 mocked citation opens the owned source page and original document", async ({
  page,
}, testInfo) => {
  const fixture = await accountWorkspace(page);
  const source = await page.request.get(
    `${apiBase}/api/v1/ask/sources/${fixture.document_id}/1`,
    { headers: fixture.headers },
  );
  expect(source.status()).toBe(200);
  const original = await source.json();
  const quote: string = original.text.split("\n")[1];
  await setSummary(page, { triage_available: true });
  await page.route("**/api/v1/ask", async (route) => {
    const point = {
      text: "General dental treatment is excluded under this fictional policy.",
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
      warnings: ["This is a synthetic policy fixture."],
      disposition: "answered",
      context_country_code: "CN",
    };
    const event = (name: string, data: unknown) =>
      `event: ${name}\ndata: ${JSON.stringify({ event: name, data })}\n\n`;
    await route.fulfill({
      contentType: "text/event-stream",
      body: event("progress", { stage: "retrieving" }) + event("answer_point", point) + event("complete", answer),
    });
  });
  await page.goto("/ask");
  await page.getByRole("combobox", { name: "Filter policy scope" }).selectOption(fixture.coverage_id);
  await page.getByRole("textbox", { name: "Pertanyaan Anda" }).fill("Is dental care covered?");
  const start = Date.now();
  const send = page.getByRole("button", { name: "Kirim", exact: true });
  if (testInfo.project.name === "mobile") await send.press("Enter");
  else await send.click();
  await expect(
    page.getByRole("log").getByText("General dental treatment is excluded under this fictional policy.", {
      exact: true,
    }).first(),
  ).toBeVisible();
  expect(Date.now() - start).toBeLessThan(5000);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "fictional-policy.pdf · p. 1", exact: true }).click();
  const drawer = page.getByRole("dialog");
  await expect(drawer).toContainText(quote);
  await expect(drawer).toContainText("Exact substring verified against retained source page");
  await drawer.getByRole("link", { name: "Open document · page 1" }).click();
  await expect(page).toHaveURL(new RegExp(`/documents/${fixture.document_id}#page-1`));
  await expect(page.locator("#page-1")).toHaveAttribute("open", "");
});

test("SC-06 cancellation and retry keep incomplete answers out of history", async ({
  page,
}, testInfo) => {
  await accountWorkspace(page);
  await setSummary(page, { triage_available: true });
  let slow = true;
  await page.route("**/api/v1/ask", async (route) => {
    if (slow) await new Promise((resolve) => setTimeout(resolve, 5000));
    const data = {
      answer_points: [],
      warnings: ["No matching evidence was found."],
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
  await page.getByRole("textbox", { name: "Pertanyaan Anda" }).fill("What is not in the document?");
  const send = page.getByRole("button", { name: "Kirim", exact: true });
  if (testInfo.project.name === "mobile") await send.press("Enter");
  else await send.click();
  const cancel = page.getByRole("button", { name: "Batalkan", exact: true });
  await expect(cancel).toBeVisible();
  if (testInfo.project.name === "mobile") await cancel.press("Enter");
  else await cancel.click();
  await expect(page.locator(".vn").getByRole("alert")).toContainText("Request cancelled");
  await expect(page.getByRole("log").locator("article")).toHaveCount(0);
  slow = false;
  const retry = page.getByRole("button", { name: "Coba lagi", exact: true });
  if (testInfo.project.name === "mobile") await retry.press("Enter");
  else await retry.click();
  await expect(page.getByRole("heading", { name: "Not found in your documents", exact: true })).toBeVisible();
});

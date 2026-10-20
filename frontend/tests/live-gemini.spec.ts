import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "@playwright/test";

function syntheticPolicyPdf(): Buffer {
  const lines = [
    "FICTIONAL TEST POLICY. Not real insurance.",
    "Provider: Northstar Synthetic Insurance.",
    "Coverage start date: 2026-01-01.",
    "Coverage end date: 2027-12-31.",
    "General dental treatment is excluded under this fictional policy.",
  ];
  const stream = Buffer.from(
    [
      "BT",
      "/F1 12 Tf",
      "50 750 Td",
      "15 TL",
      ...lines.flatMap((line) => [`(${line}) Tj`, "T*"]),
      "ET",
    ].join("\n"),
    "ascii",
  );
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    ),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from("\nendstream"),
    ]),
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  const offsets = [0];
  let offset = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const chunk = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`),
      object,
      Buffer.from("\nendobj\n"),
    ]);
    chunks.push(chunk);
    offset += chunk.length;
  }
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${offsets.length}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((item) => `${item.toString().padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  ].join("");
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

test("real Gemini upload, extraction, policy answer, citation, and unsupported question", async ({
  page,
}) => {
  test.setTimeout(240_000);
  const root = path.resolve(__dirname, "../..");
  const databaseURL = process.env.INSURRA_LIVE_GEMINI_DATABASE_URL;
  if (!databaseURL)
    throw new Error("The live Gemini Playwright config did not set its isolated database.");
  const raw = execFileSync(
    process.env.UV ?? "uv",
    ["run", "python", "-m", "app.tests.seed_live_gemini_e2e"],
    {
      cwd: path.join(root, "backend"),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseURL,
        INSURRA_LIVE_GEMINI: "1",
      },
    },
  );
  const credentials: { email: string; password: string } = JSON.parse(raw.trim());

  await page.goto("/auth");
  await page.getByLabel("Email Address").fill(credentials.email);
  await page.getByLabel("Password", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Log In", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Before We Get Started" })).toBeVisible();
  const consent = page.getByRole("checkbox");
  await consent.nth(0).check();
  await consent.nth(1).check();
  await consent.nth(2).check();
  await page.getByRole("button", { name: "Agree & Continue" }).click();

  await page.goto("/documents");
  await page.getByLabel("Document Category").selectOption("policy_booklet");
  await page.getByLabel("Select File").setInputFiles({
    name: "synthetic-policy.pdf",
    mimeType: "application/pdf",
    buffer: syntheticPolicyPdf(),
  });
  await page.getByRole("button", { name: "Upload and Extract" }).click();
  await expect(page.getByRole("status")).toContainText("Document ingested successfully", {
    timeout: 120_000,
  });
  await expect(page.getByRole("link", { name: /synthetic-policy\.pdf/ })).toBeVisible();

  await page.goto("/ask");
  const question = page.getByRole("textbox", { name: "Pertanyaan Anda" });
  await expect(question).toBeEnabled({ timeout: 30_000 });
  await question.fill("Does this policy exclude general dental treatment?");
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  const citation = page.getByRole("button", {
    name: "synthetic-policy.pdf · hal. 1",
    exact: true,
  });
  await expect(citation).toBeVisible({ timeout: 120_000 });
  await citation.click();
  const source = page.getByRole("dialog");
  await expect(source).toContainText(
    "General dental treatment is excluded under this fictional policy.",
  );
  await expect(source).toContainText("Kutipan cocok dengan halaman sumber saat ini");
  await source.getByRole("button", { name: "Tutup sumber" }).click();

  await question.fill("Does the policy cover fertility services?");
  await page.getByRole("button", { name: "Kirim", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Tidak ditemukan di dokumen" })).toBeVisible({
    timeout: 30_000,
  });
});

import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, type Page } from "@playwright/test";

export const workspaceApiBase =
  process.env.INSURRA_E2E_API_URL ?? "http://localhost:8000";

export async function accountWorkspace(
  page: Page,
  country: "AU" | "ID" = "AU",
) {
  const root = path.resolve(__dirname, "../../..");
  const raw = execFileSync(
    process.env.UV ?? "uv",
    ["run", "python", "-m", "app.tests.seed_workspace_e2e"],
    {
      cwd: path.join(root, "backend"),
      encoding: "utf8",
      env: {
        ...process.env,
        UV_CACHE_DIR: path.join(root, ".cache/uv"),
        DATABASE_URL: `sqlite:///${root}/.cache/e2e.db`,
        INSURRA_TEST_SEED: "1",
        TEST_COUNTRY: country,
      },
    },
  );
  const fixture: {
    email: string;
    password: string;
    coverage_id: string;
    document_id: string;
    headers: Record<string, string>;
  } = JSON.parse(raw.trim());
  const response = await page.request.post(
    `${workspaceApiBase}/api/v1/account/auth/login`,
    { data: { email: fixture.email, password: fixture.password } },
  );
  if (response.status() !== 200)
    throw new Error(`Synthetic fixture login failed: ${response.status()}`);
  const session: { access_token: string } = await response.json();
  await page.goto("/");
  await page.evaluate((token) => {
    sessionStorage.removeItem("insurra.demo-session");
    sessionStorage.setItem("insurra.account-session", token);
  }, session.access_token);
  await page.goto("/home");
  // Wait for account restoration before a test starts another full-page navigation.
  await expect(
    page.getByRole("heading", {
      name: country === "ID" ? "Halo, Sinta." : "Halo, Raka.",
    }),
  ).toBeVisible();
  return {
    ...fixture,
    headers: { Authorization: `Bearer ${session.access_token}` },
  };
}

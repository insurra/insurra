import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const root = path.resolve(__dirname, "..");
export default defineConfig({
  testDir: "./tests",
  testMatch: ["demo.spec.ts", "valen.spec.ts"],
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://localhost:3000", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "make migrate && make seed && make dev-backend",
      cwd: root,
      url: "http://localhost:8000/health",
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: `sqlite:///${root}/.cache/e2e.db`,
        FRONTEND_ORIGIN: "http://localhost:3000",
      },
      timeout: 60_000,
    },
    {
      // CI exercises the built application, without on-demand dev compilation during assertions.
      command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_BASE_URL: "http://localhost:8000" },
      timeout: 90_000,
    },
  ],
});

import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const apiBaseURL = process.env.INSURRA_E2E_API_URL ?? "http://localhost:8000";
const webBaseURL = process.env.INSURRA_E2E_WEB_URL ?? "http://localhost:3000";
const apiPort = new URL(apiBaseURL).port || "8000";
const webPort = new URL(webBaseURL).port || "3000";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["demo.spec.ts", "workspace.spec.ts"],
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: { baseURL: webBaseURL, trace: "retain-on-failure" },
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
      url: `${apiBaseURL}/health`,
      reuseExistingServer: !process.env.CI,
      env: {
        DATABASE_URL: `sqlite:///${root}/.cache/e2e.db`,
        FRONTEND_ORIGIN: webBaseURL,
        API_PORT: apiPort,
      },
      timeout: 60_000,
    },
    {
      // CI exercises the built application, without on-demand dev compilation during assertions.
      command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
      url: webBaseURL,
      reuseExistingServer: !process.env.CI,
      env: { NEXT_PUBLIC_API_BASE_URL: apiBaseURL, PORT: webPort },
      timeout: 90_000,
    },
  ],
});

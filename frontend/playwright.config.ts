import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const root = path.resolve(__dirname, "..");
export default defineConfig({
  testDir: "./tests",
  testMatch: ["demo.spec.ts", "claims.spec.ts", "workspace.spec.ts", "account-journey.spec.ts", "home-visual.spec.ts"],
  fullyParallel: false,
  timeout: 60_000,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3177", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: [
    {
      command: "make migrate && make seed && cd backend && uv run uvicorn app.main:app --host 127.0.0.1 --port 8177",
      cwd: root,
      url: "http://127.0.0.1:8177/health",
      reuseExistingServer: false,
      env: {
        DATABASE_URL: `sqlite:///${root}/.cache/e2e.db`,
        FRONTEND_ORIGIN: "http://127.0.0.1:3177",
        UV_CACHE_DIR: "/tmp/insurra-e2e-uv-cache",
        // AU remains an isolated acceptance fixture; production activation stays CN,ID.
        ACTIVE_KB_COUNTRIES: "AU,CN,ID",
      },
      timeout: 60_000,
    },
    {
      // CI exercises the built application, without on-demand dev compilation during assertions.
      command: "npm run build && npm run start -- --port 3177",
      url: "http://127.0.0.1:3177",
      reuseExistingServer: false,
      env: { NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8177" },
      timeout: 150_000,
    },
  ],
});

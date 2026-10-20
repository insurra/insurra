import { defineConfig, devices } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

const root = path.resolve(__dirname, "..");
if (process.env.INSURRA_LIVE_GEMINI !== "1") {
  throw new Error("Set INSURRA_LIVE_GEMINI=1 to run the real-provider browser test.");
}

const apiBaseURL = process.env.INSURRA_E2E_API_URL ?? "http://127.0.0.1:18001";
const webBaseURL = process.env.INSURRA_E2E_WEB_URL ?? "http://127.0.0.1:13001";
const apiPort = new URL(apiBaseURL).port || "18001";
const webPort = new URL(webBaseURL).port || "13001";
const databaseURL =
  process.env.INSURRA_LIVE_GEMINI_DATABASE_URL ??
  `sqlite:///${path.join(root, ".cache", `e2e-live-gemini-${randomUUID()}.db`)}`;
process.env.INSURRA_LIVE_GEMINI_DATABASE_URL = databaseURL;
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const uvCacheDir = path.join(root, ".cache", "uv");

const frontendEnv = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key !== "GEMINI_API_KEY"),
);

export default defineConfig({
  testDir: "./tests",
  testMatch: "live-gemini.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: { baseURL: webBaseURL, trace: "retain-on-failure" },
  projects: [{ name: "desktop-live-gemini", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: `cd backend && DATABASE_URL=${shellQuote(databaseURL)} UV_CACHE_DIR=${shellQuote(uvCacheDir)} uv run alembic upgrade head && DATABASE_URL=${shellQuote(databaseURL)} UV_CACHE_DIR=${shellQuote(uvCacheDir)} INSURRA_LIVE_GEMINI=1 uv run uvicorn app.tests.live_gemini_server:app --host 127.0.0.1 --port ${apiPort}`,
      cwd: root,
      url: `${apiBaseURL}/health`,
      reuseExistingServer: false,
      env: {
        ...process.env,
        DATABASE_URL: databaseURL,
        FRONTEND_ORIGIN: webBaseURL,
        FRONTEND_URL: webBaseURL,
        API_PORT: apiPort,
        UV_CACHE_DIR: uvCacheDir,
        INSURRA_LIVE_GEMINI: "1",
      },
      timeout: 60_000,
    },
    {
      command: "npm run build && npm run start",
      cwd: path.join(root, "frontend"),
      url: webBaseURL,
      reuseExistingServer: false,
      env: {
        ...frontendEnv,
        NEXT_PUBLIC_API_BASE_URL: apiBaseURL,
        PORT: webPort,
      },
      timeout: 120_000,
    },
  ],
});

import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: "client.spec.ts",
  reporter: "list",
});

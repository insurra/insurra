import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests",
  testMatch: ["client.spec.ts", "ask-stream.spec.ts"],
  reporter: "list",
});

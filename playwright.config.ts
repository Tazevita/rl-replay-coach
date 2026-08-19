import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  use: {
    baseURL: "http://127.0.0.1:4174",
  },
  webServer: {
    command: "npm start -- --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: true,
  },
});

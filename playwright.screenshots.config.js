import {defineConfig} from "@playwright/test";

/**
 * App Store screenshot capture. Deliberately a separate config from playwright.config.js: the
 * captures are not assertions, they are slow, and they must never run as part of CI.
 *
 * 1440x900 at deviceScaleFactor 2 renders to 2880x1800, which is the largest size App Store
 * Connect accepts for macOS.
 */
export default defineConfig({
  testDir: "./tests/screenshots",
  testMatch: "**/*.capture.js",
  timeout: 120 * 1000,
  workers: 1,
  reporter: [["list"]],
});

import {test as base, chromium} from "@playwright/test";
import path from "path";

/**
 * The e2e fixture, but rendering at App Store dimensions.
 *
 * launchPersistentContext creates its own context, so a viewport set in the config's `use` block
 * never reaches it -- it has to be passed here. 1440x900 at deviceScaleFactor 2 produces a
 * 2880x1800 PNG, the largest size App Store Connect accepts for macOS.
 */
export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    // eslint-disable-next-line no-undef
    const pathToExtension = path.join(process.cwd(), "addon");
    const context = await chromium.launchPersistentContext("", {
      headless: true,
      channel: "chromium",
      viewport: {width: 1440, height: 900},
      deviceScaleFactor: 2,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
        // Screenshots are colour-managed by App Store Connect; pin sRGB so the captures match
        // what the theme actually specifies rather than the display profile of whoever ran this.
        "--force-color-profile=srgb"
      ],
    });

    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent("serviceworker");
    }

    await background.evaluate(async () => {
      let retries = 10;
      while (retries > 0 && (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local)) {
        await new Promise(resolve => setTimeout(resolve, 50));
        retries--;
      }
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({skipWelcomePage: true});
      }
    });

    await use(context);
    await context.close();
  },
  extensionId: async ({context}, use) => {
    let [background] = context.serviceWorkers();
    if (!background) {
      background = await context.waitForEvent("serviceworker");
    }
    await use(background.url().split("/")[2]);
  },
});

export const expect = base.expect;

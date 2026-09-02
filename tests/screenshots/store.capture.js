import {test} from "./fixtures";
import {TEST_CONSTANTS, injectSessionData, createModelExposureSetup} from "../e2e/test-helpers";
import {routeMock} from "../e2e/test-mock";
import path from "path";

/**
 * App Store screenshots.
 *
 * Run with:  npx playwright test -c playwright.screenshots.config.js
 *
 * These capture the extension's own pages, which are the product. Everything on screen is real --
 * the actual pages, running the actual code, rendering the actual theme. Only the Salesforce
 * responses behind them are demo data, because the alternative is putting a live org on a public
 * store listing.
 *
 * The demo accounts are invented. They are richer than the two rows the e2e mock returns, which
 * exist to be asserted against rather than looked at.
 */
const {mockToken, apiVersion} = TEST_CONSTANTS;

// The header prints the org's subdomain, so the e2e host would put "MOCK-HOST" across every
// screenshot. routeMock matches on whatever host it is handed, so this is just a nicer label for
// the same mock. Nothing reaches it: every request is fulfilled locally.
const mockHost = "demo.my.salesforce.com";

// eslint-disable-next-line no-undef
const OUT = path.join(process.cwd(), "store-assets", "screenshots");

const DEMO_ACCOUNTS = [
  ["Aurora Robotics", "Customer - Direct", "Manufacturing", "Rotterdam"],
  ["Bluepeak Logistics", "Customer - Channel", "Transportation", "Antwerp"],
  ["Cedarline Health", "Customer - Direct", "Healthcare", "Utrecht"],
  ["Delta Harbour Freight", "Prospect", "Transportation", "Hamburg"],
  ["Everline Media", "Customer - Channel", "Media", "Ghent"],
  ["Fjordkraft Energy", "Customer - Direct", "Energy", "Bergen"],
  ["Granite Peak Ventures", "Prospect", "Finance", "Zurich"],
  ["Harbourview Retail", "Customer - Direct", "Retail", "Bruges"],
  ["Ionis Laboratories", "Customer - Direct", "Biotechnology", "Leuven"],
  ["Juniper Systems", "Customer - Channel", "Technology", "Eindhoven"],
  ["Kestrel Analytics", "Prospect", "Technology", "Brussels"],
  ["Lumen Foods", "Customer - Direct", "Food & Beverage", "Lyon"],
  ["Meridian Textiles", "Customer - Channel", "Apparel", "Milan"],
  ["Northgate Insurance", "Customer - Direct", "Insurance", "Dublin"]
].map(([Name, Type, Industry, BillingCity], i) => ({
  attributes: {
    type: "Account",
    url: `/services/data/v${apiVersion}/sobjects/Account/001Kx0000${String(i + 10).padStart(6, "0")}`
  },
  Id: `001Kx0000${String(i + 10).padStart(6, "0")}AAM`,
  Name, Type, Industry, BillingCity
}));

/** Demo responses that only matter for how a screenshot reads. Everything else falls through. */
async function demoRoute(route) {
  const url = route.request().url();
  const path_ = url.split("?")[0];

  if (route.request().method() === "GET" && path_.includes("/query") && url.includes("q=")) {
    const raw = url.split("q=")[1].split("&")[0];
    const query = decodeURIComponent(raw).toLowerCase();
    if (query.includes("from account")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          totalSize: DEMO_ACCOUNTS.length,
          done: true,
          records: DEMO_ACCOUNTS
        })
      });
      return true;
    }
  }
  return false;
}

test.describe("App Store screenshots", () => {
  test.beforeEach(async ({context}) => {
    await injectSessionData(context, {
      host: mockHost,
      token: mockToken,
      version: apiVersion,
      additionalSetup: createModelExposureSetup()
    });

    await context.route("**/*", async route => {
      if (await demoRoute(route)) {
        return;
      }
      if (await routeMock(route, mockHost)) {
        return;
      }
      await route.continue();
    });
  });

  /** Settle: mount, then let the async chrome that follows it finish arriving. */
  async function settle(page, ms = 2500) {
    await page.waitForSelector("#root > *", {timeout: 20000});
    await page.waitForTimeout(ms);
  }

  async function shot(page, name) {
    const scheme = await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
    if (scheme !== "dark only") {
      throw new Error(`${name}: expected the dark default, got color-scheme "${scheme}"`);
    }
    await page.screenshot({path: path.join(OUT, `${name}.png`)});
  }

  test("data export, with results", async ({page, extensionId}) => {
    await page.goto(`chrome-extension://${extensionId}/data-export.html?host=${mockHost}`);
    await page.waitForSelector("textarea#query", {timeout: 20000});
    await page.locator("textarea#query")
      .fill("SELECT Id, Name, Type, Industry, BillingCity\nFROM Account\nORDER BY Name");
    await page.click("button:has-text('Run Export')");
    await page.waitForSelector("#result-area table", {timeout: 20000});
    await page.waitForTimeout(1500);
    await shot(page, "01-data-export");
  });

  const PLAIN = [
    ["02-data-import", "data-import.html"],
    ["03-metadata-retrieve", "metadata-retrieve.html"],
    ["04-options", "options.html"],
    ["05-rest-explore", "rest-explore.html"],
    ["06-limits", "limits.html"]
  ];

  for (const [name, file] of PLAIN) {
    test(name, async ({page, extensionId}) => {
      await page.goto(`chrome-extension://${extensionId}/${file}?host=${mockHost}`);
      await settle(page);
      await shot(page, name);
    });
  }

  test("07-inspect", async ({page, extensionId}) => {
    await page.goto(`chrome-extension://${extensionId}/inspect.html?host=${mockHost}`
      + `&objectType=Account&recordId=${TEST_CONSTANTS.accountRecordId}`);
    await settle(page);
    await shot(page, "07-inspect");
  });

  test("08-dependencies-explorer", async ({page, extensionId}) => {
    await page.goto(`chrome-extension://${extensionId}/dependencies-explorer.html?host=${mockHost}`);
    await settle(page);
    await shot(page, "08-dependencies-explorer");
  });
});

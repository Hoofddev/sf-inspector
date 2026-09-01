import {test, expect} from "./fixtures";
import {TEST_CONSTANTS, injectSessionData} from "./test-helpers";
import {routeMock} from "./test-mock";

/**
 * The search box injected into the Setup flow list.
 *
 * These load a stand-in for the Setup page from the mock host, so the real content script runs
 * against it -- the manifest matches *.salesforce.com and the fixture is served at the flow list's
 * own path.
 *
 * The fixtures are deliberately awkward. Setup's header cell carries a sort arrow, assistive text
 * and a menu button, so its text is never exactly "Flow Label"; the list may be a table or an ARIA
 * grid; and it may sit inside a shadow root. Each of those broke a version of this injection, so
 * each has a fixture.
 */
test.describe("Flow search", () => {
  const {mockHost, mockToken, apiVersion} = TEST_CONSTANTS;

  const FLOW_LIST_URL = `https://${mockHost}/lightning/setup/Flows/home`;

  // A header cell as Setup actually renders one. Its text is "SortFlow LabelSorted Descending…",
  // which an early version tried to match exactly and never found.
  const headerCell = `<th aria-label="Flow Label" scope="col">
    <a href="#">Sort<span class="slds-truncate">Flow Label</span>Sorted Descending</a>
    <button type="button">Show Flow Label Column Actions</button>
  </th>`;

  // The label is split across nested markup with a line break between the words, as Setup's own
  // cells are. Matching raw textContent against a two-word search finds nothing here.
  const row = (label, api, n = 1) => `<tr>
    <td>${n}</td>
    <td><a href="#"><span>${label.split(" ")[0]}</span>
      <span>${label.split(" ").slice(1).join(" ")}</span></a></td>
    <td>${api}</td><td>Screen Flow</td></tr>`;

  const listPage = rows => `<!DOCTYPE html>
    <html><head><title>Flows | Salesforce</title></head>
    <body class="sfdcBody">
      <div id="setup-content">
        <div class="card">
          <div class="summary">50+ items &bull; Sorted by Flow Label</div>
          <div class="scroller" style="max-height:150px;overflow-y:auto">
            <table>
              <tr><th>Item Number</th>${headerCell}<th>Flow API Name</th><th>Active</th></tr>
              ${rows}
            </table>
          </div>
        </div>
      </div>
    </body></html>`;

  const threeFlows = listPage([
    row("Verify Identity", "Verify_Cust", 1),
    row("CLAUDE - TEST 2", "CLAUDE_TEST", 2),
    row("Update Signed Contact Field", "Update_Signed_Contact_Field", 3)
  ].join(""));

  const pageWithoutAList = `<!DOCTYPE html>
    <html><head><title>Flows | Salesforce</title></head>
    <body class="sfdcBody"><div id="setup-content"><p>Nothing here yet.</p></div></body></html>`;

  /** The same list as an ARIA grid rather than a table, which Lightning also produces. */
  const gridPage = `<!DOCTYPE html>
    <html><head><title>Flows | Salesforce</title></head>
    <body class="sfdcBody">
      <div role="grid">
        <div role="row"><div role="columnheader">Sort Flow Label Sorted Descending</div></div>
        <div role="row"><div role="gridcell">Basic Approval Request</div></div>
      </div>
    </body></html>`;

  /** And the same list inside a shadow root, where a Lightning component would put it. */
  const shadowPage = `<!DOCTYPE html>
    <html><head><title>Flows | Salesforce</title></head>
    <body class="sfdcBody">
      <div id="setup-content"><flow-list id="host"></flow-list></div>
      <script>
        const root = document.getElementById("host").attachShadow({mode: "open"});
        root.innerHTML = \`<table>
          <tr><th>Item Number</th>${headerCell}<th>Flow API Name</th></tr>
          ${row("Verify Identity", "Verify_Cust")}
        </table>\`;
      </script>
    </body></html>`;

  /**
   * A list that only loads more rows when scrolled, the way Setup does. Starts at 5 of 12, so a
   * search for the last one finds nothing unless the box has driven the list to load the rest.
   */
  const lazyPage = `<!DOCTYPE html>
    <html><head><title>Flows | Salesforce</title></head>
    <body class="sfdcBody">
      <div class="scroller" id="scroller" style="height:120px;overflow-y:auto">
        <table id="list">
          <tr><th>Item Number</th>${headerCell}<th>Flow API Name</th><th>Active</th></tr>
        </table>
      </div>
      <script>
        const table = document.getElementById("list");
        const scroller = document.getElementById("scroller");
        let loaded = 0;
        const TOTAL = 12;
        function addPage() {
          for (let i = 0; i < 5 && loaded < TOTAL; i++, loaded++) {
            const tr = document.createElement("tr");
            const name = loaded === TOTAL - 1 ? "Last Flow Of All" : "Flow number " + loaded;
            tr.innerHTML = "<td>" + loaded + "</td><td><a href='#'>" + name + "</a></td>"
              + "<td>api_" + loaded + "</td><td>Screen Flow</td>";
            table.append(tr);
          }
        }
        addPage();
        let fetching = false;
        scroller.addEventListener("scroll", () => {
          if (fetching || scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 4) { return; }
          // Answering after 600ms is what a page of rows from the server costs. A load loop that
          // waits only a couple of hundred milliseconds concludes the list has ended right here.
          fetching = true;
          setTimeout(() => { addPage(); fetching = false; }, 600);
        });
      </script>
    </body></html>`;

  async function open(page, context, body, url = FLOW_LIST_URL) {
    await injectSessionData(context, {host: mockHost, token: mockToken, version: apiVersion});

    await context.route("**/*", async route => {
      if (route.request().url().startsWith(url)) {
        await route.fulfill({status: 200, contentType: "text/html", body});
        return;
      }
      if (await routeMock(route, mockHost)) {
        return;
      }
      await route.continue();
    });

    await page.goto(url);
  }

  const box = page => page.locator("#sfi-flow-search .sfi-flow-search__input");
  const status = page => page.locator("#sfi-flow-search .sfi-flow-search__status");
  const visibleLabels = page => page.locator("table tr:not([data-sfi-filtered]) td:nth-child(2) a");

  test("adds a search box above the column headers, spanning the list", async ({page, context}) => {
    await open(page, context, threeFlows);
    await expect(box(page)).toBeVisible({timeout: 10000});

    // Asserted on the laid-out result rather than on where it was inserted: the injection climbs
    // until the layout agrees, so where it ends up is what matters.
    const placement = await page.evaluate(() => {
      const search = document.getElementById("sfi-flow-search").getBoundingClientRect();
      const header = [...document.querySelectorAll("th")]
        .find(cell => /flow\s*label/i.test(cell.textContent || "")).getBoundingClientRect();
      const list = document.querySelector("table").getBoundingClientRect();
      return {above: search.top < header.top, ratio: search.width / list.width};
    });
    expect(placement.above).toBe(true);
    expect(placement.ratio).toBeGreaterThan(0.9);
  });

  test("filters the list in place, keeping Setup's own rows", async ({page, context}) => {
    await open(page, context, threeFlows);
    await expect(box(page)).toBeVisible({timeout: 10000});

    await box(page).fill("claude");
    await expect(visibleLabels(page)).toHaveText(["CLAUDE - TEST 2"]);

    // The row is Setup's own, still in Setup's own table -- not a copy in a dropdown.
    await expect(status(page)).toContainText("1 of 3");
    await expect(page.locator("table tr")).toHaveCount(4);
  });

  test("matches a search of more than one word", async ({page, context}) => {
    await open(page, context, threeFlows);
    await expect(box(page)).toBeVisible({timeout: 10000});

    // The whole label, which is the obvious thing to type and the thing that used to fail: the
    // words are in separate elements, so the cell's raw text has a line break between them.
    await box(page).fill("Verify Identity");
    await expect(visibleLabels(page)).toHaveText(["Verify Identity"]);
    await expect(status(page)).toContainText("1 of 3");
  });

  test("matches the API name as well as the label", async ({page, context}) => {
    await open(page, context, threeFlows);
    await expect(box(page)).toBeVisible({timeout: 10000});

    await box(page).fill("Update_Signed");
    await expect(visibleLabels(page)).toHaveText(["Update Signed Contact Field"]);
  });

  test("restores every row when the search is cleared", async ({page, context}) => {
    await open(page, context, threeFlows);
    await expect(box(page)).toBeVisible({timeout: 10000});

    await box(page).fill("claude");
    await expect(visibleLabels(page)).toHaveCount(1);

    await box(page).fill("");
    await expect(visibleLabels(page)).toHaveCount(3);

    // Restored to Setup's own display value, with nothing of ours left behind.
    const residue = await page.evaluate(() => ({
      marked: document.querySelectorAll("[data-sfi-filtered]").length,
      inlineDisplay: [...document.querySelectorAll("table tr")].filter(r => r.style.display).length
    }));
    expect(residue).toEqual({marked: 0, inlineDisplay: 0});
  });

  test("Escape clears the filter", async ({page, context}) => {
    await open(page, context, threeFlows);
    await expect(box(page)).toBeVisible({timeout: 10000});

    await box(page).fill("claude");
    await expect(visibleLabels(page)).toHaveCount(1);

    await box(page).press("Escape");
    await expect(visibleLabels(page)).toHaveCount(3);
  });

  test("loads the whole list on arrival, without waiting to be asked", async ({page, context}) => {
    await open(page, context, lazyPage);
    await expect(box(page)).toBeVisible({timeout: 10000});

    // Nothing is typed here at all. The list starts at 5 of 12 and has to reach 12 on its own,
    // so that a search does not have to wait for the scroll it used to trigger.
    await expect(status(page)).toContainText("12 flows", {timeout: 20000});
    await expect(page.locator("table tr")).toHaveCount(13);
  });

  test("filters rows Setup had not fetched when the page opened", async ({page, context}) => {
    await open(page, context, lazyPage);
    await expect(box(page)).toBeVisible({timeout: 10000});

    // This row is not in the DOM when the page loads; it only exists once the list has been driven
    // to the bottom, so finding it proves the search covers more than the first page.
    await expect(page.locator("table tr")).toHaveCount(6);

    await box(page).fill("Last Flow Of All");
    await expect(visibleLabels(page)).toHaveText(["Last Flow Of All"], {timeout: 20000});
    await expect(status(page)).toContainText("1 of 12");
  });

  test("finds the list when it is an ARIA grid rather than a table", async ({page, context}) => {
    await open(page, context, gridPage);
    await expect(box(page)).toBeVisible({timeout: 10000});
  });

  test("mounts outside the shadow root the list lives in", async ({page, context}) => {
    await open(page, context, shadowPage);
    await expect(box(page)).toBeVisible({timeout: 10000});

    // A content script's stylesheet does not reach inside a shadow root, so a box mounted in there
    // would render unstyled.
    const inLightDom = await page.evaluate(() =>
      document.getElementById("sfi-flow-search").getRootNode() === document);
    expect(inLightDom).toBe(true);
  });

  test("leaves a page with no flow list alone", async ({page, context}) => {
    await open(page, context, pageWithoutAList);
    await page.waitForTimeout(1500);
    await expect(page.locator("#sfi-flow-search")).toHaveCount(0);
  });

  test("stays out of pages that are not the flow list", async ({page, context}) => {
    await open(page, context, threeFlows, `https://${mockHost}/lightning/setup/ObjectManager/home`);
    await page.waitForTimeout(1500);
    await expect(page.locator("#sfi-flow-search")).toHaveCount(0);
  });
});

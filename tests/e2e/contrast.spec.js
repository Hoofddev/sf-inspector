import {test, expect} from "./fixtures";
import {
  TEST_CONSTANTS,
  injectSessionData,
  createModelExposureSetup
} from "./test-helpers";
import {routeMock} from "./test-mock";

/**
 * Text contrast, every page, both colour schemes.
 *
 * The theme follows the system appearance (color-scheme: light dark in
 * styles/sf-inspector-theme.css), so every colour is written as a light-dark() pair and both halves
 * have to hold up. The failure this guards against has already appeared three times in this
 * codebase: a *surface* token used where a text colour was meant. It looks right in one scheme --
 * --slds-g-color-surface-container-1 is #ffffff in light -- and turns into near-black text on a
 * near-black panel in the other. It is invisible in review and invisible in a screenshot of the
 * scheme you happen to be in.
 *
 * Checking computed colours alone is not enough, because the panels, buttons and toggles are
 * translucent: an element's own background is frequently rgba(255, 255, 255, .09), and what the
 * text actually sits on is that composited over its ancestors and the page ground. The audit below
 * therefore walks up the ancestor chain, composites, and only then measures.
 */
test.describe("Contrast", () => {
  const {mockHost, mockToken, apiVersion, accountRecordId, flowId, flowDefId} = TEST_CONSTANTS;

  // Every page that renders the theme standalone. The popup is covered separately below, because
  // it only runs inside a frame.
  const PAGES = [
    {name: "options", url: `options.html?host=${mockHost}`},
    {name: "data-export", url: `data-export.html?host=${mockHost}`},
    {name: "data-import", url: `data-import.html?host=${mockHost}`},
    {name: "metadata-retrieve", url: `metadata-retrieve.html?host=${mockHost}`},
    {name: "limits", url: `limits.html?host=${mockHost}`},
    {name: "rest-explore", url: `rest-explore.html?host=${mockHost}`},
    {name: "explore-api", url: `explore-api.html?host=${mockHost}`},
    {name: "event-monitor", url: `event-monitor.html?host=${mockHost}`},
    {name: "dependencies-explorer", url: `dependencies-explorer.html?host=${mockHost}`},
    {name: "field-creator", url: `field-creator.html?host=${mockHost}`},
    {name: "api-statistics", url: `api-statistics.html?host=${mockHost}`},
    {name: "inspect", url: `inspect.html?host=${mockHost}&objectType=Account&recordId=${accountRecordId}`},
    {name: "debug-log", url: `debug-log.html?host=${mockHost}`},
    {name: "flow-scanner", url: `flow-scanner.html?host=${mockHost}&flowId=${flowId}&flowDefId=${flowDefId}`}
  ];

  /**
   * Runs in the page. Returns one entry per element whose text fails WCAG AA against the background
   * it is really drawn on, worst first.
   */
  const auditContrast = () => {
    const parseColor = value => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) {
        return null;
      }
      const parts = match[1].split(",").map(part => parseFloat(part));
      return {r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1};
    };

    // Source-over: `top` (which may be translucent) painted onto an opaque `bottom`.
    const composite = (top, bottom) => {
      const blend = (over, under) => (over * top.a) + (under * (1 - top.a));
      return {
        r: blend(top.r, bottom.r),
        g: blend(top.g, bottom.g),
        b: blend(top.b, bottom.b),
        a: 1
      };
    };

    const luminance = color => {
      const channel = raw => {
        const v = raw / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return (0.2126 * channel(color.r)) + (0.7152 * channel(color.g)) + (0.0722 * channel(color.b));
    };

    const contrastRatio = (a, b) => {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high + 0.05) / (low + 0.05);
    };

    // The ground the whole page is painted on. html carries an opaque colour (section 2 of the
    // theme), so the composite always terminates here.
    const groundRaw = parseColor(getComputedStyle(document.documentElement).backgroundColor)
      || {r: 255, g: 255, b: 255, a: 1};
    const ground = {r: groundRaw.r, g: groundRaw.g, b: groundRaw.b, a: 1};

    // Collect every background between the element and the ground, then paint them back down in
    // that order. Stops at the first opaque one, since nothing below it can show through.
    const effectiveBackground = element => {
      const layers = [];
      for (let node = element; node && node.nodeType === 1; node = node.parentElement) {
        const color = parseColor(getComputedStyle(node).backgroundColor);
        if (color && color.a > 0) {
          layers.push(color);
          if (color.a === 1) {
            break;
          }
        }
      }
      return layers.reduceRight((below, layer) => composite(layer, below), ground);
    };

    const failures = [];
    const reported = new Set();

    for (const element of document.querySelectorAll("*")) {
      const styles = getComputedStyle(element);
      if (styles.display === "none" || styles.visibility === "hidden" || parseFloat(styles.opacity) < 0.15) {
        continue;
      }

      const box = element.getBoundingClientRect();
      if (box.width < 4 || box.height < 4) {
        continue;
      }

      // Only elements holding their own text. Measuring a container would attribute its background
      // to text that is really drawn on a descendant's.
      const ownText = Array.from(element.childNodes)
        .filter(node => node.nodeType === 3)
        .map(node => node.textContent.trim())
        .join(" ")
        .trim();
      if (ownText.length < 2) {
        continue;
      }

      const textColor = parseColor(styles.color);
      if (!textColor) {
        continue;
      }

      const background = effectiveBackground(element);
      const foreground = textColor.a < 1 ? composite(textColor, background) : textColor;
      const ratio = contrastRatio(foreground, background);

      // WCAG AA: 3:1 for large text (>= 24px, or >= 18.66px when bold), 4.5:1 otherwise.
      const fontSize = parseFloat(styles.fontSize);
      const isBold = parseInt(styles.fontWeight, 10) >= 700;
      const isLarge = fontSize >= 24 || (fontSize >= 18.66 && isBold);
      const required = isLarge ? 3 : 4.5;

      if (ratio >= required) {
        continue;
      }

      // One report per distinct element/colour combination: a failing rule usually applies to a
      // whole row of buttons, and fifteen copies of it is not fifteen problems.
      const signature = `${element.tagName}|${element.className}|${styles.color}`;
      if (reported.has(signature)) {
        continue;
      }
      reported.add(signature);

      const rgb = color => `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
      failures.push({
        ratio: Number(ratio.toFixed(2)),
        required,
        text: ownText.slice(0, 40),
        selector: `${element.tagName.toLowerCase()}${element.className ? "." + element.className.toString().trim().split(/\s+/).join(".") : ""}`,
        color: styles.color,
        on: rgb(background)
      });
    }

    return failures.sort((a, b) => a.ratio - b.ratio);
  };

  for (const scheme of ["light", "dark"]) {
    test.describe(scheme, () => {
      test.beforeEach(async ({context}) => {
        // 0. Pin the appearance.
        //
        // emulateMedia alone stopped being enough when dark became the default: with nothing
        // stored, theme-init sets color-scheme to `dark only`, which light-dark() reads instead of
        // the media query. Both halves of this suite then rendered dark and the light half tested
        // nothing. The setting has to be stored where theme-init actually looks -- extension
        // storage, not localStorage, which it treats as a cache and corrects from.
        let [worker] = context.serviceWorkers();
        if (!worker) {
          worker = await context.waitForEvent("serviceworker");
        }
        await worker.evaluate(async value => {
          await chrome.storage.local.set({sfiTheme: value});
        }, scheme);

        // 1. Inject Fake Session Data with model exposure setup
        await injectSessionData(context, {
          host: mockHost,
          token: mockToken,
          version: apiVersion,
          additionalSetup: createModelExposureSetup()
        });

        // 2. Mock Salesforce API Calls
        await context.route("**/*", async route => {
          if (!TEST_CONSTANTS.mockEnabled) {
            await route.continue();
            return;
          }

          if (await routeMock(route, mockHost)) {
            return;
          }

          await route.continue();
        });
      });

      for (const {name, url} of PAGES) {
        test(`${name} has no unreadable text`, async ({page, extensionId}) => {
          await page.emulateMedia({colorScheme: scheme});
          await page.setViewportSize({width: 1440, height: 900});
          await page.goto(`chrome-extension://${extensionId}/${url}`);

          // Wait for the app to mount, then let the remaining async chrome settle. Colours are only
          // meaningful once what they belong to is on screen.
          await page.waitForSelector("#root > *", {timeout: 10000});
          await page.waitForTimeout(2000);

          const failures = await page.evaluate(auditContrast);

          const report = failures
            .map(f => `  ${f.ratio}:1 (needs ${f.required}:1)  ${f.color} on ${f.on}  ${f.selector}  "${f.text}"`)
            .join("\n");

          expect(failures, `${name} (${scheme}) has text below WCAG AA:\n${report}\n`).toEqual([]);
        });
      }

      /**
       * The export result table, which only exists after a query has run.
       *
       * The page-level audits above load each page and measure what is on it, and a table that
       * appears only in response to a query is not on it. That gap let .scrolltable-cell ship with
       * `background-color: white` hardcoded: in dark mode it painted white cells under the theme's
       * near-white text, at 1.12:1, on the flagship feature. Every page audit passed the whole time,
       * because none of them had ever run a query.
       */
      test("export results have no unreadable text", async ({page, extensionId}) => {
        await page.emulateMedia({colorScheme: scheme});
        await page.setViewportSize({width: 1440, height: 900});
        await page.goto(`chrome-extension://${extensionId}/data-export.html?host=${mockHost}`);

        await page.waitForSelector("textarea#query", {timeout: 10000});
        await page.locator("textarea#query").fill("SELECT Id, Name, Type FROM Account");
        await page.click("button:has-text('Run Export')");
        await page.waitForSelector("#result-area table tr td", {timeout: 10000});

        // Clicking leaves the pointer on the button and the focus ring on it, so an audit taken
        // here measures Run Export's hover state rather than the results. Move both away: this test
        // is about the table, and the resting button is already covered by the page audit above.
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.activeElement && document.activeElement.blur());
        await page.waitForTimeout(1000);

        const failures = await page.evaluate(auditContrast);

        const report = failures
          .map(f => `  ${f.ratio}:1 (needs ${f.required}:1)  ${f.color} on ${f.on}  ${f.selector}  "${f.text}"`)
          .join("\n");

        expect(failures, `export results (${scheme}) have text below WCAG AA:\n${report}\n`).toEqual([]);
      });

      // The popup only runs inside a frame: popup.js reads document.location.ancestorOrigins[0] at
      // module scope, which throws when there is no ancestor, and it renders nothing until the
      // parent answers the init request it posts. So it is loaded the way button.js loads it --
      // in an iframe on a page that replies -- and audited inside that frame. An extension page is
      // used as the host so the frame is same-origin and can be reached.
      test("popup has no unreadable text", async ({page, extensionId}) => {
        await page.emulateMedia({colorScheme: scheme});
        await page.setViewportSize({width: 1280, height: 900});
        await page.goto(`chrome-extension://${extensionId}/options.html?host=${mockHost}`);

        await page.evaluate(({id, host}) => {
          window.addEventListener("message", event => {
            if (event.data && event.data.insextInitRequest) {
              event.source.postMessage({
                insextInitResponse: true,
                sfHost: host,
                inDevConsole: false,
                inLightning: false,
                inInspector: false
              }, "*");
            }
          });

          const frame = document.createElement("iframe");
          frame.id = "popup-under-test";
          frame.src = `chrome-extension://${id}/popup.html?host=${host}`;
          frame.style.cssText = "width:400px;height:900px;border:0;position:fixed;inset:0;z-index:9999";
          document.body.appendChild(frame);
        }, {id: extensionId, host: mockHost});

        const frame = await (await page.waitForSelector("#popup-under-test")).contentFrame();
        await frame.waitForSelector("#root > *", {timeout: 10000});
        await page.waitForTimeout(2000);

        const failures = await frame.evaluate(auditContrast);

        const report = failures
          .map(f => `  ${f.ratio}:1 (needs ${f.required}:1)  ${f.color} on ${f.on}  ${f.selector}  "${f.text}"`)
          .join("\n");

        expect(failures, `popup (${scheme}) has text below WCAG AA:\n${report}\n`).toEqual([]);
      });
    });
  }
});

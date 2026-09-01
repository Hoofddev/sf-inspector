import {test, expect} from "./fixtures";
import {
  TEST_CONSTANTS,
  injectSessionData,
  createModelExposureSetup
} from "./test-helpers";
import {routeMock} from "./test-mock";

/**
 * The appearance setting: the footer's sun/moon switch, and the stored value behind it.
 *
 * The mechanism is one attribute on the root element, set by theme-init.js from localStorage
 * before first paint. color-scheme is what light-dark() resolves against, so flipping it flips
 * every token at once -- these tests therefore check the computed color-scheme and the painted
 * ground rather than any individual colour, since everything else follows from those.
 */
test.describe("Appearance", () => {
  const {mockHost, mockToken, apiVersion} = TEST_CONSTANTS;

  const LIGHT_GROUND = "rgb(244, 242, 251)";
  const DARK_GROUND = "rgb(22, 22, 26)";

  test.beforeEach(async ({context}) => {
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

  const readAppearance = page => page.evaluate(() => ({
    stored: window.sfiTheme.get(),
    attribute: document.documentElement.getAttribute("data-sfi-theme"),
    scheme: getComputedStyle(document.documentElement).colorScheme,
    ground: getComputedStyle(document.documentElement).backgroundColor
  }));

  async function openPage(page, extensionId, colorScheme) {
    await page.emulateMedia({colorScheme});
    await page.goto(`chrome-extension://${extensionId}/data-export.html?host=${mockHost}`);
    await page.waitForSelector("#root > *", {timeout: 10000});
  }

  for (const desktop of ["light", "dark"]) {
    test(`follows a ${desktop} desktop when nothing is stored`, async ({page, extensionId}) => {
      await openPage(page, extensionId, desktop);

      const appearance = await readAppearance(page);
      expect(appearance.stored).toBe("system");
      expect(appearance.attribute).toBeNull();
      expect(appearance.scheme).toBe("light dark");
      expect(appearance.ground).toBe(desktop === "dark" ? DARK_GROUND : LIGHT_GROUND);
    });
  }

  test("a stored choice overrides the desktop in both directions", async ({page, extensionId}) => {
    await openPage(page, extensionId, "light");

    await page.evaluate(() => window.sfiTheme.set("dark"));
    let appearance = await readAppearance(page);
    expect(appearance.scheme).toBe("dark only");
    expect(appearance.ground).toBe(DARK_GROUND);

    await page.emulateMedia({colorScheme: "dark"});
    await page.evaluate(() => window.sfiTheme.set("light"));
    appearance = await readAppearance(page);
    expect(appearance.scheme).toBe("light only");
    expect(appearance.ground).toBe(LIGHT_GROUND);
  });

  test("returning to system hands the choice back to the desktop", async ({page, extensionId}) => {
    await openPage(page, extensionId, "dark");

    await page.evaluate(() => window.sfiTheme.set("light"));
    expect((await readAppearance(page)).ground).toBe(LIGHT_GROUND);

    await page.evaluate(() => window.sfiTheme.set("system"));
    const appearance = await readAppearance(page);
    expect(appearance.attribute).toBeNull();
    expect(appearance.ground).toBe(DARK_GROUND);
  });

  test("the choice survives a reload, and is applied before first paint", async ({page, extensionId}) => {
    await openPage(page, extensionId, "light");
    await page.evaluate(() => window.sfiTheme.set("dark"));

    await page.reload();
    // Read before waiting for the app to mount: theme-init.js runs from <head>, so the attribute
    // has to be there already. Waiting first would hide a flash of the wrong scheme.
    const early = await page.evaluate(() => document.documentElement.getAttribute("data-sfi-theme"));
    expect(early).toBe("dark");

    await page.waitForSelector("#root > *", {timeout: 10000});
    expect((await readAppearance(page)).ground).toBe(DARK_GROUND);
  });

  test("the setting is shared across pages", async ({page, extensionId}) => {
    await openPage(page, extensionId, "light");
    await page.evaluate(() => window.sfiTheme.set("dark"));

    await page.goto(`chrome-extension://${extensionId}/options.html?host=${mockHost}`);
    await page.waitForSelector("#root > *", {timeout: 10000});
    expect((await readAppearance(page)).ground).toBe(DARK_GROUND);
  });

  test("the footer switch cycles light, dark, system", async ({page, extensionId}) => {
    // The popup only runs inside a frame: it reads ancestorOrigins at module scope and renders
    // nothing until the parent answers its init request. Loaded here the way button.js loads it.
    await page.emulateMedia({colorScheme: "light"});
    // Tall enough that the frame's footer is on screen: the switch is the last thing in it, and
    // Playwright will not click what it cannot scroll into view.
    await page.setViewportSize({width: 1280, height: 1000});
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

      const element = document.createElement("iframe");
      element.id = "popup-under-test";
      element.src = `chrome-extension://${id}/popup.html?host=${host}`;
      element.style.cssText = "width:400px;height:820px;border:0;position:fixed;inset:0;z-index:9999";
      document.body.appendChild(element);
    }, {id: extensionId, host: mockHost});

    const frame = await (await page.waitForSelector("#popup-under-test")).contentFrame();
    await frame.waitForSelector("#themeBtn .sfir-theme-toggle", {timeout: 10000});

    const button = frame.locator("#themeBtn .sfir-theme-toggle");
    const current = () => frame.evaluate(() => window.sfiTheme.get());

    expect(await current()).toBe("system");
    await button.click();
    expect(await current()).toBe("light");
    await button.click();
    expect(await current()).toBe("dark");
    await button.click();
    expect(await current()).toBe("system");
  });
});

/**
 * The toggle's knob.
 *
 * SLDS moves the knob between the faux element's two pseudo-elements rather than sliding one: off
 * it is ::after at the left, on it is ::before at the right and ::after becomes a tick. The theme
 * restyles the knob, so it has to follow that swap -- getting it wrong shows up as a white square
 * inside a toggle that is on, or as no knob at all on one that is off, and neither is something a
 * colour-contrast check would notice.
 */
test.describe("Toggle knob", () => {
  const {mockHost, mockToken, apiVersion} = TEST_CONSTANTS;

  test.beforeEach(async ({context}) => {
    await injectSessionData(context, {
      host: mockHost,
      token: mockToken,
      version: apiVersion,
      additionalSetup: createModelExposureSetup()
    });

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

  test("is a single round knob in both states, and nothing else", async ({page, extensionId}) => {
    await page.goto(`chrome-extension://${extensionId}/options.html?host=${mockHost}`);
    await page.waitForSelector(".slds-checkbox_toggle", {timeout: 10000});

    const shapes = await page.evaluate(() => {
      const describe = checked => {
        const input = Array.from(document.querySelectorAll(".slds-checkbox_toggle input[type=checkbox]"))
          .find(candidate => candidate.checked === checked);
        if (!input) {
          return null;
        }
        const faux = input.parentElement.querySelector(".slds-checkbox_faux");
        return ["::before", "::after"].map(pseudo => {
          const style = getComputedStyle(faux, pseudo);
          return {
            drawn: style.content !== "none" && style.display !== "none",
            width: parseFloat(style.width),
            height: parseFloat(style.height)
          };
        });
      };
      return {on: describe(true), off: describe(false)};
    });

    for (const state of ["on", "off"]) {
      const drawn = shapes[state].filter(shape => shape.drawn);
      // Exactly one shape, and it is the round 20px knob -- not a 7x11 tick, and not nothing.
      expect(drawn, `${state}: expected one drawn pseudo-element, got ${JSON.stringify(shapes[state])}`).toHaveLength(1);
      expect(drawn[0].width).toBeCloseTo(20, 0);
      expect(drawn[0].height).toBeCloseTo(20, 0);
    }
  });
});

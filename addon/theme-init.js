/**
 * Appearance, applied before first paint.
 *
 * The theme's tokens are all light-dark() pairs, and :root declares `color-scheme: light dark`, so
 * `system` lets the pages follow the desktop. A fresh install is dark rather than `system`; a
 * stored choice, `system` included, overrides that by setting
 * color-scheme to `only light` / `only dark` on the root element, which is what light-dark() reads
 * -- so one attribute flips every token at once, with no second set of rules to keep in step.
 *
 * This is a classic script rather than a module, and it is loaded from <head>, because it has to
 * run before the first paint: applied any later, a page stored as dark would flash light first.
 *
 * Two stores, deliberately:
 *
 * chrome.storage.local is the source of truth. It is shared by every page and frame of the
 * extension and is not partitioned, which localStorage is: the popup runs as a third-party frame
 * inside the Salesforce page, and Safari gives such a frame its own localStorage bucket keyed by
 * the top-level site. Storing the setting there meant the popup changed appearance and the tool
 * pages, opened as first-party tabs, never saw it.
 *
 * localStorage is kept as a synchronous cache, because extension storage is async and reading it
 * would land after the first paint. So the cached value paints immediately and the authoritative
 * one corrects it a tick later if they disagree -- which they only do on the first load after a
 * change made somewhere this page could not see.
 */
(() => {
  const STORAGE_KEY = "sfiTheme";
  const ATTRIBUTE = "data-sfi-theme";
  const ORDER = {light: "dark", dark: "system", system: "light"};

  // What an installation starts as, before anyone has chosen. Dark is deliberate rather than a
  // reflection of the desktop: it is the appearance the product is designed and shown in.
  // "system" remains available -- it is now something you pick, not what you get by default.
  const DEFAULT = "dark";

  const area = globalThis.chrome && chrome.storage ? chrome.storage.local : null;
  const listeners = new Set();

  // An unrecognised or absent value is a fresh install, which gets DEFAULT. "system" has to survive
  // this untouched: it is a real choice, and it has to be distinguishable from having chosen nothing.
  const normalise = value =>
    (value === "light" || value === "dark" || value === "system" ? value : DEFAULT);

  const readCache = () => {
    try {
      return normalise(localStorage.getItem(STORAGE_KEY));
    } catch {
      // Site data blocked. Following the desktop is the right fallback: it is what an unset
      // preference does anyway.
      return "system";
    }
  };

  const writeCache = value => {
    try {
      // Every value is written, "system" included. Removing the key used to be equivalent, back when
      // an absent key meant "follow the desktop"; now an absent key means DEFAULT, so clearing it
      // would quietly turn a deliberate "system" into dark on the next load.
      localStorage.setItem(STORAGE_KEY, value);
    } catch {
      // Nothing to cache to; the attribute still applies for this page's lifetime.
    }
  };

  let current = readCache();

  const paint = value => {
    const changed = value !== current;
    current = value;
    if (value === "system") {
      document.documentElement.removeAttribute(ATTRIBUTE);
    } else {
      document.documentElement.setAttribute(ATTRIBUTE, value);
    }
    if (changed) {
      listeners.forEach(listener => listener(value));
    }
  };

  // Before anything else, so the page paints once, in the right scheme.
  paint(current);

  if (area) {
    area.get(STORAGE_KEY, result => {
      const stored = normalise(result && result[STORAGE_KEY]);
      if (stored !== current) {
        paint(stored);
        writeCache(stored);
      }
    });

    // Carries a change to every other page and frame of the extension, the popup included.
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local" || !Object.prototype.hasOwnProperty.call(changes, STORAGE_KEY)) {
        return;
      }
      const stored = normalise(changes[STORAGE_KEY].newValue);
      paint(stored);
      writeCache(stored);
    });
  }

  window.sfiTheme = {
    /** @returns {"light"|"dark"|"system"} */
    get: () => current,

    set(value) {
      const next = normalise(value);
      paint(next);
      writeCache(next);
      if (area) {
        area.set({[STORAGE_KEY]: next});
      }
      return next;
    },

    /** Light -> dark -> follow the desktop -> light. */
    next() {
      return window.sfiTheme.set(ORDER[current]);
    },

    /** Notified whenever the appearance changes, wherever the change was made. */
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
})();

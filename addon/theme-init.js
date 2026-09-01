/**
 * Appearance, applied before first paint.
 *
 * The theme's tokens are all light-dark() pairs, and :root declares `color-scheme: light dark`, so
 * with nothing stored the pages follow the desktop. A stored choice overrides that by setting
 * color-scheme to `only light` / `only dark` on the root element, which is what light-dark() reads
 * -- so one attribute flips every token at once, with no second set of rules to keep in step.
 *
 * This is a classic script rather than a module, and it is loaded from <head>, because it has to
 * run before the first paint: applied any later, a page stored as dark would flash light first.
 *
 * The key lives on the extension origin, so every page shares one setting, and the storage event
 * carries a change made in one tab to the pages already open in the others.
 */
(() => {
  const STORAGE_KEY = "sfiTheme";
  const ATTRIBUTE = "data-sfi-theme";

  /** @returns {"light"|"dark"|"system"} */
  const stored = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === "light" || value === "dark" ? value : "system";
    } catch {
      // localStorage throws when site data is blocked. Following the desktop is the right
      // fallback: it is what an unset preference does anyway.
      return "system";
    }
  };

  const apply = () => {
    const value = stored();
    if (value === "system") {
      document.documentElement.removeAttribute(ATTRIBUTE);
    } else {
      document.documentElement.setAttribute(ATTRIBUTE, value);
    }
    return value;
  };

  apply();

  // A change made on one page reaches the pages already open on the others.
  addEventListener("storage", event => {
    if (event.key === STORAGE_KEY || event.key === null) {
      apply();
    }
  });

  window.sfiTheme = {
    get: stored,

    set(value) {
      try {
        if (value === "system") {
          localStorage.removeItem(STORAGE_KEY);
        } else {
          localStorage.setItem(STORAGE_KEY, value);
        }
      } catch {
        // Nothing to persist to; the attribute still applies for this page's lifetime.
      }
      return apply();
    },

    /** Light -> dark -> follow the desktop -> light. */
    next() {
      const order = {light: "dark", dark: "system", system: "light"};
      return window.sfiTheme.set(order[stored()]);
    }
  };
})();

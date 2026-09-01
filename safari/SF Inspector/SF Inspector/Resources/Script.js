/**
 * The container app's first-run screen.
 *
 * ViewController calls show() with the extension's state, both when the window first loads and
 * again whenever the app comes back to the front -- so returning from Safari's settings updates the
 * checklist rather than leaving it showing what was true a minute ago.
 */

/**
 * @param {boolean|null} enabled  whether Safari reports the extension as on, or null if it could
 *                                not be determined
 * @param {boolean} usesSettings  macOS 13 and later call the window "Settings"; before that,
 *                                "Preferences". Wrong wording here sends the reader looking for a
 *                                menu item that does not exist.
 */
function show(enabled, usesSettings) {
  const noun = usesSettings ? "Settings" : "Preferences";
  const enable = document.getElementById("step-enable");
  const access = document.getElementById("step-access");
  const status = document.getElementById("status");

  document.getElementById("open-settings").textContent = `Open Safari ${noun}…`;

  if (enabled === true) {
    enable.classList.add("step--done");
    access.classList.remove("step--waiting");
    status.textContent = "Ready. Open a Salesforce page to start.";
    return;
  }

  enable.classList.remove("step--done");
  // Until the first step is done the second cannot be acted on, so it is held back rather than
  // presented as something to do now.
  access.classList.add("step--waiting");

  status.textContent = enabled === false
    ? `The extension is off. Turn it on in Safari ${noun}.`
    : `Could not tell whether the extension is on. Check Safari ${noun}.`;
}

document.getElementById("open-settings").addEventListener("click", () => {
  webkit.messageHandlers.controller.postMessage("open-settings");
});

document.getElementById("open-docs").addEventListener("click", () => {
  webkit.messageHandlers.controller.postMessage("open-docs");
});

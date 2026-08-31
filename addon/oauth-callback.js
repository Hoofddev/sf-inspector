// Content script that runs only on the hosted OAuth callback page.
//
// Safari assigns every installation of an extension its own random UUID, so
// "safari-web-extension://<uuid>/data-export.html" cannot be registered as the redirect URI of a
// Salesforce Connected App (which requires an exact match and allows no wildcards). Safari also
// refuses to follow a redirect from an https page to a custom scheme.
//
// The Connected App therefore points at a static https page we control, and this script hands the
// authorization code back to the extension. The PKCE code_verifier never leaves the extension, so
// an intercepted authorization code cannot be exchanged for a token on its own.

(() => {
  const api = typeof browser === "undefined" ? chrome : browser;

  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const error = params.get("error_description") || params.get("error");

  function report(status, detail) {
    document.documentElement.setAttribute("data-sfir-status", status);
    const target = document.getElementById("sfir-status");
    if (target) {
      target.textContent = detail;
      target.dataset.status = status;
    }
  }

  if (error) {
    report("error", error);
    return;
  }

  if (!code || !state) {
    // Someone opened the callback page directly. The page's own copy explains what it is for.
    return;
  }

  api.runtime.sendMessage({message: "oauthCallback", code, state}, () => {
    if (api.runtime.lastError) {
      report("error", "Could not reach the extension: " + api.runtime.lastError.message);
      return;
    }
    report("done", "Connected. You can close this tab.");
  });
})();

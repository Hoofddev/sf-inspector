// Throwaway diagnostic. Safari reports more than one cookie store and returns nothing when the
// store is not named explicitly (Apple Developer Forums threads 761323 and 768065). The published
// workaround is to enumerate the stores and query each one by id. That fixes reads of ordinary
// cookies, but every account says nothing about HttpOnly cookies, which Apple states are never
// exposed to extensions -- and Salesforce marks "sid" HttpOnly.
//
// This page settles that question on the machine in front of you instead of from forum posts about
// an older Safari. If it ever reports the sid cookie as readable, the OAuth requirement (and the
// Connected App the user has to register) can be dropped entirely.
//
// Delete this file, safari-cookie-diagnostic.html and the "cookieDiagnostic" handler in background.js
// once the answer is recorded.

const api = typeof browser === "undefined" ? chrome : browser;

const hostInput = document.getElementById("host");
const runButton = document.getElementById("run");
const output = document.getElementById("output");
const verdict = document.getElementById("verdict");

function setVerdict(text, kind) {
  verdict.textContent = text;
  verdict.dataset.kind = kind;
}

runButton.addEventListener("click", async () => {
  const host = hostInput.value.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!host) {
    setVerdict("Enter a Salesforce host first.", "warn");
    return;
  }

  output.textContent = "Running…";
  setVerdict("", "");

  const report = await new Promise(resolve =>
    api.runtime.sendMessage({message: "cookieDiagnostic", host}, resolve));

  if (!report) {
    output.textContent = "No response from the background script.";
    setVerdict("Inconclusive — the background script did not answer.", "warn");
    return;
  }

  output.textContent = JSON.stringify(report, null, 2);

  if (report.error) {
    setVerdict("Inconclusive — " + report.error, "warn");
  } else if (report.sidFound) {
    setVerdict("sid IS readable. OAuth may not be required after all — re-check the architecture.", "good");
  } else if (report.anyCookieFound) {
    setVerdict("Cookies are readable, but sid is not. HttpOnly is still withheld, so OAuth stays required.", "bad");
  } else {
    setVerdict("No cookies at all. Either not logged in to this host, or the cookies permission is not granted.", "warn");
  }
});

// Prefill with whatever Salesforce host is currently open, so there is nothing to type in the
// common case.
api.tabs.query({}, tabs => {
  const match = (tabs || [])
    .map(t => { try { return new URL(t.url).hostname; } catch { return ""; } })
    .find(h => /\.(my\.salesforce|lightning\.force|salesforce)\.com$/.test(h));
  if (match) {
    hostInput.value = match;
  }
});

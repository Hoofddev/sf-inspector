// Temporary diagnostic. Answers one question: can this Safari read the HttpOnly Salesforce "sid"
// cookie? Apple states HttpOnly cookies are never exposed to extensions, which is why this port
// authenticates through OAuth instead. The published workaround for Safari returning no cookies --
// enumerating cookies.getAllCookieStores() and querying each store by id -- only addresses an empty
// default store, and every account of it concerns ordinary cookies on Safari 18.
//
// If this ever reports sid as readable, the OAuth path and the Connected App users must register
// can both be dropped.
//
// Runs as a content script on Salesforce pages so the result lands in the ordinary page console:
// the cookies API itself lives in the background, but reaching a background page in Safari needs
// the extension's per-install UUID and the tabs API, neither of which is conveniently available.
//
// Delete this file, its entry in manifest-safari.json, and the "cookieDiagnostic" handler in
// background.js once the answer is recorded.

(() => {
  // all_frames is true for this content script, but one report per page load is enough.
  if (window.top !== window) {
    return;
  }

  // Opt in per page rather than running on every load: the report costs six network requests, and
  // the extension is otherwise working normally. Add #sfir-diagnostic to the URL and reload.
  if (!location.hash.includes("sfir-diagnostic")) {
    return;
  }

  const api = typeof browser === "undefined" ? chrome : browser;
  const TAG = "[SFIR Safari cookie diagnostic]";

  // The session cookie that matters lives on the API host, which differs from the Lightning host
  // the user is usually looking at. Check both.
  function candidateHosts() {
    const here = location.hostname;
    const apiHost = here.replace(/\.lightning\.force\.com$/, ".my.salesforce.com");
    return [...new Set([here, apiHost])];
  }

  // A silent background script is itself a finding, so probe() never hangs waiting for one.
  const ask = host => probe("cookieDiagnostic", host);

  function probe(message, host) {
    return new Promise(resolve => {
      let settled = false;
      const done = result => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };
      setTimeout(() => done({error: "no response from the background script within 10s"}), 10000);
      try {
        api.runtime.sendMessage({message, host}, result => {
          const err = api.runtime.lastError;
          done(err ? {error: err.message} : result);
        });
      } catch (e) {
        done({error: String(e)});
      }
    });
  }

  // Can a content script reach the REST API at all? The page console shows Salesforce refusing the
  // extension origin, so measure it here and compare against the same call from the background.
  async function contentScriptFetch(host) {
    const url = `https://${host}/services/data/v66.0/limits`;
    try {
      const response = await fetch(url, {credentials: "include"});
      return {from: "content script", url, status: response.status, ok: response.ok};
    } catch (e) {
      return {from: "content script", url, error: String(e)};
    }
  }

  (async () => {
    for (const host of candidateHosts()) {
      const report = await ask(host);
      // Stringified so the whole thing can be copied out of the console in one piece.
      console.log(TAG, host, "COOKIES", JSON.stringify(report, null, 2));
      console.log(TAG, host, "REST from background", JSON.stringify(await probe("restProbe", host)));
      console.log(TAG, host, "REST from content script", JSON.stringify(await contentScriptFetch(host)));

      if (!report || report.error) {
        console.warn(TAG, host, "INCONCLUSIVE:", report?.error ?? "no report");
      } else if (report.sidFound) {
        console.log(TAG, host, "VERDICT: sid IS readable. OAuth may not be required -- re-check the architecture.");
      } else if (report.anyCookieFound) {
        console.log(TAG, host, "VERDICT: cookies are readable but sid is not. HttpOnly still withheld, OAuth stays required.");
      } else {
        console.warn(TAG, host, "VERDICT: no cookies at all. Either not signed in to this host, or website access is not granted to the extension.");
      }
    }
  })();
})();

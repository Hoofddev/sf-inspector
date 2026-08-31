
// Browser polyfill for cross-browser compatibility.
// The mirror image of the shim in utils.js and popup.js: this file is written entirely against
// `chrome`, and Firefox-derived engines define only `browser`. Safari is believed to expose both,
// so this is defensive rather than known to be required.
if (typeof chrome === "undefined") {
  // eslint-disable-next-line no-var
  var chrome = browser;
}

// Safari and Firefox return promises from extension APIs; Chrome uses callbacks. Support both
// without pulling in a polyfill.
function promisify(fn) {
  return new Promise((resolve, reject) => {
    let maybePromise;
    try {
      maybePromise = fn(result => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve(result);
        }
      });
    } catch (e) {
      reject(e);
      return;
    }
    if (maybePromise && typeof maybePromise.then === "function") {
      maybePromise.then(resolve, reject);
    }
  });
}

// Safari reports several cookie stores and answers from an empty one unless a storeId is named, so
// a lookup that comes back empty is retried against every store in turn. Chrome and Firefox answer
// on the first attempt, which leaves their incognito handling (via sender.tab.cookieStoreId)
// untouched -- enumerating unconditionally could return a cookie from the wrong profile there.
async function eachCookieStore(query) {
  const direct = await query(undefined).catch(() => null);
  if (direct && (!Array.isArray(direct) || direct.length)) {
    return direct;
  }
  const stores = await promisify(cb => chrome.cookies.getAllCookieStores(cb)).catch(() => []);
  for (const store of stores || []) {
    const found = await query(store.id).catch(() => null);
    if (found && (!Array.isArray(found) || found.length)) {
      return found;
    }
  }
  return Array.isArray(direct) ? [] : null;
}

function getCookie(details, storeId) {
  return eachCookieStore(fallbackStoreId =>
    promisify(cb => chrome.cookies.get({...details, storeId: fallbackStoreId ?? storeId}, cb)));
}

function getAllCookies(details, storeId) {
  return eachCookieStore(fallbackStoreId =>
    promisify(cb => chrome.cookies.getAll({...details, storeId: fallbackStoreId ?? storeId}, cb)));
}

let sfHost;

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Perform cookie operations in the background page, because not all foreground pages have access to the cookie API.
  // Firefox does not support incognito split mode, so we use sender.tab.cookieStoreId to select the right cookie store.
  // Chrome does not support sender.tab.cookieStoreId, which means it is undefined, and we end up using the default cookie store according to incognito split mode.
  if (request.message == "getSfHost") {
    const currentDomain = new URL(request.url).hostname;
    // When on a *.visual.force.com page, the session in the cookie does not have API access,
    // so we read the corresponding session from *.salesforce.com page.
    // The first part of the session cookie is the OrgID,
    // which we use as key to support being logged in to multiple orgs at once.
    // http://salesforce.stackexchange.com/questions/23277/different-session-ids-in-different-contexts
    // There is no straight forward way to unambiguously understand if the user authenticated against salesforce.com or cloudforce.com
    // (and thereby the domain of the relevant cookie) cookie domains are therefore tried in sequence.
    (async () => {
      const cookie = await getCookie({url: request.url, name: "sid"}, sender.tab?.cookieStoreId);
      if (!cookie || currentDomain.endsWith(".mcas.ms")) { //Domain used by Microsoft Defender for Cloud Apps, where sid exists but cannot be read
        sendResponse(currentDomain);
        return;
      }
      const [orgId] = cookie.value.split("!");
      const orderedDomains = ["salesforce.com", "cloudforce.com", "salesforce.mil", "cloudforce.mil", "sfcrmproducts.cn", "force.com"];

      for (const domain of orderedDomains) {
        const cookies = await getAllCookies({name: "sid", domain, secure: true}, sender.tab?.cookieStoreId);
        const sessionCookie = (cookies || []).find(c => c.value.startsWith(orgId + "!") && c.domain != "help.salesforce.com");
        if (sessionCookie) {
          sendResponse(sessionCookie.domain);
          return;
        }
      }
      // Nothing better found; the caller falls back to the domain it is already on.
      sendResponse(currentDomain);
    })();
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  }
  if (request.message == "getSession") {
    sfHost = request.sfHost;
    getCookie({url: "https://" + request.sfHost, name: "sid"}, sender.tab?.cookieStoreId).then(sessionCookie => {
      if (!sessionCookie) {
        sendResponse(null);
        return;
      }
      sendResponse({key: sessionCookie.value, hostname: sessionCookie.domain});
    }, () => sendResponse(null));
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  } else if (request.message == "oauthCallback") {
    // Safari only. Salesforce cannot redirect into an extension whose origin UUID differs per
    // install, so the Connected App points at a hosted callback page and addon/oauth-callback.js
    // relays the authorization code here. Reopening the extension page with the code and state lets
    // sfConn.getSession() complete the PKCE exchange along its normal path.
    const target = chrome.runtime.getURL("data-export.html")
      + "?code=" + encodeURIComponent(request.code)
      + "&state=" + encodeURIComponent(request.state);
    chrome.tabs.create({url: target}, () => {
      sendResponse({ok: true});
      // Only close the callback tab once the extension page actually opened, so a failure to open
      // it does not throw the authorization code away.
      if (sender.tab?.id) {
        chrome.tabs.remove(sender.tab.id);
      }
    });
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  } else if (request.message == "apiAbort") {
    // The page cannot abort a fetch it did not issue, so it asks the background to do it. Sent by
    // the abort handler that sfConn.rest() hands to its caller (the Stop button in Data Export).
    inFlightRequests.get(request.requestId)?.abort();
    inFlightRequests.delete(request.requestId);
    return false;
  } else if (request.message == "apiFetch") {
    // Safari refuses the extension origin for cross-origin requests to Salesforce, so requests made
    // from an extension page (including the popup, which button.js injects as an iframe) fail with
    // "Load failed". The background context is not subject to that check, so it performs the request
    // on their behalf. See sfConn.rest() and sfConn.soap() in inspector.js for the calling side.
    apiFetch(request.requestId, request.request).then(sendResponse, err => sendResponse({
      status: 0,
      statusText: String(err),
      headers: {},
      bodyBase64: ""
    }));
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  } else if (request.message == "createWindow") {
    const brow = typeof browser === "undefined" ? chrome : browser;
    brow.windows.create({
      url: request.url,
      incognito: request.incognito ?? false
    });
  } else if (request.message == "reloadPage") {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      chrome.tabs.reload(tabs[0].id);
    });
  }
  return false;
});
chrome.action.onClicked.addListener(() => {
  chrome.runtime.sendMessage({
    msg: "shortcut_pressed", sfHost, command: "open-popup"
  });
});
chrome.commands?.onCommand.addListener((command) => {
  if (command.startsWith("link-")){
    let link;
    switch (command){
      case "link-setup":
        link = "/lightning/setup/SetupOneHome/home";
        break;
      case "link-home":
        link = "/";
        break;
      case "link-dev":
        link = "/_ui/common/apex/debug/ApexCSIPage";
        break;
    }
    chrome.tabs.create({
      url: `https://${sfHost}${link}`
    });

  } else if (command.startsWith("open-")){
    chrome.runtime.sendMessage({
      msg: "shortcut_pressed", command, sfHost
    });
  } else {
    chrome.tabs.create({
      url: `chrome-extension://${chrome.i18n.getMessage("@@extension_id")}/${command}.html?host=${sfHost}`
    });
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    chrome.tabs.create({
      url: "https://tprouvot.github.io/Salesforce-Inspector-reloaded/welcome/"
    });
  } else if (details.reason === "update" && details.previousVersion?.startsWith("2.0")) {
    //TODO delete clearSobjectsListCache after 2.0.1 release, only for upgrade from 2.0.0 to 2.0.1
    await clearSobjectsListCache();
  }
});

async function clearSobjectsListCache() {
  try {
    const storage = (typeof chrome !== "undefined" && chrome.storage) ? chrome.storage : browser.storage;
    if (!storage?.local) return;
    const allData = await storage.local.get(null);
    const keysToRemove = Object.keys(allData || {}).filter(key =>
      key === "cache_sobjectsList"
    );
    if (keysToRemove.length > 0) {
      await storage.local.remove(keysToRemove);
    }
  } catch (e) {
    console.error("Error clearing sobjectsList cache on update:", e);
  }
}
// Not implemented in Safari, where calling it throws.
chrome.runtime.setUninstallURL?.("https://forms.gle/y7LbTNsFqEqSrtyc6");

// --- Salesforce API proxy for Safari ------------------------------------------------------------

function bytesToBase64(bytes) {
  // Chunked, because String.fromCharCode with a large spread overflows the argument limit.
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// Live requests, so an abort message can reach the fetch that is already running.
const inFlightRequests = new Map();

async function apiFetch(requestId, {method, url, headers, body, hasBody}) {
  // The response is returned base64-encoded rather than decoded here: the caller knows whether it
  // wants JSON, XML or a Blob, and this keeps binary responses (Metadata Retrieve ships a zip)
  // intact across the message boundary.
  const controller = new AbortController();
  if (requestId) {
    inFlightRequests.set(requestId, controller);
  }
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: hasBody ? body : undefined,
      signal: controller.signal,
      // The session is carried in the Authorization header, so cookies are neither needed nor sent.
      credentials: "omit"
    });
    const buffer = await response.arrayBuffer();
    const responseHeaders = {};
    response.headers.forEach((value, name) => {
      responseHeaders[name] = value;
    });
    return {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      bodyBase64: bytesToBase64(new Uint8Array(buffer))
    };
  } catch (e) {
    // rest() already treats status 0 as "network error, offline or timeout". An abort lands here
    // too, but the calling side has by then already rejected with an AbortError of its own.
    return {status: 0, statusText: String(e), headers: {}, bodyBase64: ""};
  } finally {
    if (requestId) {
      inFlightRequests.delete(requestId);
    }
  }
}

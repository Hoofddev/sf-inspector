
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
    chrome.cookies.get({url: request.url, name: "sid", storeId: sender.tab.cookieStoreId}, cookie => {
      if (!cookie || currentDomain.endsWith(".mcas.ms")) { //Domain used by Microsoft Defender for Cloud Apps, where sid exists but cannot be read
        sendResponse(currentDomain);
        return;
      }
      const [orgId] = cookie.value.split("!");
      const orderedDomains = ["salesforce.com", "cloudforce.com", "salesforce.mil", "cloudforce.mil", "sfcrmproducts.cn", "force.com"];

      orderedDomains.forEach(currentDomain => {
        chrome.cookies.getAll({name: "sid", domain: currentDomain, secure: true, storeId: sender.tab.cookieStoreId}, cookies => {

          let sessionCookie = cookies.find(c => c.value.startsWith(orgId + "!") && c.domain != "help.salesforce.com");
          if (sessionCookie) {
            sendResponse(sessionCookie.domain);
          }
        });
      });
    });
    return true; // Tell Chrome that we want to call sendResponse asynchronously.
  }
  if (request.message == "getSession") {
    sfHost = request.sfHost;
    chrome.cookies.get({url: "https://" + request.sfHost, name: "sid", storeId: sender.tab.cookieStoreId}, sessionCookie => {
      if (!sessionCookie) {
        sendResponse(null);
        return;
      }
      let session = {key: sessionCookie.value, hostname: sessionCookie.domain};
      sendResponse(session);
    });
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
  } else if (request.message == "cookieDiagnostic") {
    // See addon/safari-cookie-diagnostic.html. Temporary; remove once the answer is recorded.
    runCookieDiagnostic(request.host).then(sendResponse, err => sendResponse({error: String(err)}));
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

// --- Temporary diagnostic, see addon/safari-cookie-diagnostic.html -------------------------------------
// Answers one question: can this Safari read the HttpOnly Salesforce "sid" cookie? Delete this
// function, the "cookieDiagnostic" handler above, and the two safari-cookie-diagnostic files once done.

function promisify(fn) {
  // Safari and Firefox return promises; Chrome uses callbacks. Support both without a polyfill.
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

async function runCookieDiagnostic(host) {
  const url = "https://" + host;
  const report = {host, userAgent: navigator.userAgent, stores: [], sidFound: false, anyCookieFound: false};

  let stores;
  try {
    stores = await promisify(cb => chrome.cookies.getAllCookieStores(cb));
  } catch (e) {
    // Fall back to the implicit default store so the run still says something useful.
    report.getAllCookieStoresError = String(e);
    stores = [{id: undefined}];
  }

  for (const store of stores || []) {
    const entry = {storeId: store.id ?? "(default)", sid: null, otherCookies: [], errors: []};

    try {
      const sid = await promisify(cb => chrome.cookies.get({url, name: "sid", storeId: store.id}, cb));
      if (sid) {
        // Never log the value itself; its length and flags are enough to answer the question.
        entry.sid = {valueLength: sid.value.length, domain: sid.domain, httpOnly: sid.httpOnly, secure: sid.secure};
        report.sidFound = true;
      }
    } catch (e) {
      entry.errors.push("get(sid): " + e);
    }

    try {
      const all = await promisify(cb => chrome.cookies.getAll({url, storeId: store.id}, cb));
      entry.otherCookies = (all || []).map(c => c.name);
      if (entry.otherCookies.length) {
        report.anyCookieFound = true;
      }
    } catch (e) {
      entry.errors.push("getAll: " + e);
    }

    report.stores.push(entry);
  }

  return report;
}

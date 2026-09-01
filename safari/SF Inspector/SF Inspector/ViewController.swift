//
//  ViewController.swift
//  SF Inspector
//

import Cocoa
import SafariServices
import WebKit

let extensionBundleIdentifier = "be.hoofdvogel.sfinspector.Extension"
let documentationURL = URL(string: "https://hoofddev.github.io/sf-inspector/")!

class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")
        webView.loadFileURL(
            Bundle.main.url(forResource: "Main", withExtension: "html")!,
            allowingReadAccessTo: Bundle.main.resourceURL!
        )

        // The reader leaves for Safari's settings, turns the extension on, and comes back. Without
        // this the checklist would still be showing what was true before they left, which reads as
        // the app not having noticed.
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(refreshExtensionState),
            name: NSApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        refreshExtensionState()
    }

    /// Asks Safari whether the extension is enabled and hands the answer to the page.
    @objc func refreshExtensionState() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, _ in
            // macOS 13 renamed Preferences to Settings, and the page names the menu item the reader
            // is being sent to look for.
            let usesSettings = ProcessInfo.processInfo.isOperatingSystemAtLeast(
                OperatingSystemVersion(majorVersion: 13, minorVersion: 0, patchVersion: 0)
            )

            // A missing state is reported as such rather than as "off": telling someone to switch
            // on something that is already on sends them in a circle.
            let enabled = state.map { String($0.isEnabled) } ?? "null"

            DispatchQueue.main.async {
                self.webView.evaluateJavaScript("show(\(enabled), \(usesSettings))")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        switch message.body as? String {
        case "open-settings":
            // The window deliberately stays open. The converter's template quit the app here, which
            // leaves nothing to come back to -- and the second step, granting access to the org's
            // domains, is the one people miss and most need to be reminded of afterwards.
            SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier)
        case "open-docs":
            NSWorkspace.shared.open(documentationURL)
        default:
            break
        }
    }

}

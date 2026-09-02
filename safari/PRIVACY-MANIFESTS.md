# Privacy manifests

Both targets ship a `PrivacyInfo.xcprivacy` declaring nothing collected, nothing tracked, and no
API accessed that requires a declared reason. This file records why, because the manifests
themselves cannot.

## Keep them free of comments

They used to carry an XML comment explaining the reasoning below. That is valid plist -- `plutil
-lint` accepts it, Xcode builds it, and it ships intact -- but App Store Connect rejected the
upload of 2.1.0 (1):

```
ITMS-91056: Invalid privacy manifest - The PrivacyInfo.xcprivacy file from the following
path is invalid: "Contents/Resources/PrivacyInfo.xcprivacy".
```

Both manifests were flagged, and the comment was the only thing distinguishing them from the
template Xcode generates. They are now byte-identical to that template, keys in the same
alphabetical order, 373 bytes each.

So: no comments, and nothing beyond the four documented keys. Explanations belong here.

## Why every array is empty

**Nothing is collected.** The extension reads the user's own Salesforce org through Salesforce's
APIs, using the session their browser already holds, and what it reads stays on their machine.
There is no server of ours to reach: `manifest.json` grants host permissions for Salesforce
domains and nothing else.

**Nothing is tracked.** No analytics, no telemetry, no advertising, no third-party SDK. Verified
by searching the source for analytics, telemetry, Sentry, Mixpanel, Amplitude, gtag, PostHog and
Bugsnag, and by confirming every non-Salesforce URL in the extension is a documentation link
rather than a runtime endpoint.

**Settings are not collection.** Saved queries, query history and preferences live in the
browser's own storage on the user's machine and never leave it.

**No API requiring a declared reason is called.** The Swift side is three small files -- an app
delegate, a view controller and the extension handler -- and none of them touches UserDefaults,
the file system, disk space, system uptime or an active keyboard.

This matches the App Privacy answer given in App Store Connect: *data not collected*.

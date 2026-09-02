# App Store Connect listing

Everything to paste into App Store Connect, with the field limits it enforces. Run
`node scripts/check-listing.mjs` to re-check the lengths after editing.

---

## Name  *(limit 30)*

```
SF Inspector
```

## Subtitle  *(limit 30)*

```
Inspect Salesforce data fast
```

## Promotional text  *(limit 170, editable without a new version)*

```
Query, export and import records, inspect fields, download metadata and search every flow in your org - without leaving the Salesforce page you are already on.
```

## Keywords  *(limit 100, comma-separated, no spaces)*

```
salesforce,soql,admin,developer,crm,metadata,query,export,csv,apex,flow,sandbox,sobject,devtools
```

## Description  *(limit 4000)*

```
SF Inspector puts a Salesforce admin's and developer's daily tools one click away, inside Safari, on whatever page you are already looking at.

Open the panel from any Salesforce page and you have the org in front of you: query it, export from it, import into it, read its metadata, and jump to the setup page you were hunting for.

WHAT IT DOES

Data Export - Write SOQL with autocomplete for objects and fields, run it, and read the results in a filterable table. Copy straight out as CSV, Excel or JSON, or download the file. Save the queries you keep coming back to.

Data Import - Paste or upload a CSV and insert, update, upsert or delete records, with a mapping step and a per-row result you can read afterwards.

Field Inspector - Open any record and see every field: API name, type, label and value, side by side, with the value editable in place.

Flow Search - Setup's flow list has no search. This adds one. It loads every flow in the org, not only the page you can see, and filters as you type on label or API name.

Metadata Download - Retrieve metadata by type and read it in the browser, or take the package away as a zip.

Flow Scanner - Check flows against the Lightning Flow Scanner rule set for the mistakes that are easy to make and hard to spot.

REST Explorer - Build and send API requests against the org and read the response, without leaving the browser or reaching for a separate client.

Dependencies Explorer - Find what references what before you change or delete it.

Org Limits, API statistics and a debug log viewer round it out.

BUILT FOR MACOS

A native Safari extension with a dark interface that follows the appearance you choose. No account to create, no subscription, no advertising, and nothing to configure beyond granting access to your Salesforce domains.

PRIVACY

There is no server behind this extension. It talks only to your own Salesforce org, directly from your browser, using the session you are already signed in with. It applies your own permissions, so it can see nothing you could not see already. No analytics, no telemetry, no data leaves your Mac except the Salesforce API calls you ask it to make.

REQUIREMENTS

macOS 14.5 or later, Safari, and a Salesforce account. After installing, enable SF Inspector in Safari's Extensions settings and allow it on your Salesforce domains - the extension cannot read anything until you do.

OPEN SOURCE

SF Inspector is open source and a fork of Salesforce Inspector Reloaded by Thomas Prouvot, MIT licensed. The source is at github.com/Hoofddev/sf-inspector, where issues and suggestions are welcome.
```

## What's New in This Version  *(limit 4000)*

```
First release on the Mac App Store.

SF Inspector is a Safari-native build of the Salesforce inspector many admins already use daily, rewritten for macOS: a dark interface that follows your system appearance, and a flow search that Setup has never had.
```

---

## URLs

| Field | Value |
|---|---|
| Support URL | `https://hoofddev.github.io/sf-inspector/troubleshooting/` |
| Privacy Policy URL | `https://hoofddev.github.io/sf-inspector/privacy/` |
| Marketing URL *(optional)* | `https://hoofddev.github.io/sf-inspector/` |

## Category

- **Primary:** Developer Tools
- **Secondary:** Productivity

## App Privacy

Answer **"No, we do not collect data from this app."**

That is accurate and matches `PrivacyInfo.xcprivacy` in both targets: `NSPrivacyTracking` is
false, and both `NSPrivacyCollectedDataTypes` and `NSPrivacyAccessedAPITypes` are empty. The
extension has no analytics, no telemetry and no backend; verified by searching the source for
analytics, telemetry, Sentry, Mixpanel, Amplitude, gtag, PostHog and Bugsnag, and by checking
that every non-Salesforce URL in the extension is a documentation link rather than a runtime
endpoint.

## Export compliance

`ITSAppUsesNonExemptEncryption` is `false` in the app's Info.plist, so this should not be asked
again per upload. The extension bundles no cryptography, and it does not compute the PKCE
challenge itself - `getPKCEParameters` fetches it from Salesforce. The only encryption is the
HTTPS the system provides, which is exempt.

---

## App Review notes

> **This is the field most likely to decide whether the first submission passes.**

Reviewers get a Mac with Safari and no Salesforce account. Without a login they can install the
extension, enable it, and then see nothing at all - which reads as a broken app. App Review
guideline 2.1 requires a demo account for anything behind a sign-in.

**The demo org's credentials are deliberately not in this file.** This repository is public, so
the filled-in copy lives in `store-assets/review-notes.local.md`, which is gitignored. Keep the
placeholder below; paste the real values into App Store Connect directly.

The org should be one created for review and nothing else (free, at developer.salesforce.com/signup),
holding sample data only — App Review signs in and clicks around, and these notes tell Apple that
is all it contains.

```
SF Inspector is a Safari extension. It has no interface of its own beyond a first-run screen; it
works inside Salesforce, so a Salesforce login is needed to see anything.

DEMO ACCOUNT
  URL:      https://login.salesforce.com
  Username: <<FILL IN>>
  Password: <<FILL IN>>

This is a Salesforce Developer Edition org created solely for review. It contains sample data
only.

HOW TO SEE THE EXTENSION WORKING

1. Open the SF Inspector app once. It explains the two steps below and links straight to them.
2. Safari > Settings > Extensions, and tick SF Inspector.
3. In the same panel, set SF Inspector to "Always Allow" on salesforce.com domains. This step is
   essential: without it the extension loads but cannot read the session, and behaves as though
   nobody is signed in.
4. Sign in to the demo org at the URL above.
5. A small arrow appears at the right edge of the page. Click it to open the panel, or press
   Control-Option-I.
6. From the panel, "Data Export" opens the query tool. Run:
       SELECT Id, Name FROM Account
   and results appear in a table.
7. For the flow search, go to Setup > Process Automation > Flows. A search box appears above the
   list, marked with an SF Inspector badge, and filters the list as you type.

WHY THE EXTENSION NEEDS COOKIE ACCESS

It reuses the Salesforce session the browser already holds, so that it acts strictly as the
signed-in user and applies that user's permissions. It sends nothing anywhere except to the
user's own Salesforce org. There is no server behind the extension.
```

# SF Inspector

Salesforce productivity tools for Safari on macOS.

Inspect and edit any record's fields inline, run SOQL exports, import data, browse and
download metadata, explore the REST API, read debug logs and watch platform events —
without leaving the Salesforce tab you are already in.

> **Status:** working, not yet released. A signed build is being prepared for the Mac App
> Store. Until then, see [Building from source](#building-from-source).

## Why this exists

Salesforce Inspector has been a Chrome extension for over a decade, and there has never
been a Safari version. The reasons turned out to be specific and fixable:

- **Safari refuses the extension origin** for cross-origin requests to Salesforce, so every
  API call made from an extension page fails. Requests are routed through the background
  context instead, which is not subject to that check.
- **Cookie lookups need an explicit store.** Safari reports several cookie stores and
  answers from an empty one unless told otherwise.
- **HttpOnly is not the blocker it is assumed to be.** Safari 26 returns the Salesforce
  session cookie even with `Require HttpOnly attribute` enabled, provided the store is
  named. No connected app is required.

Details are in [issue #725 upstream](https://github.com/tprouvot/Salesforce-Inspector-reloaded/issues/725).

## What it does

| | |
|---|---|
| **Show All Data** | Every field on a record, with API names and inline editing |
| **Data Export** | SOQL queries with autocomplete, results to CSV, Excel or JSON |
| **Data Import** | Create and update records from pasted or uploaded data |
| **Download Metadata** | Browse, preview and retrieve metadata as a zip |
| **REST Explore** | Call any REST endpoint against the current org |
| **Logs Viewer** | Read and search Apex debug logs |
| **Event Monitor** | Subscribe to platform events and change events |
| **Field Creator** | Create fields in bulk |
| **Org Limits, Flow Scanner, Dependencies Explorer, API Statistics** | |

Plus setup shortcuts, user search and quick links from the popup on any Salesforce page.

## Install

The Mac App Store build is in preparation. It will be a one-time purchase: a signed,
notarised app that installs in one click and updates itself.

## Building from source

Requires macOS with Xcode and a Salesforce org.

```
npm install
npm run safari-app-build
```

The script builds the extension payload, generates and signs the macOS wrapper, and prints
where the app landed and how to enable it in Safari. It signs with an Apple Development
identity when your keychain holds one, and falls back to ad-hoc signing otherwise — note
that Safari only loads an ad-hoc build while *Develop → Allow Unsigned Extensions* is on,
and that setting resets every time Safari restarts.

Pass `-- --regenerate` after adding or removing files under `addon/`.

## Privacy

SF Inspector talks directly between your browser and your Salesforce org. Nothing is sent
anywhere else — no analytics, no telemetry, no servers of ours involved. Preferences and
query history are kept in browser storage on your machine.

To make an API call it needs your Salesforce session, which it reads from the session
cookie the same way the browser does. That is why the extension asks for cookie access on
Salesforce domains. All of that is in this repository; `addon/background.js` is where the
session is read and where every API request is made.

<a id="keyboard-shortcuts"></a>

## Keyboard shortcuts

Shortcuts are assigned in *Safari → Settings → Extensions → SF Inspector*. Safari's support
for extension shortcuts is more limited than Chrome's, so not every command can be bound.

<a id="field-creator"></a>

## Field Creator

Create multiple custom fields in one pass, including picklist values, formulas and
field-level security. Select an object, add rows, and deploy.

## Attribution

SF Inspector is a derivative of
[Salesforce Inspector Reloaded](https://github.com/tprouvot/Salesforce-Inspector-reloaded)
by **Thomas Prouvot**, which is itself based on the original Salesforce Inspector by
**Søren Krabbe** and **Jesper Kristensen**. The overwhelming majority of the code in this
repository is theirs, and the full commit history is preserved so that authorship stays
visible.

The work added here is the Safari port: routing API calls through the background context,
cookie handling across Safari's multiple cookie stores, an OAuth callback that survives
Safari's per-install extension identifiers, and the macOS build.

If you use Chrome, Edge or Firefox, use
[the original](https://github.com/tprouvot/Salesforce-Inspector-reloaded) — it is free, it
is excellent, and this project exists only because it does not run on Safari.

## Licence

MIT. See [LICENSE](LICENSE), which is retained unchanged from the upstream project and
ships with the application.

# Reply to App Review — Guideline 2.1, Information Needed

Apple asked for more information because the developer account is new, not because anything is
wrong with the app. Six items; five are text and are written out below, and the sixth is a screen
recording only you can make.

Paste the block below **both** as a reply on the App Review page **and** into the Notes field of
App Review Information, which is what they asked for.

The demo account is already in the Sign-In Information fields, so the reply refers to it rather
than repeating the password — this file is tracked in a public repository.

---

```
Thank you for reviewing SF Inspector. Answers to each point are below, and a screen recording is
attached.

1. SCREEN RECORDING

Attached. It was captured on a Mac running the current version of macOS and shows, in order:
launching the SF Inspector app, enabling the extension in Safari's settings, granting it access to
Salesforce domains, signing in to the demo org, opening the panel on a Salesforce page, running a
SOQL query in Data Export, and using the flow search in Setup.

There is no account registration, no login of our own, and no user-generated content. The app
creates no account and stores no user content, so there is nothing to delete and no reporting or
blocking mechanism to show. Sign-in is to the user's own Salesforce organisation, using Salesforce's
own login page.

2. PURPOSE AND TARGET AUDIENCE

SF Inspector is a developer and administrator tool for Salesforce, delivered as a Safari extension
for macOS.

The audience is Salesforce administrators, developers and consultants: people who configure and
maintain a Salesforce organisation as their job.

The problem it solves is that routine work in Salesforce means leaving the page you are on. To read
the underlying data of a record you open a separate query tool. To export records you use a
separate client. To find a flow among hundreds you page through a list that has no search, because
Salesforce's own Setup provides none.

SF Inspector puts those tools one click away, in a panel over the page the user is already looking
at: query and export data, import records, inspect every field on a record with its API name and
type, download metadata, search the full flow list, build REST API calls, and check org limits.

It is a productivity tool for professionals. It has no consumer use.

3. SETTING UP AND ACCESSING THE MAIN FEATURES

The extension works inside Salesforce, so a Salesforce login is required to see anything. Demo
credentials are in the Sign-In Information fields of App Review Information. The org is a Salesforce
Developer Edition organisation provided for this review and contains sample data only.

Setup, in order:

  a. Open the SF Inspector app once. It shows a first-run screen explaining the two steps below and
     links directly to them.
  b. Safari > Settings > Extensions, and tick "SF Inspector".
  c. In the same panel, set SF Inspector to "Always Allow" on salesforce.com domains.

Step (c) is essential and easy to miss. Safari extensions cannot read a page until the user grants
access to that site. Without it SF Inspector loads but cannot read the Salesforce session, and
behaves as though nobody is signed in — the panel opens but reports no connection. This is Safari's
own permission model, not a defect.

  d. Sign in at https://login.salesforce.com with the demo credentials.
  e. A small arrow appears at the right-hand edge of the page. Click it, or press Control-Option-I,
     to open the panel.

To exercise the main features:

  - Data Export: from the panel, click "Data Export". Enter:
        SELECT Id, Name FROM Account
    and click "Run Export". Results appear in a table which can be filtered and copied as CSV,
    Excel or JSON.
  - Field inspection: open any Account record, then click "Show all data" in the panel. Every field
    is listed with its API name, type, label and value.
  - Flow search: go to Setup > Process Automation > Flows. A search box appears above the list,
    marked with an SF Inspector badge, and filters the list as you type.
  - Org Limits, REST Explorer, Metadata Download and Dependencies Explorer are all reachable from
    the same panel.

No sample files are needed. Data Import accepts a CSV, but no import is necessary to evaluate the
app.

4. EXTERNAL SERVICES, TOOLS AND PLATFORMS

One, and only one: the user's own Salesforce organisation.

The extension calls Salesforce's published REST, SOAP, Tooling and Streaming APIs directly from the
browser, against whichever Salesforce org the user is signed in to. Its host permissions are
restricted to Salesforce-owned domains — salesforce.com, force.com, visualforce.com,
salesforce-setup.com, cloudforce.com and Salesforce's government and China equivalents — and no
others. The manifest requests exactly two browser permissions: "cookies" and "storage".

There is no backend of ours. We operate no server, and the app sends nothing to us or to any third
party. There is no analytics, telemetry, crash reporting or advertising SDK of any kind.

There is no authentication service, no payment processor and no AI service. Authentication is
Salesforce's own: the extension reuses the session the browser already holds for that org, so it
acts strictly as the signed-in user and can access nothing that user could not access already.
Where an organisation enables API Access Control, the user configures a Salesforce Connected App
themselves and the extension uses Salesforce's OAuth PKCE flow against it.

Third-party code is bundled and runs locally, not called as a service: React (MIT), Prism for
syntax highlighting (MIT), CometD for Salesforce's streaming API (Apache 2.0), and Lightning Flow
Scanner, an open-source rule engine used by the Flow Scanner feature (MIT).

5. REGIONAL DIFFERENCES

None. The app behaves identically in every region. It has no region-specific features, content,
pricing tiers or restrictions, and no geographic gating of any kind.

Its behaviour depends only on the Salesforce organisation the user signs in to and the permissions
that organisation grants them, which is the same logic everywhere.

6. REGULATED INDUSTRY AND THIRD-PARTY MATERIAL

SF Inspector does not operate in a regulated industry. It is a developer tool. It provides no
financial, medical, legal or gambling service, and handles no such data of its own — it displays
whatever the signed-in user is already authorised to see in their own Salesforce organisation.

Regarding third-party material: SF Inspector is an independent product and is not affiliated with,
endorsed by, or sponsored by Salesforce, Inc. The name "Salesforce" appears in the description and
keywords only to describe what the app is compatible with, which is nominative use. The app contains
no Salesforce code, artwork or branding.

The app is open source under the MIT licence, published at github.com/Hoofddev/sf-inspector. It is a
fork of Salesforce Inspector Reloaded by Thomas Prouvot, also MIT licensed, and the licence and
attribution are included in the repository and credited in the App Store description. Every bundled
library listed in point 4 is open source under a permissive licence.

Please let us know if anything further would help.
```

---

## The screen recording — what to capture

You need to record this yourself: it has to be a real Mac, running the current macOS, showing the
app being used. QuickTime Player > File > New Screen Recording is enough. Two to three minutes.

Apple's requirement is that it **begins with launching the app** and shows the typical user flow.
Do not start midway.

1. **Launch SF Inspector from Applications.** Let the first-run screen appear and stay a moment so
   it is legible. This is the "launching the app" part and it must be first.
2. **Safari > Settings > Extensions.** Tick SF Inspector. Set it to **Always Allow** on the
   Salesforce domain. Do this slowly — it is the step reviewers miss, and showing it pre-empts a
   second round.
3. **Sign in** to the demo org at login.salesforce.com.
4. **Open the panel** — click the arrow at the right edge, or press Control-Option-I.
5. **Run a query.** Data Export, type `SELECT Id, Name FROM Account`, Run Export, let the results
   render.
6. **Show a record's fields.** Open an Account, click "Show all data".
7. **Flow search.** Setup > Process Automation > Flows, then type in the search box and let the list
   filter.

Keep it unhurried, and do not cut between steps — a continuous take reads as genuine and answers
the question they actually have, which is whether a real app exists and works.

Attach the file to the App Review reply.

## On their screenshot note

Apple's message lists Guideline 2.3.3 under "Prevent Common Issues", which is boilerplate sent to
every new account rather than a finding against this submission. The ten screenshots all show the
app in use with real data on screen — none is title art, a login page or a splash screen — so no
change is needed. If they raise it specifically, the popup and flow-search shots are the strongest
evidence and can be moved to positions 1 and 2.

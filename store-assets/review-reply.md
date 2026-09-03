# Reply to App Review — Guideline 2.1, Information Needed

Apple asked for more information because the developer account is new, not because anything is
wrong with the app. Six items; five are text and are written out below, and the sixth is a screen
recording only you can make.

Paste the block below **both** as a reply on the App Review page **and** into the Notes field of
App Review Information, which is what they asked for.

The Notes field caps at **4000 characters**, counting spaces and punctuation. The first draft came
to 6655 and had to be cut; `node scripts/check-review-reply.mjs` measures it.

The demo account is already in the Sign-In Information fields, so the reply refers to it rather
than repeating the password — this file is tracked in a public repository.

---

```
A screen recording is attached. Answers below.

1. SCREEN RECORDING

Attached, recorded on a Mac running the current macOS. It shows launching the app, enabling the extension in Safari's settings, granting it access to Salesforce domains, signing in to the demo org, opening the panel, running a SOQL query, and using the flow search.

No account registration and no user-generated content. The app creates no account and stores no user content, so there is nothing to delete and no reporting or blocking mechanism to show. Sign-in is to the user's own Salesforce organisation, via Salesforce's login page.

2. PURPOSE AND TARGET AUDIENCE

A developer and administrator tool for Salesforce, delivered as a Safari extension for macOS. Its audience is Salesforce administrators, developers and consultants.

Routine Salesforce work means leaving the page you are on: reading a record's raw data, exporting, or finding one flow among hundreds in a Setup list that has no search.

SF Inspector puts those tools in a panel over that page: query and export data, import records, inspect every field with its API name and type, download metadata, search the full flow list, build REST calls, and check org limits. A professional tool with no consumer use.

3. SETTING UP AND ACCESSING THE MAIN FEATURES

A Salesforce login is required. Demo credentials are in the Sign-In Information fields; that org is a Developer Edition organisation for this review, with sample data only. No sample files are needed.

The recording shows the sequence: open the SF Inspector app once, then in Safari > Settings > Extensions tick "SF Inspector" and set it to "Always Allow" on salesforce.com domains.

That last step is essential and easy to miss. Safari extensions cannot read a page until the user grants access to that site. Without it the extension loads but cannot read the Salesforce session and behaves as though nobody is signed in. This is Safari's permission model, not a defect.

Then sign in at https://login.salesforce.com and click the arrow at the page's right edge to open the panel. "Data Export" runs SOQL such as SELECT Id, Name FROM Account.

4. EXTERNAL SERVICES, TOOLS AND PLATFORMS

One only: the user's own Salesforce organisation.

The extension calls Salesforce's published REST, SOAP, Tooling and Streaming APIs directly from the browser. Host permissions cover Salesforce-owned domains and no others, and it requests two browser permissions: "cookies" and "storage".

There is no backend of ours. We operate no server and send nothing to ourselves or any third party. No analytics, telemetry, crash reporting or advertising SDK. No payment processor and no AI service.

Authentication is Salesforce's own: the extension reuses the session the browser already holds, so it acts strictly as the signed-in user.

Bundled third-party code runs locally, not as a service: React, Prism, CometD and Lightning Flow Scanner, all open source under permissive licences.

5. REGIONAL DIFFERENCES

None. Identical in every region, with no region-specific features, content, pricing or restrictions. Behaviour depends only on the Salesforce organisation the user signs in to and that user's permissions.

6. REGULATED INDUSTRY AND THIRD-PARTY MATERIAL

Not a regulated industry. A developer tool providing no financial, medical, legal or gambling service, and handling no such data itself — it displays only what the signed-in user is already authorised to see.

SF Inspector is independent and not affiliated with, endorsed by, or sponsored by Salesforce, Inc. The name "Salesforce" appears only to describe compatibility, and the app contains no Salesforce code, artwork or branding.

It is open source under the MIT licence at github.com/Hoofddev/sf-inspector, a fork of Salesforce Inspector Reloaded by Thomas Prouvot, also MIT licensed.
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

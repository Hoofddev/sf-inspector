# Privacy Policy

*Last updated: 2 September 2026*

SF Inspector is a Safari extension for macOS, published by Hoofdvogel. This policy describes what
it stores and what it sends, and it is short because the extension does very little of either.

## We collect nothing

SF Inspector has no analytics, no telemetry, no crash reporting and no advertising. It does not
create an account, and it never sends your data to Hoofdvogel or to any third party. There is no
server behind this extension; nothing to send data to.

The extension talks to exactly one place: **your own Salesforce org**, directly from your browser,
over Salesforce's official web service APIs.

## How it reaches Salesforce

Requests are made on behalf of whoever is currently signed in, reusing the session your browser
already holds for that org — or, if your org has API Access Control enabled, a token generated
through a connected app that you set up yourself.

Two consequences follow, and both are deliberate:

- The extension can see **nothing that you cannot already see**. Salesforce applies your own
  permissions to every request it makes.
- To find that session, the extension needs Safari's permission to read cookies on your Salesforce
  domains. That is what Safari asks you to allow when you first enable it, and it is why the
  extension does not work until you do.

## What is stored on your Mac

Settings and a small amount of working state are kept locally, in your browser's storage, on your
machine. They never leave it. They are:

- Your saved queries and query history
- Your extension preferences, including the light/dark appearance
- Whether an org is production or a sandbox
- The API version in use
- A client ID and session ID, **only** if you have configured a connected app

None of this is Salesforce record data. Query *history* is the text of queries you have run, not the
rows they returned.

You can delete all of it at any time by removing the extension, or by clearing website data for the
relevant sites in Safari's settings.

## Verifying this

You do not have to take our word for it:

- The source is public at
  [github.com/Hoofddev/sf-inspector](https://github.com/Hoofddev/sf-inspector). You can read exactly
  what it stores and what it requests.
- You can watch every request it makes in Safari's Web Inspector, under the Network tab.

## Children

SF Inspector is a professional tool for Salesforce administrators and developers. It is not directed
at children and collects no data from anyone, children included.

## Changes

If this policy changes, the revision will be published on this page and the date at the top updated.
Because the extension collects nothing, a change here would mean a change in the product, which
would also appear in the release notes.

## Contact

Questions about privacy, or anything else, are welcome as an issue at
[github.com/Hoofddev/sf-inspector/issues](https://github.com/Hoofddev/sf-inspector/issues).

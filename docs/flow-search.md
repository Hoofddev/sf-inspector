# Flow Search

Setup's flow list has no way to find a flow by name. It pages through them a screen at a time, so
reaching one means knowing roughly where it sorts — which stops being reasonable somewhere around
the fiftieth flow.

SF Inspector adds a search box above the list.

## Using it

Go to **Setup ▸ Process Automation ▸ Flows**. A search box appears above the column headers, marked
with the SF Inspector badge so it is clear where it came from.

Type any part of a flow's **label** or its **API name**. The list filters as you type, and the count
beside the box tells you how many of how many matched — `3 of 267 flows`.

Press <kbd>Escape</kbd> to clear it and get the whole list back.

## It searches all of them, not just what is on screen

Setup fetches rows a page at a time as you scroll, so at any moment most of your flows are simply
not on the page. Filtering only what has loaded would quietly miss the rest, and the search would
look like it worked while returning a fraction of the answer.

So the box loads the whole list first. Arriving on the Flows page starts it scrolling to the bottom
until the row count stops growing, which happens while you are still reading — by the time you type,
the list is usually already complete. Salesforce notices too: its own summary changes from
`250+ items` to an exact count.

While that is happening the box says `Loading every flow…` and counts up. Nothing is hidden until it
finishes, because hiding rows collapses the list, and a collapsed list has nothing left to scroll.

## What you keep

The filter hides rows in Setup's own table rather than showing its own results, so everything the
list gives you is still there: every column, the sort you had applied, the row actions, and the
links Salesforce renders. Clearing the box restores the list exactly as it was.

## If the box does not appear

It only runs on the flow list itself, and it fails closed — if the page is not what it expects,
nothing is inserted and Setup is left untouched. Check that you are on
`/lightning/setup/Flows/home`, and that SF Inspector has access to the domain (see
[Welcome](welcome.md)).

## Limits

Very large orgs take longer to load, and the scroll gives up after about a minute rather than
running indefinitely. If that happens the box says `Stopped after N flows` instead of pretending it
searched everything.

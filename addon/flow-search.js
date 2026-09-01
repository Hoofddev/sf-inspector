/**
 * Search box on the Setup flow list.
 *
 * Setup pages you down through the flows and offers no way to find one by name, so the only way to
 * reach a flow is to know roughly where it sorts.
 *
 * This filters the list itself rather than showing its own results. An earlier version queried
 * FlowDefinitionView and dropped a list of matches under the box, which found every flow but threw
 * away everything the table gives you -- the other columns, the sort, the row actions, Salesforce's
 * own rendering. Filtering in place keeps all of it, and is what the list is for.
 *
 * That only works if the rows are actually there, and Setup loads them a page at a time as you
 * scroll. So the first search scrolls the list to the bottom until the row count stops growing.
 * Salesforce notices too: its own summary goes from "250+ items" to an exact count once everything
 * has been fetched.
 *
 * Everything here fails closed. If the list cannot be found, or looks different from what this
 * expects, nothing is inserted and Setup is left exactly as it was -- an extension that quietly
 * does nothing is repairable, one that mangles somebody's Setup page is not.
 */
(() => {
  const FLOW_LIST_PATH = /\/lightning\/setup\/Flows\/home/i;
  const CONTAINER_ID = "sfi-flow-search";
  const HIDDEN_ATTRIBUTE = "data-sfi-filtered";
  const DEBOUNCE_MS = 120;

  // Bounds on the load-everything scroll. Each round scrolls to the bottom and then waits for the
  // count to grow, because the next page comes from the server: a first version waited 150ms and
  // concluded after two of those that the list had ended, which stopped it a page or two in.
  const MAX_SCROLL_ROUNDS = 80;
  const GROWTH_TIMEOUT_MS = 2500;
  const GROWTH_POLL_MS = 120;

  let filterTerm = "";
  let loading = false;
  let loadedEverything = false;

  /* ---------------------------------------------------------------- finding things in the page */

  /**
   * querySelectorAll that also descends into shadow roots. Lightning builds much of Setup out of
   * web components, so a plain document query stops at the first shadow boundary and finds nothing.
   */
  function deepQueryAll(selector, root = document, found = [], seen = new Set()) {
    if (seen.has(root)) {
      return found;
    }
    seen.add(root);

    for (const element of root.querySelectorAll(selector)) {
      found.push(element);
    }
    for (const element of root.querySelectorAll("*")) {
      if (element.shadowRoot) {
        deepQueryAll(selector, element.shadowRoot, found, seen);
      }
    }
    return found;
  }

  /**
   * The Flow Label column header. Everything else is found relative to it, because it is the one
   * thing on the page that names what the list is -- class names in Setup are generated and are not
   * a contract, and nor is the tag: a Lightning list may be a table or an ARIA grid.
   *
   * Matched loosely because the cell holds more than the label: a sort arrow, a menu button and
   * assistive text for the sort state, so its text is never exactly "Flow Label".
   */
  function findHeaderCell() {
    return deepQueryAll("th, [role='columnheader']")
      .find(cell => /flow\s*label/i.test(cell.textContent || "")) || null;
  }

  function findFlowList() {
    const header = findHeaderCell();
    if (!header) {
      return null;
    }
    return header.closest("table, [role='grid'], [role='table']") || header.parentElement;
  }

  /** The rows holding flows, which is every row except the one the header is in. */
  function findRows(list) {
    const header = findHeaderCell();
    const headerRow = header ? header.closest("tr, [role='row']") : null;
    return Array.from(list.querySelectorAll("tr, [role='row']"))
      .filter(row => row !== headerRow && row.querySelector("td, [role='gridcell']"));
  }

  /** The scrolling ancestor the list sits in, which is what has to be driven to load more rows. */
  function findScroller(list) {
    for (let node = list.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) {
        return node;
      }
    }
    return document.scrollingElement || document.documentElement;
  }

  /**
   * The highest element still in the page's own document, walking out through any shadow roots.
   *
   * The box has to be mounted in the light DOM: a content script's stylesheet applies to the
   * document and shadow roots do not inherit it, so anything inserted inside one renders unstyled.
   */
  function liftOutOfShadow(node) {
    let current = node;
    while (current) {
      const root = current.getRootNode();
      if (root === document || !root.host) {
        return current;
      }
      current = root.host;
    }
    return null;
  }

  /* ------------------------------------------------------------------------- loading every row */

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  function countRows() {
    const list = findFlowList();
    return list ? findRows(list).length : 0;
  }

  /**
   * Scrolls the list to the bottom until it stops producing rows.
   *
   * Setup fetches the next page from the server as the scroller nears its end, so each round has to
   * wait for that round trip rather than for a fixed moment: a first version waited 150ms twice and
   * decided the list had ended, which left it filtering the first hundred rows of a longer list. A
   * round now waits up to two and a half seconds for the count to grow, and only a round that
   * produces nothing in that time ends the loop.
   *
   * The scroller is put back where it was afterwards, so searching does not leave the page parked
   * at the bottom of a list the reader had not scrolled.
   */
  async function loadEveryRow(list, onProgress) {
    const scroller = findScroller(list);
    const startedAt = scroller.scrollTop;
    let previous = countRows();

    try {
      for (let round = 0; round < MAX_SCROLL_ROUNDS; round++) {
        scroller.scrollTop = scroller.scrollHeight;

        const grewTo = await waitForGrowth(previous, onProgress);
        if (grewTo === previous) {
          return {count: previous, complete: true};
        }
        previous = grewTo;
      }
      return {count: previous, complete: false};
    } finally {
      scroller.scrollTop = startedAt;
    }
  }

  /** Polls until the row count exceeds `from`, or the wait runs out. */
  async function waitForGrowth(from, onProgress) {
    for (let waited = 0; waited < GROWTH_TIMEOUT_MS; waited += GROWTH_POLL_MS) {
      await wait(GROWTH_POLL_MS);
      const current = countRows();
      if (current > from) {
        onProgress(current);
        return current;
      }
    }
    return from;
  }

  /* ------------------------------------------------------------------------------ the filtering */

  /**
   * Collapses runs of whitespace to single spaces and lower-cases.
   *
   * Matching raw textContent fails as soon as a search is more than one word: the label's cell is
   * built out of nested markup, so what looks like "Verify Identity" can carry a line break or a
   * non-breaking space between the words, and "verify identity" then matches nothing. \s covers
   * both, and the search term gets the same treatment so the two are compared on equal terms.
   */
  function normalise(text) {
    return (text || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  /**
   * Which cells hold the flow's name, found from the column headers rather than by position.
   *
   * The first column is an item number, so the label and API name are not the first two cells --
   * an earlier version assumed they were and matched the row number and the label, missing the API
   * name entirely. Falls back to the first two cells if the headers cannot be read, which is no
   * worse than that version was.
   */
  function nameColumns() {
    const header = findHeaderCell();
    const headerRow = header ? header.closest("tr, [role='row']") : null;
    if (!headerRow) {
      return [0, 1];
    }
    const headings = Array.from(headerRow.querySelectorAll("th, [role='columnheader']"));
    const found = headings
      .map((cell, index) => ({index, text: normalise(cell.textContent)}))
      .filter(({text}) => /flow label|flow api name/.test(text))
      .map(({index}) => index);
    return found.length ? found : [0, 1];
  }

  /** The text a row is matched against: its flow label and API name. */
  function rowText(row, columns) {
    const cells = Array.from(row.querySelectorAll("td, [role='gridcell']"));
    return normalise(columns.map(index => cells[index] && cells[index].textContent).join(" "));
  }

  function applyFilter() {
    const list = findFlowList();
    if (!list) {
      return {shown: 0, total: 0};
    }

    const rows = findRows(list);
    const columns = nameColumns();
    const term = normalise(filterTerm);
    let shown = 0;

    for (const row of rows) {
      if (!term || rowText(row, columns).includes(term)) {
        shown += 1;
        show(row);
      } else {
        hide(row);
      }
    }

    return {shown, total: rows.length};
  }

  function hide(row) {
    if (row.hasAttribute(HIDDEN_ATTRIBUTE)) {
      return;
    }
    // The row's own display value is kept, so clearing the search restores exactly what Setup had
    // rather than whatever this file would guess a row should be.
    row.dataset.sfiPriorDisplay = row.style.display || "";
    row.setAttribute(HIDDEN_ATTRIBUTE, "");
    row.style.display = "none";
  }

  function show(row) {
    if (!row.hasAttribute(HIDDEN_ATTRIBUTE)) {
      return;
    }
    row.removeAttribute(HIDDEN_ATTRIBUTE);
    row.style.display = row.dataset.sfiPriorDisplay || "";
    delete row.dataset.sfiPriorDisplay;
  }

  function clearFilter() {
    document.querySelectorAll("[" + HIDDEN_ATTRIBUTE + "]").forEach(show);
  }

  /* ------------------------------------------------------------------------------------- the UI */

  const MAGNIFIER = "M11 4a7 7 0 1 0 4.2 12.6l4.1 4.1 1.4-1.4-4.1-4.1A7 7 0 0 0 11 4Zm0 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z";

  function setStatus(text) {
    const status = document.querySelector("#" + CONTAINER_ID + " .sfi-flow-search__status");
    if (status) {
      status.textContent = text || "";
    }
  }

  function describe({shown, total}, complete) {
    const loaded = complete ? "" : " loaded";
    if (!filterTerm.trim()) {
      return complete ? total + " flows" : "";
    }
    if (!shown) {
      return "No match in " + total + loaded + " flows";
    }
    return shown + " of " + total + loaded + " flows";
  }

  async function runSearch() {
    const list = findFlowList();
    if (!list) {
      return;
    }

    // Everything has to be present before the first filter, or the search silently misses whatever
    // Setup has not fetched yet, which is most of a long list.
    if (!loadedEverything && !loading && filterTerm.trim()) {
      loading = true;
      setStatus("Loading every flow…");
      const {count, complete} = await loadEveryRow(list, current => setStatus("Loading every flow… " + current));
      loadedEverything = complete;
      loading = false;
      if (!complete) {
        setStatus("Stopped after " + count + " flows");
      }
    }

    setStatus(describe(applyFilter(), loadedEverything));
  }

  function build() {
    const container = document.createElement("div");
    container.id = CONTAINER_ID;
    container.className = "sfi-flow-search";

    const bar = document.createElement("div");
    bar.className = "sfi-flow-search__bar";

    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("class", "sfi-flow-search__icon");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", MAGNIFIER);
    icon.append(path);

    const field = document.createElement("input");
    field.type = "search";
    field.className = "sfi-flow-search__input";
    field.placeholder = "Filter flows by name or API name…";
    field.setAttribute("aria-label", "Filter flows");

    const status = document.createElement("span");
    status.className = "sfi-flow-search__status";

    // Says where the box came from. Setup has no search of its own here, so without this it reads
    // as a Salesforce feature that behaves unlike the rest of Setup.
    const badge = document.createElement("span");
    badge.className = "sfi-flow-search__badge";
    badge.textContent = "SF Inspector";

    bar.append(icon, field, status, badge);
    container.append(bar);

    let timer = null;
    field.addEventListener("input", () => {
      clearTimeout(timer);
      filterTerm = field.value;
      timer = setTimeout(() => {
        runSearch().catch(() => setStatus("Could not filter the list"));
      }, DEBOUNCE_MS);
    });

    // Escape clears, which is what the platform's own clear button would otherwise have done.
    field.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        field.value = "";
        filterTerm = "";
        clearFilter();
        setStatus("");
      }
    });

    return container;
  }

  /* ------------------------------------------------------------------------------- attaching it */

  /**
   * Moves the box up until it is above the column headers and as wide as the list.
   *
   * Where the list's markup puts the header relative to the table is not something to predict: a
   * first version inserted before the table and still landed between the headers and the first row,
   * at a fraction of the width. So rather than assume a structure, this measures the result and
   * climbs one level at a time until the layout agrees. Bounded, because a loop that walked to the
   * document root would put the box somewhere far from the list.
   */
  function place(box, header, list) {
    if (!header || !list) {
      return;
    }
    for (let step = 0; step < 8; step++) {
      const placed = box.getBoundingClientRect();
      const aboveHeaders = placed.top < header.getBoundingClientRect().top;
      const wideEnough = placed.width >= list.getBoundingClientRect().width * 0.9;
      if (aboveHeaders && wideEnough) {
        return;
      }
      const parent = box.parentElement;
      if (!parent || !parent.parentElement || parent === document.body) {
        return;
      }
      parent.parentElement.insertBefore(box, parent);
    }
  }

  function attach() {
    if (!FLOW_LIST_PATH.test(location.pathname) || document.getElementById(CONTAINER_ID)) {
      return;
    }

    const list = findFlowList();
    if (!list) {
      return;
    }

    const anchor = liftOutOfShadow(list);
    if (!anchor || !anchor.parentNode) {
      return;
    }

    const box = build();
    anchor.parentNode.insertBefore(box, anchor);
    place(box, findHeaderCell(), list);
  }

  // Setup is a single-page app: the list arrives after navigation and is replaced wholesale when
  // its filters or sorting change, so the box has to be re-attached, and a filter applied to rows
  // Setup has since re-rendered has to be applied again.
  let reapply = null;
  const observer = new MutationObserver(() => {
    attach();
    if (filterTerm.trim() && !loading) {
      clearTimeout(reapply);
      reapply = setTimeout(() => setStatus(describe(applyFilter(), loadedEverything)), 80);
    }
  });
  observer.observe(document.documentElement, {childList: true, subtree: true});
  attach();
})();

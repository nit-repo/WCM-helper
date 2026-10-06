# WCM Helper

Two tools behind one page, one per input.

**Analyse** — a work brief in: what kind of job it is, how to do it, what is missing — and a mock of the page it describes.
**QA** — a built page in: is it sound on its own, and, with the brief alongside, is everything the brief asked for on it. Or, with no brief, write one from the page.

## Analyse

Paste a work brief. Get back four things:

1. **What kind of job this is**, and which CMS the target site is on
2. **What that kind of job needs**, and what the brief already has
3. **The steps to do it** in that CMS
4. **What is still missing**, as questions to send back

Nothing else. A two-line redirect request gets two questions at most — not a checklist about components, assets, markets and approvers that belong to a different kind of job.

**A fifth thing, on a multi-market brief only: row quality.** `checkNeeds` only ever asked whether something existed anywhere in the brief — never whether a row was actually filled in correctly. Confirmed against a real Spain/Italy/Portugal brief: the English master read "70%" and every translated column read "74%" for one section, while a different section correctly read 70% throughout, and nothing before this caught it. Three checks run over every row once a brief declares two or more market columns:

- **number mismatch** (break) — the numbers in a market's cell differ from the numbers in the English master's, naming both.
- **ragged** — the English master has content on a row a market left empty (break, unambiguous); or no master exists on a row and the market columns don't even agree with each other (check) — the shape a translated cell makes landing one row down from where it belonged. A row with no master where every market legitimately shares the same value (an image URL, say) stays silent on purpose.
- **untranslated** (check) — a market's cell reads identical to the master. Sometimes deliberate for brand and product names, so it's offered for a glance, never asserted as wrong.

A single-market brief is never checked for this, and says so rather than rendering as if it were checked and found clean.

### Mock page

**Build mock page** draws the page a brief describes. `page-model.js` reads the brief the same way QA's comparison does (front matter, sections, market columns) and infers a component for each section — hero, content, cards, steps, table, accordion, cta, image, or generic-for-review — using the brief's own evidence in priority order: an explicit component name first, then a recognised field label, then shape (a heading with an image and a short intro reads as a hero; repeating title/body pairs read as cards; repeating questions read as an accordion), and only as a last resort a generic block marked for review. Nothing is typed silently: every predicted component shows its confidence and the rows it came from, in the outline above the preview.

`page-model.js` also reads an already-built page the same way, from its own Tridion component markers (or the CSS-class map on a live page with none) when it has `<section class="module-…">` markup, or from its own real heading hierarchy and `<details>/<summary>` blocks when it does not — the same model either way, so the mock renderer never has to know which one produced it.

The preview renders inside a sandboxed frame — no script can run in it, and no image is ever fetched from an external URL; an asset renders as a labelled placeholder box instead, matching the tool's zero-external-requests rule. It resembles the structure of a real KONE landing page — a hero band, numbered cards, an accordion — without pretending to reproduce the production design. Switching the market re-renders it immediately.

**Send to QA** hands the mock's HTML across to the QA tab — to check it, or to turn it back into a brief.

**A brief naming several markets has a target, not a "last column".** A localization sheet carrying English, Spain, Italy and Portugal side by side used to be read from whichever column happened to be last — confidently wrong on every market but one. The target market is read from the brief's own front matter (`Level 2 / SPAIN`) and shown in a dropdown that lists every market the brief declares; switching it needs no re-paste. A brief naming markets with no declared target asks rather than guesses.

## QA

A built page in — pasted, uploaded, or captured with the bookmarklet — and **Run QA**. On its own it asks **is this page sound by itself?** With a brief in the optional Brief box, the same run also asks **is everything the brief asked for on the page?** And with no brief at all, **Generate brief** writes one from the page.

The results follow the WCM Page QA Framework's own layout:

- **The page itself, first.** Its environment, read off the canonical host — Tridion preview, AEM author preview, or production, and "unknown" when there is no canonical rather than assuming live. Its **TCM ID** from `<meta name="pagetcmid">`, with links that open it straight in the CME, new UI and old (patterns in `config/work-types.json` under `qa.cme`), and a copy button. Its market and language.
- **The framework's five categories** — Metadata, Body text, Images, Hyperlinks, Structure. Every finding the page makes about itself that Compare already knew (placeholder links, dead CTAs, CME and author links, images with no alt, a field published empty, duplicate headings, the Form Assembly ID for the market) plus the framework's must-haves: robots against the `digitalData` object's own INDEX/FOLLOW, title duplication, links and resources pointing at preview, staging or CMS hosts, mixed content on an `https` page, hreflang (missing, invalid, repeated, or not pointing back at the page), exactly one visible H1 counted across the whole document rather than only the main region, and link text a screen reader can use — "Leer más" and an icon link with no alt are both caught, in six languages.
- **Known template issues, kept apart.** The framework's own list of defects a template causes on every page — a doubled `- KONE India` title suffix, an empty keywords tag, an `.aspx` canonical, robots disagreeing with `digitalData` — are listed in their own card and never counted against the page. A page is not failed for its template.

Metadata always shows what the page carries — title, `og:title`, description, canonical, robots, the `digitalData` indexing values, hreflang — whether anything is wrong with it or not. A category QA cannot judge from the page alone says so instead of reading "No deviations": body copy is checked against a brief — add one in the Brief box — so with no brief, on a page with no Tridion field markers, Body text states that nothing was checked.

A preview build is read as one. `noindex` is expected there and stays silent; links to preview hosts are expected too, and QA says to run it on the live page rather than flagging each one.

**Building it turned up a bug in the comparison.** The check for a link pasted straight from the CME only recognised `/ui/editor/item?item=`. Neither real CME URL matches that — the new UI is `web-cms.kone.com/ui/editor/page?activeItem=…`, the old one `web-cms.kone.com/WebUI/item.aspx?tcm=…` — so the defect it exists to catch went unreported on both. It now recognises all three.

QA does not fetch anything. Live status, SSL and site crawling come with the backend, in a later pass; until then the page arrives by paste, upload or bookmarklet, the same as everywhere else in the tool.

**Title format, scored.** KONE's naming rule for a page title is `Page Name | KONE Corporation`, or `Page Name | KONE <country>` with the page's own country in that market's own spelling. Each title the page carries (the window title, and og:title when it differs) gets a row in Metadata:

| Title ends in | Score |
|---|---|
| `\| KONE Corporation` | green |
| `\| KONE <name>` — a confirmed name for the page's own market | green |
| `\| KONE <name>` — another market's confirmed name ("KONE India" on kone.es) | red — a break |
| `\| KONE`, no country | amber — a check |
| no site name, or one after ` - ` instead of ` \| ` | amber |
| a name not yet confirmed for the market, or a market that cannot be determined | amber — "not verified" |
| no title, or a doubled site name | red |

The page's market comes from the brief's `Market` row when there is one, else from its canonical host — a preview host (`preview.kone.es`) counts as its live market. Accepted names live in `config/sites.json`, one list per market: `siteNames` are confirmed, `siteNamesDraft` are spellings still to be confirmed. A title using a draft spelling scores amber, never red, so a guessed spelling can never fail a page; move it into `siteNames` once it is confirmed. A doubled site name stays a known template issue, so it is not counted against the page twice.

### With a brief

Put a brief in QA's Brief box and Run QA answers one more question, first — **is everything the brief asked for actually on the page?** It is one report: the brief's findings and the page's own land in the same five categories, each labelled by where its expectation came from (*Brief*, or *Expected* for a config table or a naming rule).

That is the headline. *"All 74 items from the brief are on the page"*, or *"61 of 74 — 13 missing"*. Underneath it sit the differences, in the five groups. A group with nothing wrong says "No deviations."

Counting coverage is what makes the tool's two worst failures legible without a special rule for each. `0 of 0` is a brief that did not parse; `2 of 74` is a brief that parsed wrongly. Both used to need a bespoke guard to interpret, because a report that shows only failures cannot tell "nothing was wrong" from "nothing was checked".

**A brief it cannot read is never reported as clean.** If the parse yields no expectations, the tool says so instead of showing five green ticks — a comparison that never ran must not look like one that passed. This was a real failure: a Portuguese brief and its live page came back "No deviations" while the page carried eight defects.

**Nor is a brief it read wrongly reported as a broken page.** The same brief later came back with 78 findings, of which about three were real. A brief can parse into plenty of expectations and still have been misread — a torn row, a shifted column — and then nearly all of them fail. A real page fails some checks; it does not fail all of them. So when 90% or more of at least eight expectations come back missing, the tool says the brief was probably read wrongly and names the shape it read. It shows the findings rather than hiding them: with the coverage count on screen, the number is what explains them.

**Metadata always shows what the page carries**, brief or no brief. Each field reads as matches / differs / not on the page / not defined in the brief, so a blank brief still tells you what the page is serving. Comparison itself is word for word — only the punctuation a CMS rewrites is folded, never case.

**Three fields that are not the same field.** These were conflated, and the brief's meta title was being compared against the wrong one:

| | Read from |
|---|---|
| **Meta title** | `og:title` |
| **Page name** | the `<title>` tag |
| **Page path** | the last segment of the URL |

`og:title` was never extracted at all — the meta reader matched `name="…"`, and Open Graph uses `property="…"`. Where a template ships no Open Graph, the meta title falls back to the window title and says so as a **check**, rather than reporting every such page as missing a title. The page path is shown as its segment but compared as a whole path, so a preview host or an `.aspx` extension never registers as a difference.

**Briefs are split into rows honouring quotes.** Excel and CSV wrap a cell holding more than one paragraph in quotes and keep its newlines inside. Splitting on newlines first tears that row in half, which is what made the tool read a perfectly good table as prose and invent 74 findings from it. Rows are now parsed with the quoting rules the exports actually use.

Localization briefs arrive as a tab-separated table or as prose, and both work — the result names which shape it read and how many things it is checking. **Prose asserts nothing about structure**: a short line in a prose brief is as likely to be a stat, a CTA label or a market name as a heading, and treating every one of them as a section heading is where 39 of those 78 phantom findings came from.

Every finding is either a **break** — a real defect — or a **check**, something expected to fire on correct pages that a human should glance at. Breaks sort first, and the tally at the top reads "*2 to fix, 1 to check by eye*". The distinction exists because a comparer that cries wolf gets ignored.

**Findings are placed by their Tridion component, not just a CSS label.** A CMS preview page's `<!-- Start Component Field -->` comments already name the exact component and field a piece of content lives in ("*FAQ · Accordion/items[1]/title*"). A live production page has none of those comments — they're stripped before publish — so a `tridionComponents` mapping (in `config/work-types.json`, documented in full in `tridion-component-taxonomy.md`) reads the section's CSS classes and names the same component anyway ("*FAQ · Accordion*"). Field markers, when a page has them, always win over the CSS guess.

It works on the four jobs that produce a page to read — new page, localization, content update, keyword update. Redirect and removal are checked by following the URL, so QA says there is nothing to compare rather than inventing findings, and still checks the page on its own.

Two limits worth stating plainly:

- **The tool cannot fetch the page.** A static browser app is blocked by CORS from reading a live KONE URL, which is why the HTML is pasted or uploaded. It follows that it cannot tell you an image is *broken* — only that the brief named an asset the page does not carry. The [bookmarklet](bookmarklet.html) is the alternative to doing that by hand: paste the page URL into QA and click **Open page**, then click the bookmarklet on the tab that opens. It runs inside the KONE page itself, in your own already-authenticated browser tab — including CMS preview pages behind login that no fetch could reach anyway — and posts the markup straight back into the QA tab you were already working in, **with the brief you pasted still there**. Opening the page from QA is what makes that possible: it makes this tab the page's `window.opener`, so the capture has somewhere to report to. The bookmarklet opens and navigates nothing: the capture goes into the tab you are already working in, or it does not go and the page tells you why. Opening from Compare is required rather than a convenience — a browser gives a page no other way to reach a tab on a different site.
- **Body text is compared verbatim after normalising.** Whitespace, `&nbsp;` and curly quotes are folded, then the match must be exact. A reworded sentence is reported; whether the rewording was deliberate is a judgement left to you.

**URLs are compared as paths.** `preview.kone.in/services/index.aspx` and `www.kone.in/services/` are the same page, so the scheme, host, `.aspx`/`.html` extension, directory `index`, and trailing slash are all dropped before comparing — the query string is kept, because it can be meaningful. An environment difference is never reported; a genuinely different path still is.

**Images are matched on asset identity, not filename.** A DAM or Scene7 embed URL is often a crop of the briefed asset with a variant suffix and preset parameters, so `shutterstock2335854375` in the brief resolves to `shutterstock2335854375-1?$hero-desktop$` on the page. When no image resolves, that is a **check** rather than a break — embed URLs frequently carry none of the brief's asset name, so it is a prompt to look, not a defect.

**What the brief asks for twice, the page has to carry twice.** Every check used to ask whether something appeared *at all*, so two brief rows carrying the same line both resolved against a single occurrence and a page missing a whole component reported as complete — a real brief with two `74%` rows against a page with one came back "All 53 items from the brief are on the page". Matching is now by count, in all four categories: body copy, headings, CTAs and assets.

A shortfall is a **break** — the brief asked for content that is not all there — and the finding names where each copy was asked for, so you can open both places rather than guess which is short:

> *the brief asks for this 2 times and the page carries it 1 — Proof point, row 34; Sustentabilidade, row 51*

The reverse — the page carrying more copies than the brief asked for — is a **check**, because templates legitimately repeat copy in teasers and related-content rails.

**Some defects need no brief at all.** A link still pointing at `href="#"` and a call to action that is bare text with no link are reported from the page alone. Both were found on a real KONE page.

Anchors that are legitimately `href="#"` are left alone: back-to-top and skip links by label, accordion and tab toggles by their ARIA attributes. Add market-language labels to `compare.safeAnchorLabels` in the config.

**Findings that need no brief survive a brief that could not be read.** Placeholder links, dead CTAs, contradictory stats and a heading used twice are reported under both guards. Categories that found nothing are withheld rather than shown empty, because an empty category reads as a pass and nothing in it was checked.

**Body text is matched paragraph first, then sentence by sentence.** A brief cell holding two sentences is often rendered by the page in two separate elements, so the paragraph never appears as one continuous string. Only when the whole paragraph fails does the tool descend to sentences, which keeps a fragment from matching by accident while letting correctly-built pages pass.

Lazy-loaded images resolve to the asset rather than the loading placeholder, whichever order `src` and `data-src` appear in.

Where the comparer reads the page content from is shown above the results. If it says "body minus nav, header and footer" and the Body Text group fills with menu labels, add the template's content wrapper class to `compare.contentSelectors` in `config/work-types.json`.

**Picking which of several briefs matches a pasted page.** The comparison has always assumed one brief goes with one page — `pickBrief(candidates, html)` answers "which one" when there's more than one candidate, and never picks silently. A brief's declared URL Path or target market (resolved to a domain) against the page's own canonical URL is a near-certain signal and decides it outright when exactly one candidate matches; with no declared match, or more than one, every candidate is run through the ordinary coverage calculation above and ranked by how much of itself it finds on the page. A result always names `how` it decided (`declared-url` / `coverage` / `ambiguous` / `none`) and carries every candidate's evidence, so a close call is visible rather than resolved for you — the same shape Fill's closest-match lookup already uses. The multi-brief input in the UI is a follow-up pass; the logic and its tests ship first.

**A localization table can be read either way round, and the tool used to know only one of them.** Every localization brief handled so far was *rows = content fields, columns = markets* — a `Headline` row, a `Body` row, one cell per market. A real KONE sheet is the transpose: *rows = markets, columns = content fields* — one row per country, with its own translated header and body columns. Read against the wrong assumption, every row's first cell is a country name, never `Headline`/`Body`, so nothing was extracted and a fully correct, live-and-matching translation reported as **unreadable**. `Brief.detectOrientation` now reads a tabular brief's shape from evidence rather than a fixed label vocabulary: a column of short, distinct identifiers (a country, a language — under 30 characters, four words or fewer, no sentence punctuation) next to a column that reads as real prose is read as *markets-by-field*, with the header row itself found by which row's own cells read most like column labels rather than assumed to be whichever comes first — real sheets carry stray front matter above the real header. A configured market name corroborates when it's there; it is never required, since most real markets (Bulgaria, Croatia, Germany, ...) aren't and can't practically all be in `config/work-types.json`'s `markets` list. A shape that fits neither known orientation says so, with its reasoning, rather than guessing.

**A row that's two-thirds right must not read as entirely wrong.** Sentence-descent already existed to catch a paragraph split across page elements — but a row's status was `found` only if *every* sentence matched; anything less read identically to zero found. A market's own row-identity text (the country name, prefixed onto the row before the real copy) failing to match while the actual sentences underneath it are genuinely on the page used to report as a total miss. The ledger now has a third status, `partial`, naming exactly what's missing (*"partly found in Bulgaria — 1 of 2 sentences missing"*) rather than folding a mostly-correct row into either a clean pass or a total failure.

**Form Assembly ID — independent of the brief.** Every KONE country site stamps a `var digitalData = {...}` script on every page naming the FormAssembly form it carries. The tool reads that id and checks it against the country's expected one, from the site registry in `config/sites.json`. It reports under Structure, and is a different claim from the brief's findings — not "does the page match this brief" but "does this page carry the right country's form" — so it never inflates or dilutes the coverage count. The country is resolved from the brief's own declared `Market` row when one is present, else from the page's canonical domain (three domains — `kone.be`, `kone.ch`, `kone.ca` — carry two languages each and are told apart by the first path segment). A handful of campaign pages carry their own id instead of their country's default; add those to `sites.json`'s `pageOverrides` as they come up. A page whose market cannot be determined is reported as **not checked**, never as a silent pass. With no brief it reads the market from the page's own host (a preview host counts as its live market) and, in Analyse, surfaces as a suggestion — *"this brief declares a Form component for Italy; Italy pages are expected to carry id 733"* — rather than a check, since there is no real page there to check it against.

### Generate a brief

The other direction: a built page — or an agency's HTML mockup, or the mock page Analyse built — in, and **Generate brief** writes the brief that describes it. For re-briefing a page into another market, for handing a translator a source of truth, or simply for a page whose brief was never kept.

It reads the page's own metadata, section headings, copy, assets and internal links, and writes them out in the order the page renders them — in the same format the comparison reads, so the draft lands in the **Brief** box ready to edit — and Run QA then checks the page against it. Headings become `[n.m]` markers, assets become `AEM Assets - <name>`, and only links on the page's own host are briefed.

**It never invents.** A field the page does not carry produces no row at all, rather than an empty one — an empty `Keywords` row would read as *"the brief asked for nothing here"*, which is a different claim from *"the page defines nothing here"*. An asset whose name cannot be read out of its URL is reported in the results pane rather than guessed at. Headings the template stamps in with `display:none` are skipped, and a link into the CME is never briefed: that is a defect the comparer reports on the page itself, and briefing it would ask the next page to reproduce the bug.

**Page → brief → QA is a round trip, and it is the test.** Generate a brief from a page, compare it back against that same page, and nothing the generator wrote should fail to match. Two fixtures assert exactly that. What the round trip does *not* have to explain is the page's own defects — a missing H1, a field published empty, a CME link — which exist whether or not anyone wrote a brief, and are excluded by `fromBrief`.

Writing the generator turned up three faults in extraction that had been quietly costing the comparison matches on real pages, all now fixed and covered:

- **A percent-encoded filename never matched its own name.** A brief writing `Graphic 1` resolved to `graphic1`; the page's own `Graphic%201.jpg` resolved to `graphic201`. Every asset with a space in its name, on every AEM page.
- **A Scene7 rendition preset was read as part of the asset name.** `Monospace100_img_3-1:669x475` is one asset delivered at one size, not an asset called `Monospace100_img_3-1:669x475`.
- **`&reg;` was not decoded** while `&trade;` was, so a brief writing `KONE MonoSpace®` never matched a page rendering the entity. `&copy;`, `&deg;`, `&hellip;` and hex numeric entities were missing too.

**Component-mapped field tables.** The plain draft above is what the comparison actually reads, untouched. Alongside it, the results pane shows the same page read a second way — through the shared model Analyse's mock page already uses — laid out the way a person writes a Tridion content brief by hand: one card per component, headed by how it was identified (`HeroBanner (Component Field marker)` on a CMS preview page, `HeroBanner (.hero-banner-wrapper › CSS-class match)` on a live one, or `hero (read from page structure — no named component identified)` on a page with neither, from `config/tridion-taxonomy.json`'s real component/field-slot data), a Field slot | Content table in the component's own documented order, an image placeholder wherever it carries one, and any quoted text flagged *do not paraphrase*. Content that fits no documented slot — a stat row or a bullet list built from bare `<div>`s, which no `<p>`/`<li>`-only reading ever sees — is never dropped or forced into the wrong field: it lands in its own **Unmapped content** block, always shown. An **Open items** section below it collects both the component-placement failures and any literal `to be aligned with KONE`/`to confirm`/`TBD`-style note already in the text, never invented. Verified against a real eleven-page agency mockup the tool has never seen a KONE class name or Tridion marker in — the generic tier that makes this work on any pasted page, not only KONE's own markup.

## Briefs as files

**Upload brief** accepts `.docx`, `.xlsx`, `.csv`, `.txt` and `.md`. Word and Excel files are ZIP containers and are read with the browser's native `DecompressionStream` — no library, so the project still has zero dependencies.

Word tables and spreadsheets come out **tab-separated**, which is the shape the localization and keyword playbooks already parse, so a spreadsheet brief feeds them unchanged. Old binary `.doc`/`.xls` cannot be read and say so; re-save as `.docx`/`.xlsx`.

Pasted-from-Word briefs are checked for paste damage — bullets that arrived as literal `●` characters, leftover `mso-list` markup, mixed smart and straight quotes. These are reported as **brief quality** notes above the results, because the brief is what is malformed, not the page.

**A cell holding more than one paragraph now survives the trip out of the spreadsheet.** Excel's Alt+Enter keeps a multi-paragraph cell's line break as a literal character in the cell text, and the tab-separated text `readXlsx` emits used to pass that newline straight through with no quoting at all — so the row-splitter downstream, which only protects a newline from ending a row when it sits inside `"…"` quotes the way a real CSV/Excel export already quotes it, tore the row apart at the blank line. A real 27-row localization sheet came out as 63 rows, every multi-paragraph translation split and misaligned. `readXlsx` now quotes a cell containing a newline, tab or `"` on the way out, the same escaping the row-splitter already expects.

## Running it

```
npm start     # http://localhost:3600
npm test      # 404 verification cases across the eight modules
```

No dependencies, no build step, no backend. It has to be *served* rather than opened from disk, because the playbooks are fetched at runtime and browsers block `fetch` over `file://`.

**Which build am I looking at?** The sidebar says, under the wordmark — `BUILD 2026-09-11A`. It is worth knowing, because a deployed page that looks current can still be running older code: the shell comes from `index.html` and the behaviour comes from six separate `.js` files, and a browser can hold an old copy of any one of them. So every script is referenced with the version on its URL (`<script src="compare.js?v=2026-09-11a">`) — a changed query is a different URL, which no cache can satisfy from the old entry — and `app.js` reads that same value back out of its own `src` to display it. One string to bump, in `index.html`, and what the sidebar shows is necessarily the file that ran. `vercel.json` sets `Cache-Control: public, max-age=0, must-revalidate` for the one file the query strings cannot protect, `index.html` itself.

**On Vercel, use the branch alias.** A URL like `wcm-helper-<hash>-<team>.vercel.app` is a *per-deployment* URL, frozen to the commit that built it — it will never show anything newer however many times it is reloaded. The alias that follows the newest build on a branch is the `-git-<branch>-` one, which is the link the Vercel bot posts on the pull request. If the two ever disagree, the sidebar stamp settles it.

## The six playbooks

| Job | Needs | Where the work happens |
|---|---|---|
| **Redirect** | source URL(s), destination URL(s) | AEM: ACS Commons Redirect Manager. Tridion: a redirect component in Building Blocks, or the source page's metadata |
| **Page removal** | page(s) to remove, replacement URL | The page is unpublished — it stays in the CMS — and its old URL is redirected to whatever supersedes it |
| **Content update** | target URL, what to change | The page's component. Covers copy, images, links, and components added, removed or moved |
| **New page** | URL path, meta title, meta description, section content | Page created from a template, then built section by section down the brief |
| **Keyword update** | page(s), primary keyword each | The keyword field is set from a mapping sheet — title, description and copy are left alone |
| **Localization** | target market site, page path, localized content | The English master already exists — each component's text is replaced with the market's own language |

Everything lives in `config/work-types.json`: the signals that identify each job, the fields it needs, and its step-by-step recipe per CMS. Adding a job, or fixing a recipe, is a JSON edit — `engine.js` knows how to match, not what to match.

## Two things worth knowing

**CMS detection reads the site URL only, and AEM is the exception.** The estate is mid-migration and most of it is still Tridion, so a market is treated as AEM only once it is listed in `aemMarkets` — currently `.in`, `.ae`, `.us`, `.fr`. Everything else is Tridion. **Add a market to that list when it migrates.** A page ending `.aspx` is Tridion whatever market it sits on, which is what an un-migrated page on an otherwise-migrated site looks like.

**A brief naming several markets is resolved per market, not from the first URL.** A redirect or removal sheet can legitimately cover more than one country's pages, and reading the CMS off `hostOf(urls[0])` alone used to judge every market after the first by whichever happened to be listed first. Each distinct host is now resolved on its own; markets that agree still get one answer, markets that split resolve to `Mixed` and hold the brief as not ready until a platform is chosen for the market being actioned. A localization brief that names its markets as column headers and carries no site URL at all resolves the same way, from the target market's configured domain in `config/work-types.json`'s `markets` list.

**A count is not the same as a presence.** A redirect need used to be satisfied by "two site URLs exist somewhere in the brief" — true the moment any one row was complete, so a ten-row sheet with seven rows missing a destination still reported ready. Needs that are inherently per-row are checked per row now.

Assets now live in Adobe DAM whichever CMS serves the page, so a `adobecqms.net` or `/content/dam/` link never counts as evidence — a Tridion brief full of AEM DAM links is still a Tridion brief.

**Every call shows its working.** Each classification carries the signals that produced it and their weights, so you can check the tool rather than trust it. The same brief always analyses identically. When nothing clearly identifies a brief, it says so instead of guessing, and the work type and CMS can both be set by hand.

**A confident call needs real evidence, not just a positive score.** A country-by-country rollout-tracking sheet — no content brief at all — used to classify as `content-update`, confident, off a single weight-1 hit: the word "update" appearing once in a column header, with every other playbook scoring 0. Beating the runner-up isn't enough on its own any more; the winning score also has to clear `classification.minConfidentScore` in `config/work-types.json` (2, by default) — a lone weak (weight-1) signal is not enough, the way a lone structural or strong signal already was.

## The page names its own components

For a long time the page side of the comparer could see six things: `<title>`, the meta tags, `h1`–`h3`, `<img>`, `<a>`, and one flat blob of text. Everything else went into how carefully two strings were compared. So the worst a finding could say was *"not found on the page — row 75"*: an absence, a brief row number, and nothing about the page at all.

The markup was already carrying the answer. A KONE page is built from components, and Tridion prints what it authored:

```html
<section class="module module-faq module-with-h2" id="item-142402">
  <!-- Start Component Field: {"XPath":"tcm:Content/custom:Accordion/custom:items[1]/custom:title"} -->
```

The component's name is its class token, its id is on the tag, and every authored field carries its CMS path — repeat index included. "The second item in the FAQ" is not inferred from indentation or counted by hand; the page states it. Modules are read in document order by a depth-counting scan rather than a lazy match, so a nested wrapper can never close one early.

What that buys, on a real page:

- **Untranslated content is named, not merely missed.** A field reading as English on a page whose brief is not English is reported as *"FAQ (item-142402) · Accordion/items[2]/title — this field reads as English on a page the brief localizes"*, quoting the English sitting there. That is the defect a missing-row finding can never describe, because the row is looking for text nobody ever wrote. It only fires when the brief itself is not English, so an English brief never accuses the page of anything.
- **A component published with a hole in it is caught.** Three empty `MultiCTAModule/module[n]/title` fields on the live Slovenia page, each named by its field. Asset fields are exempt — they hold a URL, and the image checks already cover those.
- **A link into the CME** (`/ui/editor/item?item=tcm:…`) is a break, the Tridion twin of the `/content/` author path already checked for on AEM.
- **`lang="sl"` against `data-lang="EN"`** — the page contradicting itself about its own language.
- **Hidden headings stop producing phantom duplicates.** The template stamps the window title into several `display:none` H2s; counting those reported three duplicate headings on a page that renders one.

**The name is what stays the same between pages.** A component is named by its type and its field path — `FAQ · Accordion/items[2]/title` — because both are identical wherever that component is used. The item id is not: `item-142402` here is `item-93871` on the next page, and three sections on the real page carry no id at all, the carousel among them with nine authored fields. So the ids ride alongside the name rather than inside it: the anchor to jump to the block in a browser, the `tcm:` id to open it in the CME. Where a page carries two of the same component — it carries two content-rivers and two multi-CTAs — they are told apart by position, `Content river #1` and `#2`.

**A brief's front matter is not page copy.** A labelled brief opens with rows saying what the page *is* — `Page Title/Title Tag`, `Meta Description/Meta Tag`, `Keywords`, `Internal Links` — and only then the copy it must carry. Reading those rows by four exact spellings (`Meta Title:`, `Meta Description:`, `Meta Keywords:`, `URL Path:`) worked until a real kone.com.au blog brief arrived writing every one of them differently: tab-separated instead of colon-separated, `Page Title/` wrapped onto the next line by the paste, four keywords and three internal links on `●` bullet rows underneath. None of it matched, so all five metadata fields reported *"not defined in the brief"* on a page that matched the brief exactly — and the front matter fell through to the body catch-all and reported as eleven missing paragraphs, of which one was real. The front matter is now read as what it is: the leading run of label rows, whether tab- or colon-separated, with a wrapped label rejoined and bullet rows attached to the label above them. The vocabulary lives in `config/work-types.json` (`compare.briefLabels`) — add a spelling when a brief uses one the tool doesn't know. The whole label is matched before either half of a slashed one, which is what makes `Blog Topic/Title` the H1 rather than the meta title. A label the vocabulary doesn't recognise is never silently dropped: it stays out of the body copy and is named on the Metadata block, so the difference between *checked* and *ignored* stays visible. The first row that isn't a label row closes the front matter for good, and everything below it is copy, read exactly as before.

**A URL is not four sentences.** When a whole paragraph doesn't match, the comparer descends to sentences — and it split on every `.`, so one brief row carrying three internal links reported four missing paragraphs reading `https://www.`, `kone.`, `com.`, `au/blogs/x.`. A terminator now only ends a sentence when whitespace or the end of the text follows it. In the same pass, keywords compare as the set they are: a brief writing them one per bullet and a page rendering them comma-joined with no spaces are the same list, and only a genuinely missing or extra keyword is a defect. And a brief declaring a bare internal URL is matched by where it points, not by its label — the page's own anchor says "KONE elevator modernisation", and matching that by text reported three present links as missing.

**The report shows what passed, not only what failed.** Body Text and Hyperlinks / CTAs each lead with their summary, and opens to a row-by-row ledger: every line the brief asked for, whether it landed, and which component it landed in. A link says which anchor it was found under, so *"found as “KONE elevator modernisation”"* answers the question a bare "No deviations" never could: were the three internal links the brief named actually checked, and where did they land.

```
row 4 · not found — sits between Hero banner and Content river
row 2 · found in Hero banner
```

A missing row is placed by the rows around it that did match — the nearest located row above and below name the span it belongs in. That is derived from the matches, never guessed: with nothing on one side it says "after Hero banner", and with no components on the page at all it says nothing rather than inventing a location. Found-or-missing is still decided by the whole-region count, so a page built without module sections reports exactly as it always did — the components only answer *where*.

**Reading text out of markup respects inline vs block elements.** Word-pasted content — the India blog page is a real example — carries a tag boundary right up against punctuation with no space in the source: `Construction elevators</span></a></strong><span lang="EN-IN">, also known as…`. A browser renders no gap there because `span`/`a`/`strong` are inline. The extractor used to replace every tag with a space regardless, so its copy of the page read `Construction elevators , also known as…` and an exact-match brief row reported "not found" for a paragraph that was there verbatim. Inline tags now contribute nothing; block tags and `<br>` still contribute a space, which is what keeps `<p>One</p><p>Two</p>` from reading as `OneTwo`. `filler.js` carried the identical bug — an English master pasted with a link before a comma would fail the exact match and fall through to a lower-confidence fuzzy match — and gets the identical fix.

**A brief's section marker doesn't know it's looking at a question, not a heading.** `Emergency Braking Systems[2.1]` and `What is an MRL elevator and why is it popular?[8.6]` carry the identical bracket convention, so both become an expected page heading — but the Structure check only ever looked for `<h1>`–`<h3>`. On the real KONE India FAQ, every question is a bare `<button class="accordion-trigger">` with no heading tag around it at all, so all eight questions reported "section heading missing" while sitting in the accordion exactly where they belonged. An accordion question functions as a heading — it labels a block of content a reader expands — whether or not the template wrapped it in an `h`-tag, so the Structure check now reads a configurable `accordionTriggers` class (`config/work-types.json`) alongside real headings for both presence and order. The duplicate-heading check is untouched: that one is about genuine HTML structure, and an accordion legitimately reuses the same button markup for every question.

## One shared understanding of the brief

`engine.js`, `compare.js` and `filler.js` used to each parse the brief their own way, and each had found the same class of bug independently: raw-newline splitting that a quoted multi-line cell would shatter, and a target inferred from structure that never checked whether more than one candidate existed. `brief.js` now does the one thing all three need — quote-aware row splitting, which row is a section header, which columns are markets, and which market the brief actually targets — and the other three consume it rather than re-deriving it. Fixing a parsing bug once, in one file that all three load, is the point.

## Structure

```
index.html                    UI, two tabs — Analyse, QA
app.js                        renders what the modules return — no analysis of its own
brief.js                      one parse shared by the others: rows, sections, markets, target
engine.js                     classify → detect CMS → check needs → return steps
compare.js                    read the page → read the brief → diff → group by category
filler.js                     each market's text out of a brief, markup carried across — fills the mock page
readers.js                    .docx / .xlsx / .csv → text, with no dependencies
page-model.js                 one neutral component model, from a brief or from a page
mock-page.js                  draws the page-model.js model as a sandboxed HTML preview
qa.js                         QA a page: the framework's checks, the title format, and the brief comparison when given one
config/work-types.json        the six playbooks, the compare settings, the market list
config/mock-components.json   the render-type vocabulary page-model.js infers components into
config/tridion-taxonomy.json  real Tridion component names → their documented field slots
config/sites.json             the site registry: market, domain, Form Assembly ID, accepted site names
test/brief.test.js            22 cases, the shared parse alone
test/engine.test.js           53 cases, fixtures are real briefs
test/compare.test.js          162 cases, deviations planted one per category,
                               plus excerpts of real KONE pages as fixtures
test/readers.test.js          10 cases, run against real ZIP bytes
test/filler.test.js           26 cases, including markup that must never be guessed
test/page-model.test.js       48 cases, including a real agency mockup with no Tridion markup at all
test/mock-page.test.js        26 cases, safety-first: escaping, hrefs, no external requests
test/qa.test.js               57 cases, the real Slovenia preview and Italian landing pages among them
serve.js                      local static server
```

# WCM Helper

Three tools behind one page.

**Analyse** — paste a work brief, find out what it is and how to do it.
**Compare** — paste the brief and the HTML of the page that got built, find out where they differ.
**Fill** — paste the English master from a Tridion component, get the localized text to replace it with.

## Analyse

Paste a work brief. Get back four things:

1. **What kind of job this is**, and which CMS the target site is on
2. **What that kind of job needs**, and what the brief already has
3. **The steps to do it** in that CMS
4. **What is still missing**, as questions to send back

Nothing else. A two-line redirect request gets two questions at most — not a checklist about components, assets, markets and approvers that belong to a different kind of job.

## Compare

Paste the same brief plus the built page's source (or upload the `.html`), and the comparer answers one question first — **is everything the brief asked for actually on the page?**

That is the headline. *"All 74 items from the brief are on the page"*, or *"61 of 74 — 13 missing"*. Underneath it sit the differences, in five groups: Metadata, Body Text, Images, Hyperlinks/CTAs, Structure. A group with nothing wrong says "No deviations."

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

It works on the four jobs that produce a page to read — new page, localization, content update, keyword update. Redirect and removal are checked by following the URL, so the Compare tab says so rather than inventing findings.

Two limits worth stating plainly:

- **The tool cannot fetch the page.** A static browser app is blocked by CORS from reading a live KONE URL, which is why the HTML is pasted or uploaded. It follows that it cannot tell you an image is *broken* — only that the brief named an asset the page does not carry.
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

## Fill

Localizing in Tridion means opening each component, reading the English master in the field, and finding that row in a brief that may run to a hundred rows. The finding is the slow part. Paste the English you are looking at and the Fill tab returns the localized text on a Copy button, plus the whole brief as a worklist you can tick down — progress is remembered per brief.

**It cannot read or write Tridion fields.** This is a static page on a different origin from the CME, so the author still does the paste. Auto-fill would need a browser extension running inside the CME, which is deferred rather than forgotten.

**A brief naming several markets has a target, not a "last column".** A localization sheet carrying English, Spain, Italy and Portugal side by side used to hand back whichever column happened to be last — confidently wrong on every market but one. The target market is read from the brief's own front matter (`Level 2 / SPAIN`) and shown in a dropdown that lists every market the brief declares; switching it needs no re-paste. A brief naming markets with no declared target asks rather than guesses.

**Two rows sharing the same English text are never resolved by picking one.** The same CTA label reused across several components is common, and taking the first exact match used to hand back total confidence on what was really a coin flip. Every row carrying that text is listed instead, with its section and line so the choice is the author's.

**Formatting is carried across where it can be placed with certainty.** If the English master held `Learn more about <a href="/maintenance/">KONE Predictive Maintenance</a>` and that product name appears verbatim in the localized text — as brand and product names usually do — the link is reapplied around it, and Copy writes `text/html` so it survives the paste into a rich-text field. Where the anchor text *was* translated, the link cannot be placed deterministically, so it is listed explicitly — *"`<strong>` was on 'design freedom'"* — rather than dropped or guessed into the wrong position. A silently dropped link is a defect the Comparer would only catch two steps later.

Matching runs exact → contained → closest, and a closest match shows its overlap score rather than presenting itself as certain. A brief with no English column says so and falls back to the worklist.


## Briefs as files

**Upload brief** accepts `.docx`, `.xlsx`, `.csv`, `.txt` and `.md`. Word and Excel files are ZIP containers and are read with the browser's native `DecompressionStream` — no library, so the project still has zero dependencies.

Word tables and spreadsheets come out **tab-separated**, which is the shape the localization and keyword playbooks already parse, so a spreadsheet brief feeds them unchanged. Old binary `.doc`/`.xls` cannot be read and say so; re-save as `.docx`/`.xlsx`.

Pasted-from-Word briefs are checked for paste damage — bullets that arrived as literal `●` characters, leftover `mso-list` markup, mixed smart and straight quotes. These are reported as **brief quality** notes above the results, because the brief is what is malformed, not the page.

## Running it

```
npm start     # http://localhost:3600
npm test      # 185 verification cases across the five modules
```

No dependencies, no build step, no backend. It has to be *served* rather than opened from disk, because the playbooks are fetched at runtime and browsers block `fetch` over `file://`.

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

**The report shows what passed, not only what failed.** Body Text still leads with its summary, and opens to a row-by-row ledger: every line the brief asked for, whether it landed, and which component it landed in.

```
row 4 · not found — sits between Hero banner and Content river
row 2 · found in Hero banner
```

A missing row is placed by the rows around it that did match — the nearest located row above and below name the span it belongs in. That is derived from the matches, never guessed: with nothing on one side it says "after Hero banner", and with no components on the page at all it says nothing rather than inventing a location. Found-or-missing is still decided by the whole-region count, so a page built without module sections reports exactly as it always did — the components only answer *where*.

**Reading text out of markup respects inline vs block elements.** Word-pasted content — the India blog page is a real example — carries a tag boundary right up against punctuation with no space in the source: `Construction elevators</span></a></strong><span lang="EN-IN">, also known as…`. A browser renders no gap there because `span`/`a`/`strong` are inline. The extractor used to replace every tag with a space regardless, so its copy of the page read `Construction elevators , also known as…` and an exact-match brief row reported "not found" for a paragraph that was there verbatim. Inline tags now contribute nothing; block tags and `<br>` still contribute a space, which is what keeps `<p>One</p><p>Two</p>` from reading as `OneTwo`. `filler.js` carried the identical bug — an English master pasted with a link before a comma would fail the exact match and fall through to a lower-confidence fuzzy match — and gets the identical fix.

## One shared understanding of the brief

`engine.js`, `compare.js` and `filler.js` used to each parse the brief their own way, and each had found the same class of bug independently: raw-newline splitting that a quoted multi-line cell would shatter, and a target inferred from structure that never checked whether more than one candidate existed. `brief.js` now does the one thing all three need — quote-aware row splitting, which row is a section header, which columns are markets, and which market the brief actually targets — and the other three consume it rather than re-deriving it. Fixing a parsing bug once, in one file that all three load, is the point.

## Structure

```
index.html              UI, three tabs
app.js                  renders what the modules return — no analysis of its own
brief.js                one parse shared by the other three: rows, sections, markets, target
engine.js               classify → detect CMS → check needs → return steps
compare.js              read the page → read the brief → diff → group by category
filler.js               find the row from its English master → carry the markup across
readers.js              .docx / .xlsx / .csv → text, with no dependencies
config/work-types.json  the six playbooks, the compare settings, the market list
test/brief.test.js      15 cases, the shared parse alone
test/engine.test.js     43 cases, fixtures are real briefs
test/compare.test.js    92 cases, deviations planted one per category,
                        plus an excerpt of a real KONE page as a fixture
test/readers.test.js    9 cases, run against real ZIP bytes
test/filler.test.js     26 cases, including markup that must never be guessed
serve.js                local static server
```

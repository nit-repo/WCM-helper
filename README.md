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

Paste the same brief plus the built page's source (or upload the `.html`), and the comparer reports **only the differences**, in five groups: Metadata, Body Text, Images, Hyperlinks/CTAs, Structure. A group with nothing wrong says "No deviations."

**A brief it cannot read is never reported as clean.** If the parse yields no expectations, the tool says so instead of showing five green ticks — a comparison that never ran must not look like one that passed. This was a real failure: a Portuguese brief and its live page came back "No deviations" while the page carried eight defects.

**Nor is a brief it read wrongly reported as a broken page.** The same brief later came back with 78 findings, of which about three were real. A brief can parse into plenty of expectations and still have been misread — a torn row, a shifted column — and then nearly all of them fail. A real page fails some checks; it does not fail all of them. So when 90% or more of at least eight expectations come back missing, the tool withholds them and says the brief did not parse, naming the shape it read. Findings that need no brief to be right — placeholder links, dead CTAs, contradictory stats — still report.

**Metadata says when it checked nothing.** A brief that defines no meta title used to render exactly like one whose title matched, which is how an English `<title>` shipped on a Portuguese page unreported. Each field is now matches / differs / not defined in the brief, and the category says which. Comparison itself is word for word — only the punctuation a CMS rewrites is folded, never case.

**Briefs are split into rows honouring quotes.** Excel and CSV wrap a cell holding more than one paragraph in quotes and keep its newlines inside. Splitting on newlines first tears that row in half, which is what made the tool read a perfectly good table as prose and invent 74 findings from it. Rows are now parsed with the quoting rules the exports actually use.

Localization briefs arrive as a tab-separated table or as prose, and both work — the result names which shape it read and how many things it is checking. **Prose asserts nothing about structure**: a short line in a prose brief is as likely to be a stat, a CTA label or a market name as a heading, and treating every one of them as a section heading is where 39 of those 78 phantom findings came from.

Every finding is either a **break** — a real defect — or a **check**, something expected to fire on correct pages that a human should glance at. Breaks sort first, and the tally at the top reads "*2 to fix, 1 to check by eye*". The distinction exists because a comparer that cries wolf gets ignored.

It works on the four jobs that produce a page to read — new page, localization, content update, keyword update. Redirect and removal are checked by following the URL, so the Compare tab says so rather than inventing findings.

Two limits worth stating plainly:

- **The tool cannot fetch the page.** A static browser app is blocked by CORS from reading a live KONE URL, which is why the HTML is pasted or uploaded. It follows that it cannot tell you an image is *broken* — only that the brief named an asset the page does not carry.
- **Body text is compared verbatim after normalising.** Whitespace, `&nbsp;` and curly quotes are folded, then the match must be exact. A reworded sentence is reported; whether the rewording was deliberate is a judgement left to you.

**URLs are compared as paths.** `preview.kone.in/services/index.aspx` and `www.kone.in/services/` are the same page, so the scheme, host, `.aspx`/`.html` extension, directory `index`, and trailing slash are all dropped before comparing — the query string is kept, because it can be meaningful. An environment difference is never reported; a genuinely different path still is.

**Images are matched on asset identity, not filename.** A DAM or Scene7 embed URL is often a crop of the briefed asset with a variant suffix and preset parameters, so `shutterstock2335854375` in the brief resolves to `shutterstock2335854375-1?$hero-desktop$` on the page. When no image resolves, that is a **check** rather than a break — embed URLs frequently carry none of the brief's asset name, so it is a prompt to look, not a defect.

**Some defects need no brief at all.** A link still pointing at `href="#"`, a call to action that is bare text with no link, and a stat card whose figure contradicts its own caption — `70%` above "Até 74% de poupança energética" — are all reported from the page alone. All three were found on a real KONE page.

Anchors that are legitimately `href="#"` are left alone: back-to-top and skip links by label, accordion and tab toggles by their ARIA attributes. Add market-language labels to `compare.safeAnchorLabels` in the config. A stat and its caption are paired by distance **in text, not markup** — a real card puts a dozen wrapper divs between them, and a window counted in raw characters missed the contradiction on the page it was built for.

**Body text is matched paragraph first, then sentence by sentence.** A brief cell holding two sentences is often rendered by the page in two separate elements, so the paragraph never appears as one continuous string. Only when the whole paragraph fails does the tool descend to sentences, which keeps a fragment from matching by accident while letting correctly-built pages pass.

Lazy-loaded images resolve to the asset rather than the loading placeholder, whichever order `src` and `data-src` appear in.

Where the comparer reads the page content from is shown above the results. If it says "body minus nav, header and footer" and the Body Text group fills with menu labels, add the template's content wrapper class to `compare.contentSelectors` in `config/work-types.json`.

## Fill

Localizing in Tridion means opening each component, reading the English master in the field, and finding that row in a brief that may run to a hundred rows. The finding is the slow part. Paste the English you are looking at and the Fill tab returns the localized text on a Copy button, plus the whole brief as a worklist you can tick down — progress is remembered per brief.

**It cannot read or write Tridion fields.** This is a static page on a different origin from the CME, so the author still does the paste. Auto-fill would need a browser extension running inside the CME, which is deferred rather than forgotten.

**Formatting is carried across where it can be placed with certainty.** If the English master held `Learn more about <a href="/maintenance/">KONE Predictive Maintenance</a>` and that product name appears verbatim in the localized text — as brand and product names usually do — the link is reapplied around it, and Copy writes `text/html` so it survives the paste into a rich-text field. Where the anchor text *was* translated, the link cannot be placed deterministically, so it is listed explicitly — *"`<strong>` was on 'design freedom'"* — rather than dropped or guessed into the wrong position. A silently dropped link is a defect the Comparer would only catch two steps later.

Matching runs exact → contained → closest, and a closest match shows its overlap score rather than presenting itself as certain. A brief with no English column says so and falls back to the worklist.

## Briefs as files

**Upload brief** accepts `.docx`, `.xlsx`, `.csv`, `.txt` and `.md`. Word and Excel files are ZIP containers and are read with the browser's native `DecompressionStream` — no library, so the project still has zero dependencies.

Word tables and spreadsheets come out **tab-separated**, which is the shape the localization and keyword playbooks already parse, so a spreadsheet brief feeds them unchanged. Old binary `.doc`/`.xls` cannot be read and say so; re-save as `.docx`/`.xlsx`.

Pasted-from-Word briefs are checked for paste damage — bullets that arrived as literal `●` characters, leftover `mso-list` markup, mixed smart and straight quotes. These are reported as **brief quality** notes above the results, because the brief is what is malformed, not the page.

## Running it

```
npm start     # http://localhost:3600
npm test      # 107 verification cases across the four modules
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

Assets now live in Adobe DAM whichever CMS serves the page, so a `adobecqms.net` or `/content/dam/` link never counts as evidence — a Tridion brief full of AEM DAM links is still a Tridion brief.

**Every call shows its working.** Each classification carries the signals that produced it and their weights, so you can check the tool rather than trust it. The same brief always analyses identically. When nothing clearly identifies a brief, it says so instead of guessing, and the work type and CMS can both be set by hand.

## Structure

```
index.html              UI, three tabs
app.js                  renders what the modules return — no analysis of its own
engine.js               classify → detect CMS → check needs → return steps
compare.js              read the page → read the brief → diff → group by category
filler.js               find the row from its English master → carry the markup across
readers.js              .docx / .xlsx / .csv → text, with no dependencies
config/work-types.json  the six playbooks, plus the compare settings
test/engine.test.js     32 cases, fixtures are real briefs
test/compare.test.js    50 cases, deviations planted one per category
test/readers.test.js    9 cases, run against real ZIP bytes
test/filler.test.js     16 cases, including markup that must never be guessed
serve.js                local static server
```

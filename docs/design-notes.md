# Design notes

Why parts of WCM Helper work the way they do. These sections were moved here from the README unchanged, so the README can stay how-to and reference.

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

## Faults that building new parts turned up

**Building it turned up a bug in the comparison.** The check for a link pasted straight from the CME only recognised `/ui/editor/item?item=`. Neither real CME URL matches that — the new UI is `web-cms.kone.com/ui/editor/page?activeItem=…`, the old one `web-cms.kone.com/WebUI/item.aspx?tcm=…` — so the defect it exists to catch went unreported on both. It now recognises all three.

Writing the generator turned up three faults in extraction that had been quietly costing the comparison matches on real pages, all now fixed and covered:

- **A percent-encoded filename never matched its own name.** A brief writing `Graphic 1` resolved to `graphic1`; the page's own `Graphic%201.jpg` resolved to `graphic201`. Every asset with a space in its name, on every AEM page.
- **A Scene7 rendition preset was read as part of the asset name.** `Monospace100_img_3-1:669x475` is one asset delivered at one size, not an asset called `Monospace100_img_3-1:669x475`.
- **`&reg;` was not decoded** while `&trade;` was, so a brief writing `KONE MonoSpace®` never matched a page rendering the entity. `&copy;`, `&deg;`, `&hellip;` and hex numeric entities were missing too.

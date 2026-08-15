# WCM Brief Analyser

Paste a work brief. Get back four things:

1. **What kind of job this is**, and which CMS the target site is on
2. **What that kind of job needs**, and what the brief already has
3. **The steps to do it** in that CMS
4. **What is still missing**, as questions to send back

Nothing else. A two-line redirect request gets two questions at most — not a checklist about components, assets, markets and approvers that belong to a different kind of job.

## Running it

```
npm start     # http://localhost:3600
npm test      # 20 verification cases
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
index.html            UI
app.js                renders the engine's result — no analysis of its own
engine.js             classify → detect CMS → check needs → return steps
config/work-types.json  the six playbooks
test/engine.test.js   32 cases, fixtures are real briefs
serve.js              local static server
```

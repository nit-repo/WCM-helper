# Changelog

What changed in WCM Helper, newest first. Each entry is one merged pull request; the build string is what the sidebar shows under the wordmark.

## 2026-11-11a — Safety net: automatic tests, browser tests, security headers

Nothing changes in what the tool reports.

- **Tests run on every pull request**: the code-style check, the unit tests and the browser tests (`.github/workflows/test.yml`).
- **Browser tests are in the repo** (`test/e2e/`): the real tool in a real browser against the real backend code and stand-in KONE sites. They cover sign-in, Live URL, crawls, forms, redirects and load time, link checking, the Summary, the no-backend mode, Analyse and the mock page, and the bookmarklet.
- **Security headers on the tool's own site**, including a Content-Security-Policy that runs scripts from the site only. The inline scripts moved into `gate.js`, `login.js` and `bookmarklet.js`.
- **Test files, scripts and Markdown files are no longer published** with the site, and `/backend/` is redirected away.
- **A code-style check** (ESLint, parsing the tool as ES5). It found a handful of unused variables and one unused function, now removed.
- **One command sets the build string**: `npm run version:set -- <build>`.
- The README gains a Development section; design notes moved to `docs/design-notes.md`.

## 2026-10-27b — KONE US and India on kone.com (#8)

- **Markets under a path on a shared domain**: United States is `kone.com/en-us` and India `kone.com/en-in`, beside the corporate site. Each market's own sitemap is read first.
- **AEM's native forms are read**: form path, the market they post to, the lead fields, and the topic they sit behind. A **Form market** check replaces the FormAssembly ID comparison on AEM-only pages.
- **New checks**: form accessibility (labels, empty legends), links that leave the market on a shared domain, header and footer belonging to the market.
- **Titles**: `Page name | KONE US`; "KONE Corporation" is a fix on US and India pages.
- **Open in AEM** link for US and India pages.
- **Crawl picker** uses KONE's own areas and frontlines; Australia and New Zealand added; a crawl URL list accepts area and frontline codes.

## 2026-10-21e — Redirects, load time and FormAssembly forms (#7)

- **Redirects**: the full chain with each hop's status and time; more than three redirects, or a loop, is a fix.
- **Load time**: time to first byte and HTML load time, with a check when slow, and an option to average three fetches.
- **FormAssembly forms are read from the page itself** — AEM's form component, an embed script or iframe, or rendered markup — so AEM pages are checked against their market's form ID. A crawl URL list can name the expected form ID per URL.

## 2026-10-21c — Broken links say where they are (#6)

- A broken link is reported with the component, block and heading it sits under.

## 2026-10-21b — pass / check / fix (#5)

- Verdicts read **pass / check / fix** instead of green / amber / red.
- A generic call-to-action ("Explore options") is judged by the component it sits in.
- A **Link suggestions** option on every QA source: pasted page, Live URL and crawl.

## 2026-10-20 — The Summary (#4)

- **Summary card**: spelling and wording, sitemap-aware link suggestions, lists and numbering, metadata, with Copy summary.
- " - KONE country" titles; a clearer sign-in error when the backend refuses the site's address; plainer hints.

## 2026-10 — The backend (#2, #3)

- **Live URL and crawl**: a small backend fetches live KONE pages, sitemaps and link statuses, behind one shared password. The tool is connected to its deployed backend.
- Two tabs, **Analyse** and **QA**, and a title-format score.

## 2026-09 — Build stamp (#1)

- The sidebar says which build is running, and every script is loaded by version so a browser cannot serve an old one.

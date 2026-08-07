# WCM Brief Analyser

Reads a web content management brief — an email, a ticket description, a paragraph from a
stakeholder — and reports what the work actually is, what is missing from it, and what will bite
you when you execute it.

Built for KONE WCM work across **AEM (AEMaaCS)** and **Tridion (SDL/RWS)**. It is read-only: it takes
no action, calls no API, and sends nothing anywhere. Output is structured findings a human acts on.

```
npm start        # serves on http://localhost:3600
npm test         # 15 verification cases against the scoring engine
```

No dependencies, no build step, no backend. The page makes zero external requests.

> The config JSONs are fetched at runtime, so the page must be **served**, not opened from disk —
> `file://` will block the fetches. That is the only reason `serve.js` exists.

---

## What it does

Five passes over the brief, in the order the plan specifies:

1. **Nature of work** — scores the brief against all 9 work types at once and detects the CMS
2. **Components** — those named or implied, plus those a page of this type normally carries but the
   brief never mentions
3. **Assets** — for every identified component that needs one (Hero → image, Video Embed → video URL,
   Form → field list), whether the brief actually supplies it
4. **Synthesis** — a plain-language statement of what needs to happen, with risk flags attached
5. **Missing details** — field completeness, hard blocks, and a generated question per gap

Results are presented in priority order — **hard blocks → scope risks → completeness → effort tier →
components → assets → execution steps** — because a P1 block or a multi-market bundle means the brief
needs restructuring before a completeness percentage means anything.

## Why it is scored, not matched

Every brief is scored against **all nine work types simultaneously**, with weighted keywords: strong
signals (3) are unambiguous and type-specific (`Tridion`, `EXF`, `nofollow`, `blueprint adoption`),
medium (2) are fairly specific, weak (1) are generic cross-type words (`publish`, `page`, `content`).
Highest total wins, and a term counts once however often it appears — repetition is emphasis, not
evidence.

A classification is reported as **Ambiguous — please confirm** rather than guessed when any of three
things is true:

- nothing matched;
- the runner-up is within 15% of the winner;
- the winner is built only of weak signals, or scores below `minConfidentScore`.

That third rule exists because of a real case: *"Please publish the updated content to the page"*
wins New Page by a 33% margin on three weak words — comfortably past the margin test, while carrying
no actual evidence. A confident wrong answer is the failure mode that matters here, so it is treated
as no answer.

Every classification carries the keywords that produced it. The UI shows them under **Why this
classification?**, and they go into the Excel export as an audit column.

## CMS detection

Auto-detected from platform fingerprints, weighted so that sharp ones (`author-p*.adobeaemcloud.com`,
`/content/`, `wcmmode=disabled`, Structure Group, Publication ID) outrank generic mentions.

| State | Meaning |
|---|---|
| **AEM** / **Tridion** | One platform's signals present |
| **Mixed — Migration context** | Both present. Not a tie to break — that is what a migration brief looks like |
| **Unspecified** | Neither. Execution steps are withheld until you pick one, since they differ by platform |

A manual override is always available and takes precedence.

## Country codes are context-gated

`IT`, `US`, `IN`, `AT` are English words as often as they are markets. A code counts as a market only
when:

- it is a **full country name** (unambiguous), or
- it sits in a **path or URL segment** (`/content/frontlines/uk/en`, `en_AU`) — lowercase is the
  convention there, or
- it is **ALL-CAPS in prose and within four tokens of a market anchor** (`site`, `market`,
  `rollout to`).

Both halves of the last rule are needed. The anchor window alone lets *"It should roll out to all
country sites"* register as Italy; the caps rule alone fires on *"the IT department"*.

## Layout

```
index.html              app shell + styles
app.js                  UI — renders from the engine's result object, analyses nothing itself
engine.js               scoring, tie-breaking, confidence, gap detection
export.js               Excel export (14 audit columns)
feedback.js             correction capture + curation queue
serve.js                static host (Node core only)
config/
  work-types.json       9 work types, weighted keywords, field catalogue, questions
  components.json       AEM + Tridion components, page-type matrix, asset requirements
  risk-flags.json       hard blocks + merged known-bug catalogue with severity
  locations.json        markets, regions, environments, path patterns, CMS fingerprints
  execution-steps.json  CMS-specific step sequences
test/engine.test.js     the plan's verification list, as executable cases
```

Adding a component, a market, a newly-discovered bug or a keyword is a **JSON edit** — no code change.

## Built for an agent layer later

v1 is read-only by design, but shaped so an agent can sit on top without a rewrite:

- the engine emits **one canonical result object**; the UI, the export and any future tool call all
  read the same thing
- execution steps carry a machine-readable `action` (`create_page`, `publish_exf_children`) alongside
  the human instruction
- clarifying questions are **structured data** (field id → question), so a later agent can send one,
  take the reply and re-score
- the audit trail is load-bearing the moment a version can act rather than only recommend

## Interactive refinement, and why there is no learning

Open-ended questions appear when confidence is low or scope is unclear. An answer is **appended to
the brief and re-scored through the same engine** — no special-casing, so a refined result is as
explainable as a first-pass one.

Corrections (overriding a work type, answering an open question) are logged to `localStorage` and
aggregated into a **review queue**: *"seen 4 times; 'quote block' appeared in 3 of them — add it as a
trigger keyword?"* Nothing is applied automatically. The dictionaries change when a person edits the
JSON and commits it.

This is deliberate. There is no training infrastructure in a single-page tool, and a classifier that
quietly reweights itself from user answers breaks the promise the tool exists for. Where these
tickets feed release gates, silent drift is a worse failure than being occasionally wrong in a way
you can see and argue with.

## Excel export

14 columns: Work Type, CMS Platform, Target Page Location, Completeness Score, Missing Fields, Risk
Flags, Identified Components, Recommended Components, Identified/Missing Assets, Execution Steps,
Brief Summary, Environment Scope, Classification Confidence, Matched Keywords (Audit).

Written as SpreadsheetML 2003, which Excel opens natively, rather than via SheetJS from a CDN — a CDN
request would break the page under a strict CSP or on an air-gapped network, which is exactly where
WCM work happens. CSV export is also available.

## Known deviations from the plan

| Plan | Built | Why |
|---|---|---|
| 8 work types | **9** | The reference catalogue lists nine; QA / Audit was missing from the count |
| Excel via SheetJS CDN | SpreadsheetML 2003, generated locally | Keeps the page at zero external requests |
| Field-level completeness weights | Equal weights per required field | The plan referenced v2's weights but did not carry the table over; equal weighting is the honest default until real weights exist |
| `.docx` upload | Supported | Parsed in-browser by walking the ZIP directly and inflating with `DecompressionStream` — no library, no CDN |

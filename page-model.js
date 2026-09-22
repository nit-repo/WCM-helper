/* page-model.js — one neutral reading of a brief, shared by Fill's mock page,
 * Compare and (eventually) any other renderer.
 *
 * Fill's "find localized text" view answers one row at a time. It never
 * shows the page. This module turns the same brief into a page: metadata,
 * an ordered list of components (hero, content, cards, steps, table,
 * accordion, cta, image, or generic-for-review), and a list of rows that
 * could not be grouped into anything at all.
 *
 * It is the shared model the mock renderer draws from, not a renderer
 * itself — no HTML here, no DOM. That is deliberate: without one shared
 * reading, Fill, Compare and a mock page would each grow their own
 * interpretation of the same brief, the way `want().section` already means
 * a heading in one mode of readBrief and a market name in another
 * (compare.js). This module does not repeat that mistake — `section` and
 * `market` are kept as separate fields throughout.
 *
 * It never invents. A campaign brief that declares a market and a URL but
 * no page copy produces metadata and nothing else — zero components, not a
 * guessed hero. Every component that IS produced carries the evidence it
 * was inferred from: which rows, and why.
 *
 * Runs in the browser (window.BriefPageModel) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./brief.js'), require('./compare.js'), require('./filler.js'));
  } else {
    root.BriefPageModel = factory(root.BriefShared, root.BriefCompare, root.BriefFiller);
  }
}(typeof self !== 'undefined' ? self : this, function (Brief, Compare, Filler) {
  'use strict';

  // ─── DEFAULT COMPONENT VOCABULARY ───────────────────────────────────────
  // Mirrors config/mock-components.json. Kept here too so a missing or
  // broken copy of that file never blocks Fill's existing lookup behaviour
  // — the same call DEFAULT_BRIEF_LABELS makes in compare.js.

  var DEFAULT_COMPONENTS = {
    hero: { signals: ['hero', 'herobanner', 'hero banner', 'banner', 'introduction', 'lead'], fields: ['subtitle', 'heading', 'body', 'image', 'cta'] },
    content: { signals: ['content', 'contentblocks', 'content block', 'rich text', 'paragraph', 'contentriver'], fields: ['heading', 'body'] },
    cards: { signals: ['cards', 'card group', 'teaser', 'campaignhighlight', 'productteaser'], fields: ['heading', 'items'], repeatable: true },
    'value-highlights': { signals: ['value highlights', 'valuehighlight', 'value highlight', 'benefits', 'benefit grid'], fields: ['heading', 'items'], repeatable: true },
    steps: { signals: ['steps', 'process', 'how it works', 'come funziona', 'cómo funciona', 'como funciona'], fields: ['heading', 'items'], repeatable: true, ordered: true },
    table: { signals: ['specification', 'specifications', 'table', 'specs', 'productspecification', 'productspecificationcarousel', 'productspecificationitem'], fields: ['heading', 'items'], repeatable: true },
    accordion: { signals: ['faq', 'faqs', 'question', 'answer', 'accordion', 'domande frequenti', 'preguntas frecuentes', 'perguntas frequentes'], fields: ['heading', 'items'], repeatable: true },
    cta: { signals: ['cta', 'button', 'internal links', 'call to action', 'multictamodule', 'related links'], fields: ['items'], repeatable: true },
    image: { signals: ['image', 'aem assets', 'cover image', 'hero image', 'asset'], fields: ['image', 'alt', 'caption'] },
    form: {
      signals: ['form', 'contact form', 'lead form', 'request form', 'submissions to', 'anti-spam',
        'privacy policy', 'informativa privacy', 'política de privacidad', 'política de privacidade'],
      fields: ['heading', 'body', 'cta']
    }
  };
  var DEFAULT_CHROME = ['navigation', 'nav', 'header', 'footer', 'breadcrumb', 'breadcrumbs', 'cookie', 'cookiepopup'];
  var DEFAULT_TEMPLATES = { landing: ['hero', 'cards'], article: ['content'], product: ['table'], faq: ['accordion'] };

  // config.compare.tridionComponents values (HeroBanner, Accordion, ...) are
  // PascalCase component NAMES, not our lowercase type vocabulary. This is
  // the one place the two vocabularies meet.
  var TRIDION_TYPE_OF = {
    herobanner: 'hero', accordion: 'accordion', contentblocks: 'content',
    productspecificationcarousel: 'table', productspecificationitem: 'table',
    productteaser: 'cards', campaignhighlight: 'cards', contentriver: 'content',
    multictamodule: 'cta', valuehighlight: 'value-highlights', form: 'form'
  };

  var CONF_RANK = { high: 3, medium: 2, low: 1 };
  function weaker(a, b) { return CONF_RANK[a] <= CONF_RANK[b] ? a : b; }

  function normaliseLabel(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // A plain substring search on a short signal is a trap the moment the
  // brief is in a Romance language: "form" is a substring of "formula",
  // "informativa" and "formulario", all ordinary words in Italian,
  // Spanish and Portuguese prose that have nothing to do with a form
  // component. Padding both sides with spaces after normalising turns the
  // search into a whole-word (or whole-phrase, for a multi-word signal)
  // match instead, which is what "the brief mentions X" was always
  // meant to mean.
  function signalHit(text, signals) {
    var n = ' ' + normaliseLabel(text) + ' ';
    if (n === '  ') return false;
    return signals.some(function (s) {
      var needle = ' ' + normaliseLabel(s) + ' ';
      return needle !== '  ' && n.indexOf(needle) !== -1;
    });
  }

  function signalType(text, components) {
    var n = normaliseLabel(text);
    if (!n) return null;
    var hit = null;
    Object.keys(components).some(function (type) {
      if (signalHit(n, components[type].signals)) { hit = type; return true; }
      return false;
    });
    return hit;
  }

  // ─── SOURCE ROWS ─────────────────────────────────────────────────────────
  // Every row number this module produces is 1-based, matching brief.js and
  // readBrief. filler.rows() returns 0-based `index` (= brief row - 1); it
  // is converted back with +1 at the boundary below, and nowhere else.

  function sortedUnique(nums) {
    var seen = {}, out = [];
    nums.forEach(function (n) {
      if (n == null || seen[n]) return;
      seen[n] = true; out.push(n);
    });
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  // ─── INFERENCE ───────────────────────────────────────────────────────────
  // Five tiers, tried in order. Every path that sets `type` also sets `why`
  // and `confidence` — there is no path that types a component silently.

  // Tier 1 — the brief names a component or template directly: a heading
  // text, a front-matter value, or a row label matching a configured
  // signal or a Tridion component name outright.
  function quoted(text) {
    return text.length > 70 ? text.slice(0, 67) + '…' : text;
  }

  function namedType(candidates, comp, why) {
    why = why || 'the brief names this section ';
    for (var i = 0; i < candidates.length; i++) {
      var text = candidates[i];
      if (!text) continue;
      var tridionKey = normaliseLabel(text).replace(/\s+/g, '');
      if (TRIDION_TYPE_OF[tridionKey]) return { type: TRIDION_TYPE_OF[tridionKey], why: why + quoted(text) };
      var type = signalType(text, comp);
      if (type) return { type: type, why: why + quoted(text) };
    }
    return null;
  }

  // Tier 2 — a row label resolves to one of the eight taxonomy slot types
  // unambiguously: "Accordion Question", "Hero Image", "CTA".
  var TAXONOMY_SLOTS = {
    hero: /\bhero\b/i,
    accordion: /\baccordion\b|\bfaq\b/i,
    cta: /\bcta\b/i,
    image: /\bimage\b|\bhero image\b|\bcover image\b/i
  };
  function taxonomyType(label) {
    if (!label) return null;
    for (var type in TAXONOMY_SLOTS) {
      if (TAXONOMY_SLOTS.hasOwnProperty(type) && TAXONOMY_SLOTS[type].test(label)) {
        return { type: type, why: '"' + label + '" is a recognised ' + type + ' slot' };
      }
    }
    return null;
  }

  // Tier 4 — shape. Read off a leaf candidate's own fields, with no label
  // vocabulary at all: heading+image+short body -> hero; heading+paragraphs
  // -> content; links only -> cta; image only -> image.
  function shapeOfLeaf(leaf) {
    var bodyCount = leaf.body.length;
    var hasImage = !!leaf.image;
    var hasLinks = leaf.links && leaf.links.length > 0;
    if (leaf.heading && hasImage && bodyCount <= 1) {
      return { type: 'hero', confidence: 'medium', why: 'a heading with an image and a short intro reads as a hero' };
    }
    if (leaf.heading && bodyCount >= 1) {
      return { type: 'content', confidence: 'medium', why: 'a heading followed by body copy reads as a content block' };
    }
    if (hasLinks && !leaf.heading && bodyCount === 0 && !hasImage) {
      return { type: 'cta', confidence: 'medium', why: 'label and URL pairs with no surrounding copy read as a CTA group' };
    }
    if (hasImage && !leaf.heading && bodyCount === 0 && !hasLinks) {
      return { type: 'image', confidence: 'medium', why: 'only an image asset, no heading or body' };
    }
    return null;
  }

  function isOrdinalHeading(text) {
    return /^\s*(?:\d{1,2}\s*[.):]|step\s+\d+|passo\s+\d+|paso\s+\d+)/i.test(String(text || ''));
  }

  // ─── LABELLED ORIENTATION (new-page / content-update style briefs) ───────
  // readBrief's labelled branch already parses front matter and the copy
  // block, but every heading it emits has had its own [n.m] marker
  // stripped, so the h1/h2/h3 hierarchy the marker carried is gone by the
  // time it reaches expect.sections. What is recoverable without it is
  // shape: a run of consecutive heading+short-body leaves reads as cards
  // (or steps, or accordion when every heading ends '?') whether or not the
  // hierarchy that produced them is still visible.

  // readBrief's copy scanner only recognises a heading when it carries the
  // Tridion-style [n.m] marker briefFrom() writes — a plainly pasted
  // content brief or blog article never has one, so every heading in it
  // reads as one more body paragraph and nothing ever groups into a
  // component. Rather than change readBrief itself (Compare depends on its
  // exact behaviour), this module does its own second pass over
  // expect.body: a short line with no terminal '.' or '!' — a '?' is
  // fine, an FAQ question is a heading too — reads as a heading here, the
  // same way labelShaped() already tells a front-matter label from a
  // sentence, just tuned looser since a prose heading can run longer than
  // a metadata label.
  function looksLikeHeadingLine(text) {
    var v = String(text == null ? '' : text).trim();
    if (!v || v.length > 90) return false;
    if (v.split(/\s+/).length > 12) return false;
    return !/[.!]$/.test(v);
  }

  // Likewise, "AEM Assets - X" is only recognised mid-line when the brief
  // writes it with readBrief's exact "HERO:" prefix; "Hero Image: AEM
  // Assets - X" — an ordinary way to write the same thing — is not. Read
  // more loosely here too, taking whatever follows the marker anywhere in
  // the line as the asset name.
  var LOOSE_AEM_RE = /AEM Assets\s*[-–]\s*(.+)$/i;

  // A brief written with real Tridion-style [n.m] markers still gets to
  // use them here — recognised first, before either of the two looser
  // checks below get a turn.
  var MARKER_RE = /^(.*?)\s*\[\d+\.\d+\]\s*$/;

  function classifyCopyLine(line) {
    var marker = MARKER_RE.exec(line);
    if (marker && marker[1]) return { kind: 'heading', text: marker[1].trim() };
    var asset = LOOSE_AEM_RE.exec(line);
    if (asset) return { kind: 'image', text: asset[1].trim() };
    if (looksLikeHeadingLine(line)) return { kind: 'heading', text: line };
    return { kind: 'body', text: line };
  }

  // readBrief's own copy scanner also drops any line under 40 characters
  // entirely — right for Compare, where a short line is more often noise
  // than a real expectation, but wrong here: "FAQs", "Technology",
  // "Maintenance" are all real headings a real article uses, and under
  // that floor they never even reach expect.body for this module to
  // reclassify. So the copy block is re-read directly from the brief's own
  // rows, independent of that floor — expect.sections/body/images tell
  // this function only where the copy block STARTS (the earliest row any
  // of them mention), not what is in it.
  function copyBlockStart(expect) {
    var rows = [].concat(
      expect.sections.map(function (w) { return w.row; }),
      expect.body.map(function (w) { return w.row; }),
      expect.images.map(function (w) { return w.row; }));
    return rows.length ? Math.min.apply(null, rows) : null;
  }

  function labelledStream(text, expect) {
    var stream = [];
    var start = copyBlockStart(expect);
    if (start != null) {
      var rows = Brief.splitRows(text);
      for (var i = start - 1; i < rows.length; i++) {
        var line = rows[i].join('\t').trim();
        if (!line) continue;
        var c = classifyCopyLine(line);
        stream.push({ kind: c.kind, text: c.text, row: i + 1 });
      }
    }
    expect.links.forEach(function (w) { stream.push({ kind: 'link', text: w.text, href: w.href, row: w.row }); });
    stream.sort(function (a, b) { return a.row - b.row; });
    return stream;
  }

  function labelledLeaves(text, expect) {
    var stream = labelledStream(text, expect);
    var leaves = [], preamble = null, current = null;

    stream.forEach(function (item) {
      if (item.kind === 'heading') {
        current = { heading: item.text, body: [], image: null, links: [], rows: [item.row] };
        leaves.push(current);
        return;
      }
      if (!current) {
        if (!preamble) preamble = { heading: null, body: [], image: null, links: [], rows: [] };
        current = preamble;
      }
      current.rows.push(item.row);
      if (item.kind === 'body') current.body.push(item.text);
      // The first image after a heading is the one that belongs to it —
      // a second "AEM Assets -" line before the next heading is extra and
      // is not allowed to silently replace the one already claimed.
      else if (item.kind === 'image') { if (!current.image) current.image = { asset: item.text, alt: null }; }
      else if (item.kind === 'link') current.links.push({ label: item.text, href: item.href });
    });

    return { leaves: leaves, preamble: preamble };
  }

  // Fold a run of consecutive leaf-shaped groups (one heading, at most one
  // short paragraph, no image, no links) into a single repeatable
  // component. A run of two or more is required — a lone card-shaped
  // section is just a short content block, not a group of cards.
  function isCardLeaf(leaf) {
    return !!leaf.heading && leaf.body.length <= 1 && !leaf.image && !leaf.links.length &&
      (leaf.body.length === 0 || leaf.body[0].length <= 320);
  }
  function isQuestionLeaf(leaf) {
    return !!leaf.heading && /\?\s*$/.test(leaf.heading) && leaf.body.length === 1 && !leaf.image && !leaf.links.length;
  }

  function foldRuns(leaves) {
    var out = [], i = 0;
    while (i < leaves.length) {
      var runEnd = i;
      if (isQuestionLeaf(leaves[i])) {
        while (runEnd < leaves.length && isQuestionLeaf(leaves[runEnd])) runEnd++;
        if (runEnd - i >= 2) {
          out.push({ kind: 'accordion-run', leaves: leaves.slice(i, runEnd) });
          i = runEnd; continue;
        }
      } else if (isCardLeaf(leaves[i])) {
        while (runEnd < leaves.length && isCardLeaf(leaves[runEnd]) && !isQuestionLeaf(leaves[runEnd])) runEnd++;
        if (runEnd - i >= 2) {
          out.push({ kind: 'card-run', leaves: leaves.slice(i, runEnd) });
          i = runEnd; continue;
        }
      }
      out.push({ kind: 'single', leaves: [leaves[i]] });
      i++;
    }
    return out;
  }

  function componentFromRun(run, comp, leadingHeading) {
    var leaves = run.leaves;
    var allRows = [];
    if (leadingHeading) allRows = allRows.concat(leadingHeading.rows);
    leaves.forEach(function (l) { allRows = allRows.concat(l.rows); });
    var heading = leadingHeading ? leadingHeading.heading : null;
    var headingNote = leadingHeading ? ', under its own heading "' + leadingHeading.heading + '"' : '';

    if (run.kind === 'accordion-run') {
      return {
        type: 'accordion', confidence: 'medium',
        why: leaves.length + ' consecutive question-shaped headings read as an accordion' + headingNote,
        heading: heading, subtitle: null, body: [],
        items: leaves.map(function (l) { return { question: l.heading, answer: l.body[0] || null }; }),
        image: null, links: [], sourceRows: sortedUnique(allRows)
      };
    }

    var ordered = leaves.every(function (l) { return isOrdinalHeading(l.heading); });
    // The run's own heading, when it has one, can name a more specific type
    // than shape alone ever could — "Value highlights" is exactly the
    // group a repeating title/body shape cannot tell apart from an
    // ordinary card group on its own.
    var namedRun = leadingHeading ? namedType([leadingHeading.heading], comp) : null;
    return {
      type: namedRun ? namedRun.type : (ordered ? 'steps' : 'cards'),
      confidence: namedRun ? 'high' : 'medium',
      why: namedRun
        ? namedRun.why + ' (' + leaves.length + ' repeating items)'
        : leaves.length + ' consecutive title/body groups read as ' + (ordered ? 'an ordered step flow' : 'a card group') + headingNote,
      heading: heading, subtitle: null, body: [],
      items: leaves.map(function (l) { return { title: l.heading, body: l.body[0] || null }; }),
      image: null, links: [], sourceRows: sortedUnique(allRows)
    };
  }

  function componentFromLeaf(leaf, comp) {
    var candidates = [leaf.heading].concat(leaf.links.map(function (l) { return l.label; }));
    var named = namedType(candidates, comp);
    // A heading rarely announces itself as a form ("Let's talk about your
    // project" says nothing about one) — but the boilerplate underneath it
    // often does ("submissions to Salesforce", "anti-spam"). Checked only
    // when the heading and links found nothing, so it never overrides a
    // more specific signal, just adds one this module would otherwise miss.
    if (!named && leaf.body.length) named = namedType(leaf.body, comp, 'the brief’s own body text mentions ');
    var tax = !named && leaf.heading ? taxonomyType(leaf.heading) : null;
    var shape = !named && !tax ? shapeOfLeaf(leaf) : null;

    var type, confidence, why;
    if (named) { type = named.type; confidence = 'high'; why = named.why; }
    else if (tax) { type = tax.type; confidence = 'high'; why = tax.why; }
    else if (shape) { type = shape.type; confidence = shape.confidence; why = shape.why; }
    else { type = 'generic'; confidence = 'low'; why = 'no component signal in these rows — review before publishing'; }

    return {
      type: type, confidence: confidence, why: why,
      heading: leaf.heading, subtitle: null, body: leaf.body.slice(),
      items: [], image: leaf.image, links: leaf.links.slice(),
      sourceRows: sortedUnique(leaf.rows)
    };
  }

  function isChrome(text, chrome) {
    var n = normaliseLabel(text);
    return !!n && chrome.some(function (c) { return n.indexOf(normaliseLabel(c)) !== -1; });
  }

  function buildLabelled(text, expect, comp, chrome) {
    var parsed = labelledLeaves(text, expect);
    var components = [], unresolved = [];

    if (parsed.preamble && parsed.preamble.rows.length) {
      var p = parsed.preamble;
      // Internal Links are declared in front matter, so they always sit
      // before the first heading by row order — that is not the same as
      // being orphaned. A preamble carrying only links (no stray body copy,
      // no image) is real content: a CTA group with no section of its own.
      if (p.links.length && !p.body.length && !p.image) {
        components.push(componentFromLeaf(p, comp));
      } else {
        unresolved.push({
          rows: sortedUnique(p.rows),
          text: p.body.concat(p.image ? [p.image.asset] : []).join(' / ').slice(0, 200),
          why: 'appears before any heading in the brief, so there is no section to attach it to'
        });
      }
    }

    var kept = parsed.leaves.filter(function (leaf) {
      if (leaf.heading && isChrome(leaf.heading, chrome)) {
        unresolved.push({ rows: sortedUnique(leaf.rows), text: leaf.heading, why: 'names page chrome (' + leaf.heading + '), not a content component' });
        return false;
      }
      return true;
    });

    // A bare heading — no body, image or links of its own — immediately
    // before a run (a card group, a step flow, an accordion) is not a
    // sibling component: it is that run's own section title, the one the
    // marker-stripped hierarchy can no longer say so directly. Left alone
    // it would render as its own empty component right next to the real
    // one it was introducing — "FAQs" as a bare, itemless accordion,
    // immediately followed by the actual Q&A group.
    var segments = foldRuns(kept);
    var i = 0;
    while (i < segments.length) {
      var seg = segments[i], next = segments[i + 1];
      var bare = seg.kind === 'single' && !seg.leaves[0].body.length && !seg.leaves[0].image && !seg.leaves[0].links.length && seg.leaves[0].heading;
      if (bare && next && next.kind !== 'single') {
        components.push(componentFromRun(next, comp, seg.leaves[0]));
        i += 2; continue;
      }
      if (seg.kind === 'single') { components.push(componentFromLeaf(seg.leaves[0], comp)); i++; continue; }

      // A bare heading can also land INSIDE a run rather than before it —
      // "Value highlights[1.0]" followed immediately by two real items has
      // no gap between it and the first one for foldRuns to have split on,
      // so it was folded in as the run's own first (bodyless) item. Pull it
      // back out as the run's heading, the same as the before-a-run case,
      // as long as two real items are still left to call a group.
      var leadLeaf = seg.leaves[0];
      var leadBare = !leadLeaf.body.length && !leadLeaf.image && !leadLeaf.links.length && leadLeaf.heading;
      if (leadBare && seg.leaves.length >= 3) {
        components.push(componentFromRun({ kind: seg.kind, leaves: seg.leaves.slice(1) }, comp, leadLeaf));
      } else {
        components.push(componentFromRun(seg, comp));
      }
      i++;
    }

    return { components: components, unresolved: unresolved };
  }

  // ─── BUILDING FROM AN EXISTING PAGE OR MOCKUP ───────────────────────────
  // Compare already resolves a page's own Tridion components: readPage()'s
  // `modules` carry the canonical component type read from the page's own
  // Component Field/Presentation markers when it has them, or from
  // config.compare.tridionComponents's CSS-class map when it does not —
  // the same two-layer reading tridion-component-taxonomy.md documents,
  // already exercised by Compare's own locator. This reuses that reading
  // rather than re-deriving it, and returns the same {page, components,
  // unresolved} shape build() does, so a renderer never has to care which
  // one produced the model it was handed.

  // tcm:Content/custom:Accordion/custom:items[1]/custom:title, once
  // fieldPath() in compare.js has already stripped the tcm:/custom:
  // prefixes, arrives here as "Accordion/items[1]/title". The repeatable
  // segment and its index are the part that matters; everything after it
  // is the leaf field name.
  function parseFieldPath(path) {
    var parts = String(path || '').split('/');
    for (var i = 0; i < parts.length; i++) {
      var m = /^(\w+)\[(\d+)\]$/.exec(parts[i]);
      if (m) return { index: parseInt(m[2], 10), leaf: parts.slice(i + 1).join('/') || parts[i] };
    }
    return { index: null, leaf: parts[parts.length - 1] || null };
  }

  var LEAF_ROLE = {
    question: /question/i,
    answer: /answer/i,
    heading: /heading|title|h1/i,
    subtitle: /subtitle/i,
    body: /\bbody\b|bodytext|description|intro|leadtext/i,
    cta: /actiontext|^cta$|button/i,
    ctaHref: /actionurl|href/i,
    image: /^image$|alttext|caption/i
  };
  function leafRole(leaf) {
    for (var role in LEAF_ROLE) {
      if (LEAF_ROLE.hasOwnProperty(role) && LEAF_ROLE[role].test(String(leaf || ''))) return role;
    }
    return null;
  }

  // A module's own authored fields, split into the ones that repeat (an
  // Accordion's items, a card grid's tiles) and the ones that don't (a
  // Hero's single heading and intro). A repeat is real authored structure —
  // stronger evidence than any shape guess on the brief side, so two or
  // more repeated items are always confidence: 'high', never inferred.
  function fieldsOfModule(mod) {
    var repeated = {}, order = [];
    var plain = { heading: null, subtitle: null, body: [], cta: [], ctaHref: null, image: null };

    (mod.fields || []).forEach(function (f) {
      var parsed = parseFieldPath(f.path);
      var role = leafRole(parsed.leaf);
      if (parsed.index != null) {
        var key = parsed.index;
        if (!repeated[key]) { repeated[key] = {}; order.push(key); }
        if (role) repeated[key][role] = f.value;
        return;
      }
      if (role === 'heading') plain.heading = plain.heading || f.value;
      else if (role === 'subtitle') plain.subtitle = plain.subtitle || f.value;
      else if (role === 'body' && f.value) plain.body.push(f.value);
      else if (role === 'cta' && f.value) plain.cta.push(f.value);
      else if (role === 'ctaHref') plain.ctaHref = f.value;
      else if (role === 'image') plain.image = plain.image || f.value;
    });

    var raw = order.map(function (k) { return repeated[k]; })
      .filter(function (r) { return r.question || r.answer || r.heading || r.body; });
    var isQA = raw.some(function (r) { return r.question || r.answer; });
    var items = raw.map(function (r) {
      return isQA ? { question: r.question || r.heading || null, answer: r.answer || r.body || null }
        : { title: r.heading || r.question || null, body: r.body || r.answer || null };
    });

    return { plain: plain, items: items, isQA: isQA };
  }

  // "FAQ" or "Value highlights" — the same label compare.js's own ledger
  // already shows, with the same #2-style ordinal when a type repeats.
  function pageModuleLabel(mod) {
    return mod.label + (mod.ofType > 1 ? ' #' + mod.ordinal : '');
  }

  function componentFromModule(mod, comp, chrome) {
    var label = pageModuleLabel(mod);
    if (isChrome(mod.label || mod.name, chrome)) {
      return { drop: true, why: 'names page chrome (' + label + '), not a content component' };
    }

    var fields = fieldsOfModule(mod);
    var heading = fields.plain.heading || mod.heading || null;
    var links = fields.plain.cta.length ? [{ label: fields.plain.cta[0], href: fields.plain.ctaHref || null }] : [];
    var image = fields.plain.image ? { asset: fields.plain.image, alt: null } : null;
    var body = fields.plain.body;
    var items = fields.items;
    var hasStructure = items.length || body.length || heading || image || links.length;
    if (!hasStructure && mod.text) body = [mod.text];

    var type, confidence, why;
    var tridionKey = mod.component ? normaliseLabel(mod.component).replace(/\s+/g, '') : null;

    if (tridionKey && TRIDION_TYPE_OF[tridionKey]) {
      // Tier 1/2 — the page already states its own component type, either
      // from an authored marker or from the CSS-class map that stands in
      // for one on a live page with no markers at all.
      type = TRIDION_TYPE_OF[tridionKey]; confidence = 'high';
      why = (mod.fields && mod.fields.length)
        ? 'the page\'s own Component Field markers identify this as ' + mod.component
        : 'the page\'s CSS classes match the configured ' + mod.component + ' pattern';
    } else {
      var named = namedType([mod.label, heading], comp);
      if (named) {
        type = named.type; confidence = 'high';
        why = 'the page names this section ' + (mod.label || heading);
      } else if (items.length >= 2) {
        // Tier 3 — no resolved component type, but the page's own field
        // markers repeat: real authored structure, not a guess.
        type = fields.isQA ? 'accordion' : 'cards'; confidence = 'high';
        why = items.length + ' repeating authored fields read as ' + (fields.isQA ? 'an accordion' : 'a card group');
      } else {
        var shape = shapeOfLeaf({ heading: heading, body: body, image: image, links: links });
        if (shape) { type = shape.type; confidence = shape.confidence; why = shape.why; }
        else { type = 'generic'; confidence = 'low'; why = 'no component signal on this section — review before publishing'; }
      }
    }

    // The outer type can come from the resolved Tridion component name
    // alone (tier 1/2), independent of what the item-level field names
    // happen to be — a real Accordion's own items are just as often
    // authored as "title"/"body" as "question"/"answer". Whichever tier
    // decided `type`, the item shape it renders in must agree with it, not
    // with a leaf-name guess made before `type` was known.
    if (items.length) {
      if (type === 'accordion') {
        items = items.map(function (it) { return { question: it.question || it.title || null, answer: it.answer || it.body || null }; });
      } else if (type === 'cards' || type === 'steps' || type === 'table') {
        items = items.map(function (it) { return { title: it.title || it.question || null, body: it.body || it.answer || null }; });
      }
    }

    return {
      type: type, confidence: confidence, why: why,
      heading: heading, subtitle: fields.plain.subtitle, body: body,
      items: items, image: image, links: links,
      sourceRows: [mod.start],
      sourceModule: { label: label, anchor: mod.id ? '#' + mod.id : null, componentId: mod.componentId || null },
      warnings: []
    };
  }

  // A page's own <a> tags — unlike a brief's curated front-matter Internal
  // Links — include navigation and footer chrome with no way to tell intent
  // from position alone, so they are left out of the shape fallback below
  // rather than risked as a fabricated CTA group. A module with a real
  // MultiCTAModule/cta-list class still produces a proper cta component via
  // componentFromModule above; this is a stated gap for the fallback path
  // only, not a missing feature of the module path.
  function pageAssetLabel(img) {
    if (img.alt) return img.alt;
    var src = String(img.src || '').replace(/[?#].*$/, '');
    var seg = src.split('/').pop();
    try { seg = decodeURIComponent(seg); } catch (e) { /* leave as-is */ }
    return seg || 'image';
  }

  // A brief's headings arrive flat — readBrief strips each one's own [n.m]
  // marker before this module ever sees it, so there is no hierarchy left
  // to group by, only shape (see buildLabelled above). A page's own
  // headings carry their real h1/h2/h3 level, and that is worth using: an
  // h1/h2 always opens its own section; an h3 beneath it is that section's
  // own sub-item, not a sibling section guessed into a run by shape alone.
  function stripSimpleTags(s) {
    return String(s == null ? '' : s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // <details><summary>Question</summary><p>Answer</p></details> is the
  // plain-HTML equivalent of an Accordion, with no script and no Tridion
  // markers needed — Pass B renders an accordion the same way. Reading it
  // back is the other half of that: a page built with it should be
  // recognised as an accordion just as readily as one with real markers.
  var DETAILS_RE = /<details\b[^>]*>([\s\S]*?)<\/details>/gi;
  var SUMMARY_RE = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i;
  function detailsIn(html) {
    var out = [], m;
    DETAILS_RE.lastIndex = 0;
    while ((m = DETAILS_RE.exec(html)) !== null) {
      var s = SUMMARY_RE.exec(m[1]);
      if (!s) continue;
      var question = stripSimpleTags(s[1]);
      var answer = stripSimpleTags(m[1].slice(s.index + s[0].length));
      if (question) out.push({ question: question, answer: answer || null, at: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  function buildFromHeadingStream(html, page, comp, chrome) {
    var headings = (page.headings || []).filter(function (h) { return !h.hidden; });
    var faqs = detailsIn(html);
    // The answer paragraph inside a <details> is already carried on the
    // faq item itself — without this filter it would also arrive as an
    // ordinary paragraph a moment later and get counted twice.
    var paragraphs = (page.paragraphs || []).filter(function (p) {
      return !faqs.some(function (d) { return p.at >= d.at && p.at < d.end; });
    });

    var stream = [];
    headings.forEach(function (h) { stream.push({ kind: 'heading', level: h.level, text: h.text, at: h.at }); });
    paragraphs.forEach(function (p) { stream.push({ kind: 'body', text: p.text, at: p.at }); });
    (page.images || []).forEach(function (im) { stream.push({ kind: 'image', text: pageAssetLabel(im), at: im.at }); });
    faqs.forEach(function (d) { stream.push({ kind: 'faq', question: d.question, answer: d.answer, at: d.at }); });
    stream.sort(function (a, b) { return a.at - b.at; });

    var leaves = [], preamble = null, top = null;
    stream.forEach(function (item) {
      if (item.kind === 'heading') {
        if (item.level === 'h1' || item.level === 'h2' || !top) {
          top = { heading: item.text, body: [], image: null, links: [], items: [], rows: [item.at] };
          leaves.push(top);
        } else {
          top.items.push({ title: item.text, body: null });
          top.rows.push(item.at);
        }
        return;
      }
      if (item.kind === 'faq') {
        if (!top) { top = { heading: null, body: [], image: null, links: [], items: [], rows: [] }; leaves.push(top); }
        top.items.push({ question: item.question, answer: item.answer });
        top.rows.push(item.at);
        return;
      }
      var target = top;
      if (!target) {
        if (!preamble) preamble = { heading: null, body: [], image: null, rows: [] };
        target = preamble;
      }
      target.rows.push(item.at);
      if (item.kind === 'body') {
        // An h3's own paragraph belongs to the item it just opened, not to
        // the section's own body — the last item pushed still owns it as
        // long as no sibling h3 or new section has started since.
        var lastItem = target.items && target.items.length ? target.items[target.items.length - 1] : null;
        if (lastItem && lastItem.title && lastItem.body == null) lastItem.body = item.text;
        else target.body.push(item.text);
      } else if (item.kind === 'image') {
        target.image = { asset: item.text, alt: null };
      }
    });

    var components = [], unresolved = [];

    if (preamble && preamble.rows.length) {
      unresolved.push({
        rows: sortedUnique(preamble.rows),
        text: preamble.body.join(' / ').slice(0, 200),
        why: 'appears before any heading on the page, so there is no section to attach it to'
      });
    }

    leaves.forEach(function (leaf) {
      if (leaf.heading && isChrome(leaf.heading, chrome)) {
        unresolved.push({ rows: sortedUnique(leaf.rows), text: leaf.heading, why: 'names page chrome (' + leaf.heading + '), not a content component' });
        return;
      }

      var named = leaf.heading ? namedType([leaf.heading], comp) : null;
      var type, confidence, why, items = leaf.items, body = leaf.body;

      if (named) {
        type = named.type; confidence = 'high'; why = 'the page names this section ' + leaf.heading;
      } else if (items.length >= 2) {
        var isQA = items.some(function (it) { return it.question; });
        var ordered = !isQA && items.every(function (it) { return isOrdinalHeading(it.title); });
        type = isQA ? 'accordion' : (ordered ? 'steps' : 'cards');
        confidence = 'medium';
        why = items.length + (isQA ? ' question-and-answer pairs read as an accordion' : ' sub-headings read as ' + (ordered ? 'an ordered step flow' : 'a card group'));
      } else if (items.length === 1) {
        // A single sub-heading is just one more paragraph of this section's
        // own content, not a group of one.
        body = body.concat([items[0].title, items[0].body].filter(Boolean).join(': '));
        items = [];
        var shape1 = shapeOfLeaf({ heading: leaf.heading, body: body, image: leaf.image, links: [] });
        type = shape1 ? shape1.type : 'generic';
        confidence = shape1 ? shape1.confidence : 'low';
        why = shape1 ? shape1.why : 'no component signal on this section — review before publishing';
      } else {
        var shape = shapeOfLeaf({ heading: leaf.heading, body: body, image: leaf.image, links: [] });
        if (shape) { type = shape.type; confidence = shape.confidence; why = shape.why; }
        else { type = 'generic'; confidence = 'low'; why = 'no component signal on this section — review before publishing'; }
      }

      components.push({
        type: type, confidence: confidence, why: why,
        heading: leaf.heading, subtitle: null, body: body,
        items: items, image: leaf.image, links: [],
        sourceRows: sortedUnique(leaf.rows)
      });
    });

    return { components: components, unresolved: unresolved };
  }

  // ─── FIELDS-BY-MARKET ORIENTATION (rows = fields, columns = markets) ────
  // filler.rows() already resolves the chosen market's column correctly
  // (brief.js's Brief.marketColumn, not the last-column guess) and carries
  // each row's section label from brief.js's sectionsByRow — the real
  // heading, never lost the way readBrief's labelled branch loses its
  // [n.m] markers. Grouping is therefore by `.section` directly.

  var FIELD_TYPE = {
    heading: /^(headline|title|heading|h1)\b/i,
    subtitle: /^(subheading|sub[- ]?title|intro(duction)?|lead)\b/i,
    body: /^body\b/i,
    cta: /^cta\b/i,
    image: /^(cover image|hero image|image)\b/i
  };
  function fieldRoleOf(label) {
    for (var role in FIELD_TYPE) {
      if (FIELD_TYPE.hasOwnProperty(role) && FIELD_TYPE[role].test(String(label || '').trim())) return role;
    }
    return null;
  }

  function groupBySection(rows) {
    var order = [], bySection = {};
    rows.forEach(function (r) {
      var key = r.section == null ? '\u0000' : r.section;
      if (!bySection[key]) { bySection[key] = { section: r.section, rows: [] }; order.push(key); }
      bySection[key].rows.push(r);
    });
    return order.map(function (k) { return bySection[k]; });
  }

  function componentFromFieldGroup(group, comp, chrome, gaps) {
    if (group.section && isChrome(group.section, chrome)) return null;

    var named = namedType([group.section], comp);
    var heading = null, subtitle = null, body = [], items = [], image = null, links = [], ctas = [];
    var byRole = { heading: [], subtitle: [], body: [], cta: [], image: [] };
    var unroled = [];

    group.rows.forEach(function (r) {
      var role = fieldRoleOf(r.label);
      if (role) byRole[role].push(r); else unroled.push(r);
    });

    if (byRole.heading[0]) heading = byRole.heading[0].localized;
    if (byRole.subtitle[0]) subtitle = byRole.subtitle[0].localized;
    byRole.body.forEach(function (r) { body.push(r.localized); });
    byRole.cta.forEach(function (r) { ctas.push({ label: r.localized, href: null }); });
    if (byRole.image[0]) image = { asset: byRole.image[0].localized, alt: null };

    // Repeats the field vocabulary alone cannot explain: "Card Title 1",
    // "Card Body 1", "Card Title 2", ... Strip a trailing ordinal from each
    // unroled label and group by what is left.
    var byStem = {}, stemOrder = [];
    unroled.forEach(function (r) {
      var stem = normaliseLabel(r.label).replace(/\s*\d+\s*$/, '');
      if (!byStem[stem]) { byStem[stem] = []; stemOrder.push(stem); }
      byStem[stem].push(r);
    });

    var sourceRows = group.rows.map(function (r) { return r.index + 1; });
    var confidence, why, type;

    if (named) {
      type = named.type; confidence = 'high'; why = named.why;
    } else if (unroled.length >= 2 && stemOrder.some(function (s) { return byStem[s].length >= 2; })) {
      var repeated = stemOrder.filter(function (s) { return byStem[s].length >= 2; });
      var looksQA = repeated.some(function (s) { return /question|answer/.test(s); });
      type = looksQA ? 'accordion' : 'cards';
      confidence = 'medium';
      why = repeated.length + ' repeating "' + repeated[0] + '"-style rows read as ' + (looksQA ? 'an accordion' : 'a card group');
      items = unroled.map(function (r) { return looksQA ? { question: r.label, answer: r.localized } : { title: r.label, body: r.localized }; });
    } else if (heading && image && body.length <= 1) {
      type = 'hero'; confidence = 'medium'; why = 'Headline, an image and a short intro read as a hero';
    } else if (heading || subtitle || body.length) {
      type = 'content'; confidence = 'medium'; why = 'Headline/Body rows read as a content block';
    } else if (ctas.length) {
      type = 'cta'; confidence = 'medium'; why = 'CTA rows with no other content read as a CTA group';
    } else if (image) {
      type = 'image'; confidence = 'medium'; why = 'only an image row, no heading or body';
    } else {
      type = 'generic'; confidence = 'low'; why = 'no recognised field labels in this section — review before publishing';
      body = unroled.map(function (r) { return r.label + ': ' + r.localized; });
    }

    var warnings = [];
    group.rows.forEach(function (r) {
      if (r.untranslated) warnings.push({ kind: 'untranslated', row: r.index + 1, note: r.label + ' reads identical to the English master' });
    });
    (gaps || []).forEach(function (g) {
      if (g.section === group.section) warnings.push({ kind: 'missing-in-market', row: g.row, note: g.label + ' has no text for this market (English master present)' });
    });

    return {
      type: type, confidence: confidence, why: why,
      heading: heading, subtitle: subtitle, body: body,
      items: items, image: image, links: links.concat(ctas),
      sourceRows: sortedUnique(sourceRows), warnings: warnings
    };
  }

  function marketGaps(text, wt, market) {
    if (!market) return [];
    var model = Brief.parse(text, wt);
    if (model.masterColumn === -1) return [];
    var col = Brief.marketColumn(model, market);
    if (col === -1) return [];
    var gaps = [];
    model.rows.forEach(function (r) {
      if (model.headerRow === r.row) return;
      var label = (r.cells[0] || '').trim();
      if (!label) return;
      var masterVal = (r.cells[model.masterColumn] || '').trim();
      var localVal = (r.cells[col] || '').trim();
      if (masterVal && !localVal) gaps.push({ row: r.row, section: r.section, label: label });
    });
    return gaps;
  }

  function buildFieldsByMarket(text, wt, market, comp, chrome) {
    var filler = Filler.create(wt);
    var rows = filler.rows(text, { market: market });
    var groups = groupBySection(rows);
    var gaps = marketGaps(text, wt, market);
    var components = [], unresolved = [];

    // A brief with no market header row at all (a plain label/English/
    // localized sheet, no "Field / English / Slovenia" header) makes
    // filler.rows() fall back to its no-config shape, which carries no
    // `.section` on any row. That is not several orphaned rows — it is one
    // brief with a single implicit section, and it is read as one group
    // rather than dumped whole into `unresolved`.
    var allUnsectioned = groups.length === 1 && groups[0].section == null;

    groups.forEach(function (group) {
      if (group.section == null && !allUnsectioned) {
        unresolved.push({
          rows: sortedUnique(group.rows.map(function (r) { return r.index + 1; })),
          text: group.rows.map(function (r) { return r.label + ': ' + r.localized; }).join(' / ').slice(0, 200),
          why: 'not grouped under any section heading in the brief'
        });
        return;
      }
      var c = componentFromFieldGroup(group, comp, chrome, gaps);
      if (c) components.push(c);
      else unresolved.push({
        rows: sortedUnique(group.rows.map(function (r) { return r.index + 1; })),
        text: group.section,
        why: 'names page chrome (' + group.section + '), not a content component'
      });
    });

    return { components: components, unresolved: unresolved, market: market || (rows[0] && rows[0].market) || null };
  }

  // ─── MARKETS-BY-FIELD ORIENTATION (rows = markets, columns = fields) ────
  // readBrief already extracts this shape correctly (readMarketsByField);
  // its `want().section` carries the MARKET NAME here, not a heading —
  // filtering to the chosen market's own entries is what selects its row.

  function buildMarketsByField(expect, market) {
    var heading = null, body = [];
    expect.sections.forEach(function (w) {
      if (w.section === market) heading = w.text;
    });
    expect.body.forEach(function (w) {
      if (w.section === market) body.push(w.text);
    });

    if (!heading && !body.length) {
      return { components: [], unresolved: [], market: market };
    }

    var rows = expect.sections.concat(expect.body).filter(function (w) { return w.section === market; })
      .map(function (w) { return w.row; });

    var shape = shapeOfLeaf({ heading: heading, body: body, image: null, links: [] }) ||
      { type: 'generic', confidence: 'low', why: 'no component signal in this market\'s row — review before publishing' };

    return {
      components: [{
        type: shape.type, confidence: shape.confidence, why: shape.why,
        heading: heading, subtitle: null, body: body, items: [], image: null, links: [],
        sourceRows: sortedUnique(rows), warnings: []
      }],
      unresolved: [], market: market
    };
  }

  // ─── TEMPLATE ────────────────────────────────────────────────────────────

  function inferTemplate(components, templates) {
    if (!components.length) return { type: 'unknown', confidence: 'low', why: 'no components to infer a template from' };
    var types = {};
    components.forEach(function (c) { types[c.type] = (types[c.type] || 0) + 1; });
    var best = null;
    Object.keys(templates).forEach(function (name) {
      var need = templates[name];
      if (need.every(function (t) { return types[t]; })) {
        if (!best || need.length > best.need.length) best = { name: name, need: need };
      }
    });
    if (best) {
      return { type: best.name, confidence: components.length > best.need.length ? 'medium' : 'low',
        why: 'components match the ' + best.name + ' template pattern (' + best.need.join(' + ') + ')' };
    }
    return { type: 'unknown', confidence: 'low', why: 'component mix does not match a known template pattern' };
  }

  // ─── PUBLIC ──────────────────────────────────────────────────────────────

  function create(config) {
    var wt = (config && config['work-types']) || {};
    var mockCfg = (config && config['mock-components']) || {};
    var comp = mockCfg.components || DEFAULT_COMPONENTS;
    var chrome = mockCfg.chrome || DEFAULT_CHROME;
    var templates = mockCfg.templates || DEFAULT_TEMPLATES;
    var comparer = Compare.create({ 'work-types': wt });

    function build(briefText, options) {
      options = options || {};
      var text = String(briefText == null ? '' : briefText);
      var rows = Brief.splitRows(text);
      var shape = Brief.detectOrientation(rows, wt);

      var orientation, workTypeId;
      if (shape.orientation === 'markets-by-field') { orientation = 'markets-by-field'; workTypeId = 'localization'; }
      else if (shape.orientation === 'fields-by-market') { orientation = 'fields-by-market'; workTypeId = 'localization'; }
      else { orientation = 'labelled'; workTypeId = options.workTypeId || 'new-page'; }

      var expect = comparer.readBrief(text, workTypeId, wt);
      // A localization brief with too little tabular structure falls back
      // to prose inside readBrief itself — record what actually happened,
      // not what detectOrientation guessed going in.
      if (expect.mode === 'prose') orientation = 'prose';

      var market = options.market || null;
      var result;

      if (orientation === 'fields-by-market') {
        result = buildFieldsByMarket(text, wt, market, comp, chrome);
        market = result.market;
      } else if (orientation === 'markets-by-field') {
        if (!market) {
          var model = Brief.parse(text, wt);
          market = model.targetMarket || (model.markets[0] && model.markets[0].name) || null;
        }
        result = buildMarketsByField(expect, market);
      } else {
        // labelled and prose both come out of readBrief as flat
        // sections/body/images/links; the same grouping serves both.
        result = buildLabelled(text, expect, comp, chrome);
      }

      var page = {
        title: expect.metadata.title || null,
        description: expect.metadata.description || null,
        path: expect.metadata.canonical || null,
        keywords: expect.metadata.keywords || null,
        template: inferTemplate(result.components, templates)
      };

      var components = result.components.map(function (c, i) {
        return {
          id: 'c' + (c.sourceRows[0] || (i + 1)),
          type: c.type, confidence: c.confidence, why: c.why,
          heading: c.heading || null, subtitle: c.subtitle || null,
          body: c.body || [], items: c.items || [],
          image: c.image || null, links: c.links || [],
          sourceRows: c.sourceRows, sourceModule: null, warnings: c.warnings || []
        };
      });

      return {
        market: market,
        orientation: orientation,
        origin: 'brief',
        page: page,
        components: components,
        unresolved: result.unresolved
      };
    }

    function buildFromPage(html) {
      var page = comparer.readPage(String(html == null ? '' : html));
      var components, unresolved;

      if (page.modules && page.modules.length) {
        components = []; unresolved = [];
        page.modules.forEach(function (mod) {
          var c = componentFromModule(mod, comp, chrome);
          if (c.drop) { unresolved.push({ rows: [mod.start], text: pageModuleLabel(mod), why: c.why }); return; }
          components.push(c);
        });
      } else {
        // No <section> the tool recognises as a module at all — group by
        // the page's own real h1/h2/h3 heading hierarchy instead, which a
        // brief never has to offer.
        var region = comparer.mainRegion(String(html == null ? '' : html));
        var result = buildFromHeadingStream(region.html, page, comp, chrome);
        components = result.components; unresolved = result.unresolved;
      }

      var pageOut = {
        title: page.metaTitle || page.pageName || null,
        description: page.description || null,
        path: page.canonical || null,
        keywords: page.keywords || null,
        template: inferTemplate(components, templates)
      };

      var out = components.map(function (c, i) {
        return {
          id: 'c' + (c.sourceRows && c.sourceRows[0] != null ? c.sourceRows[0] : (i + 1)),
          type: c.type, confidence: c.confidence, why: c.why,
          heading: c.heading || null, subtitle: c.subtitle || null,
          body: c.body || [], items: c.items || [],
          image: c.image || null, links: c.links || [],
          sourceRows: c.sourceRows || [], sourceModule: c.sourceModule || null,
          warnings: c.warnings || []
        };
      });

      return {
        market: null,
        orientation: 'page',
        origin: 'page',
        page: pageOut,
        components: out,
        unresolved: unresolved
      };
    }

    return { build: build, buildFromPage: buildFromPage };
  }

  return { create: create };
}));

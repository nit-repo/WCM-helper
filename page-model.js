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
    cards: { signals: ['cards', 'card group', 'teaser', 'highlights', 'benefits', 'campaignhighlight', 'valuehighlight', 'productteaser'], fields: ['heading', 'items'], repeatable: true },
    steps: { signals: ['steps', 'process', 'how it works', 'come funziona', 'cómo funciona', 'como funciona'], fields: ['heading', 'items'], repeatable: true, ordered: true },
    table: { signals: ['specification', 'specifications', 'table', 'specs', 'productspecification', 'productspecificationcarousel', 'productspecificationitem'], fields: ['heading', 'items'], repeatable: true },
    accordion: { signals: ['faq', 'faqs', 'question', 'answer', 'accordion', 'domande frequenti', 'preguntas frecuentes', 'perguntas frequentes'], fields: ['heading', 'items'], repeatable: true },
    cta: { signals: ['cta', 'button', 'internal links', 'call to action', 'multictamodule', 'related links'], fields: ['items'], repeatable: true },
    image: { signals: ['image', 'aem assets', 'cover image', 'hero image', 'asset'], fields: ['image', 'alt', 'caption'] }
  };
  var DEFAULT_CHROME = ['navigation', 'nav', 'header', 'footer', 'breadcrumb', 'breadcrumbs', 'cookie', 'cookiepopup', 'form', 'lead form'];
  var DEFAULT_TEMPLATES = { landing: ['hero', 'cards'], article: ['content'], product: ['table'], faq: ['accordion'] };

  // config.compare.tridionComponents values (HeroBanner, Accordion, ...) are
  // PascalCase component NAMES, not our lowercase type vocabulary. This is
  // the one place the two vocabularies meet.
  var TRIDION_TYPE_OF = {
    herobanner: 'hero', accordion: 'accordion', contentblocks: 'content',
    productspecificationcarousel: 'table', productspecificationitem: 'table',
    productteaser: 'cards', campaignhighlight: 'cards', contentriver: 'content',
    multictamodule: 'cta', valuehighlight: 'cards'
  };

  var CONF_RANK = { high: 3, medium: 2, low: 1 };
  function weaker(a, b) { return CONF_RANK[a] <= CONF_RANK[b] ? a : b; }

  function normaliseLabel(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function signalHit(text, signals) {
    var n = normaliseLabel(text);
    if (!n) return false;
    return signals.some(function (s) { return n.indexOf(normaliseLabel(s)) !== -1; });
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
  function namedType(candidates, comp) {
    for (var i = 0; i < candidates.length; i++) {
      var text = candidates[i];
      if (!text) continue;
      var tridionKey = normaliseLabel(text).replace(/\s+/g, '');
      if (TRIDION_TYPE_OF[tridionKey]) {
        return { type: TRIDION_TYPE_OF[tridionKey], why: 'the brief names this section ' + text };
      }
      var type = signalType(text, comp);
      if (type) return { type: type, why: 'the brief names this section ' + text };
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

  function labelledStream(expect) {
    var stream = [];
    expect.sections.forEach(function (w) { stream.push({ kind: 'heading', text: w.text, row: w.row }); });
    expect.body.forEach(function (w) { stream.push({ kind: 'body', text: w.text, row: w.row }); });
    expect.images.forEach(function (w) { stream.push({ kind: 'image', text: w.text, row: w.row }); });
    expect.links.forEach(function (w) { stream.push({ kind: 'link', text: w.text, href: w.href, row: w.row }); });
    stream.sort(function (a, b) { return a.row - b.row; });
    return stream;
  }

  function labelledLeaves(expect) {
    var stream = labelledStream(expect);
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
      else if (item.kind === 'image') current.image = { asset: item.text, alt: null };
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

  function componentFromRun(run, comp) {
    var leaves = run.leaves;
    var allRows = [];
    leaves.forEach(function (l) { allRows = allRows.concat(l.rows); });

    if (run.kind === 'accordion-run') {
      return {
        type: 'accordion', confidence: 'medium',
        why: leaves.length + ' consecutive question-shaped headings read as an accordion',
        heading: null, subtitle: null, body: [],
        items: leaves.map(function (l) { return { question: l.heading, answer: l.body[0] || null }; }),
        image: null, links: [], sourceRows: sortedUnique(allRows)
      };
    }

    var ordered = leaves.every(function (l) { return isOrdinalHeading(l.heading); });
    return {
      type: ordered ? 'steps' : 'cards', confidence: 'medium',
      why: leaves.length + ' consecutive title/body groups read as ' + (ordered ? 'an ordered step flow' : 'a card group'),
      heading: null, subtitle: null, body: [],
      items: leaves.map(function (l) { return { title: l.heading, body: l.body[0] || null }; }),
      image: null, links: [], sourceRows: sortedUnique(allRows)
    };
  }

  function componentFromLeaf(leaf, comp) {
    var candidates = [leaf.heading].concat(leaf.links.map(function (l) { return l.label; }));
    var named = namedType(candidates, comp);
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

  function buildLabelled(expect, comp, chrome) {
    var parsed = labelledLeaves(expect);
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

    foldRuns(kept).forEach(function (run) {
      if (run.kind === 'single') components.push(componentFromLeaf(run.leaves[0], comp));
      else components.push(componentFromRun(run, comp));
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
        result = buildLabelled(expect, comp, chrome);
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
          sourceRows: c.sourceRows, warnings: c.warnings || []
        };
      });

      return {
        market: market,
        orientation: orientation,
        page: page,
        components: components,
        unresolved: result.unresolved
      };
    }

    return { build: build };
  }

  return { create: create };
}));

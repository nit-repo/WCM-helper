/* filler.js — find the localized text for the English master in front of you.
 *
 * An author localizing in Tridion opens a component, sees the English master
 * in the field, and has to find that row in a brief that may run to a hundred
 * rows. This does the finding.
 *
 * It does not do the pasting. This is a static page on a different origin
 * from the Tridion CME — it can neither read a component field nor write to
 * one. The author still presses Ctrl+V.
 *
 * The part that matters beyond lookup: master fields carry rich text. Pasting
 * a plain localized string over English that held a link drops the link
 * silently. So markup is carried across where it can be placed with
 * certainty, and listed explicitly where it cannot. Guessing at translation
 * alignment is the one thing this must never do.
 *
 * Runs in the browser (window.BriefFiller) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./brief.js'));
  else root.BriefFiller = factory(root.BriefShared);
}(typeof self !== 'undefined' ? self : this, function (Brief) {
  'use strict';

  // Deliberately a copy of the one in compare.js rather than a shared import:
  // sharing would put a load-order dependency between two modules that are
  // otherwise independent, which is a worse trade than eight duplicated lines.
  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
      .replace(/&ldquo;|&rdquo;/gi, '"')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); })
      .replace(/&amp;/gi, '&');
  }

  function normalise(s) {
    return decodeEntities(s)
      .replace(/[‘’‛]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Same rule as compare.js's stripTags, and the same defect it fixes: inline
  // tags carry no whitespace of their own, so replacing every tag with a
  // space put a space in an English master that a browser never renders,
  // which failed an exact match against the brief and fell through to the
  // fuzzy path. Deliberately a copy, not a shared import — see the note atop
  // this file on why these two stay duplicated.
  var INLINE_TAG_RE = /^(a|span|strong|b|em|i|u|sup|sub|small|code|mark|abbr|cite|q|s|del|ins|label|font)$/i;

  function stripTags(s) {
    var out = String(s)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, function (m, tag) {
        return INLINE_TAG_RE.test(tag) ? '' : ' ';
      });
    return normalise(out);
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ─── ROWS ────────────────────────────────────────────────────────────────
  // Three or more cells: label, English master, localized. Exactly two: some
  // briefs arrive local-only, so there is no English to match against and the
  // row is still worth listing.
  //
  // A brief naming several markets — English, Spain, Italy, Portugal — has no
  // "last column", only a target. Taking the last one anyway is how this used
  // to hand back Portuguese for a Spain job: confidently wrong, every time.
  // brief.js finds the market columns; marketsIn() below is what a caller
  // uses to ask what markets exist before choosing one, so a target is always
  // named rather than guessed silently.

  function marketsIn(briefText, config) {
    if (!config) return { markets: [], targetMarket: null };
    var model = Brief.parse(briefText, config);
    return { markets: model.markets, targetMarket: model.targetMarket };
  }

  function rowsFromMarket(briefText, config, chosenMarket) {
    var model = Brief.parse(briefText, config);
    var market = chosenMarket || model.targetMarket || (model.markets[0] && model.markets[0].name);
    var col = Brief.marketColumn(model, market);
    var out = [];

    model.rows.forEach(function (r) {
      // The header row names the columns — it is metadata about the table,
      // not a translatable row, and showing it in the worklist is noise.
      if (model.headerRow === r.row) return;
      var cells = r.cells;
      var label = (cells[0] || '').trim();
      var localized = col !== -1 ? (cells[col] || '').trim() : '';
      if (!label || !localized) return;

      var english = model.masterColumn !== -1 ? (cells[model.masterColumn] || '').trim() || null : null;
      out.push({
        index: r.row - 1,
        label: label,
        english: english,
        localized: localized,
        section: r.section,
        market: market,
        untranslated: english !== null && normalise(english) === normalise(localized)
      });
    });
    return out;
  }

  function rows(briefText, options) {
    options = options || {};
    var config = options.config;

    if (config) {
      var markets = marketsIn(briefText, config).markets;
      if (markets.length) return rowsFromMarket(briefText, config, options.market);
    }

    // Quote-aware even with no market structure: a brief with a quoted
    // multi-line cell used to shred here exactly as it did in compare.js
    // before that was fixed, silently pairing the wrong English with the
    // wrong localized text.
    var out = [];
    Brief.splitRows(briefText).forEach(function (cells, i) {
      if (cells.length < 2) return;
      var label = (cells[0] || '').trim();
      var localized = (cells[cells.length - 1] || '').trim();
      if (!label || !localized) return;

      var english = cells.length >= 3 ? (cells[cells.length - 2] || '').trim() : null;
      // A row whose two halves are identical carries no translation — a
      // product name repeated across both columns, typically.
      out.push({
        index: i,
        label: label,
        english: english || null,
        localized: localized,
        untranslated: english !== null && normalise(english) === normalise(localized)
      });
    });
    return out;
  }

  // ─── LOOKUP ──────────────────────────────────────────────────────────────

  function tokens(s) {
    return normalise(s).toLowerCase().split(/[^a-z0-9À-ɏ]+/).filter(function (t) { return t.length > 2; });
  }

  function overlap(a, b) {
    var at = tokens(a), bt = tokens(b);
    if (!at.length || !bt.length) return 0;
    var seen = {}, hits = 0;
    bt.forEach(function (t) { seen[t] = true; });
    at.forEach(function (t) { if (seen[t]) hits++; });
    return hits / Math.max(at.length, bt.length);
  }

  function find(rowList, englishText) {
    var needle = stripTags(englishText);
    if (!needle) return { match: null, how: 'empty', candidates: [] };

    var searchable = rowList.filter(function (r) { return r.english; });
    if (!searchable.length) {
      return { match: null, how: 'no-english-column', candidates: [] };
    }

    // More than one row can carry identical English master text — the same
    // CTA label ("Learn more") reused across several components is common.
    // Picking [0] used to hand back confidence:1 on a coin flip; the fuzzy
    // path below already does the right thing by surfacing every candidate,
    // so an exact match with more than one hit now does the same instead of
    // being the one place in this file that guesses silently.
    var exactMatches = searchable.filter(function (r) { return normalise(r.english) === needle; });
    if (exactMatches.length === 1) return { match: exactMatches[0], how: 'exact', confidence: 1, candidates: [] };
    if (exactMatches.length > 1) {
      return {
        match: null,
        how: 'ambiguous',
        confidence: 1,
        candidates: exactMatches.map(function (r) { return { row: r, score: 1 }; })
      };
    }

    // A Tridion field often holds a little more or less than the brief cell.
    var contained = searchable.filter(function (r) {
      var e = normalise(r.english);
      return e.length > 8 && (e.indexOf(needle) !== -1 || needle.indexOf(e) !== -1);
    }).sort(function (a, b) { return normalise(b.english).length - normalise(a.english).length; })[0];
    if (contained) return { match: contained, how: 'contained', confidence: 0.9, candidates: [] };

    var scored = searchable.map(function (r) { return { row: r, score: overlap(r.english, needle) }; })
      .filter(function (s) { return s.score >= 0.4; })
      .sort(function (a, b) { return b.score - a.score; });

    if (!scored.length) return { match: null, how: 'none', candidates: [] };

    // Offered as the closest thing, with the score shown — not as a certainty.
    return {
      match: scored[0].row,
      how: 'closest',
      confidence: scored[0].score,
      candidates: scored.slice(1, 4).map(function (s) { return { row: s.row, score: s.score }; })
    };
  }

  // ─── MARKUP ──────────────────────────────────────────────────────────────
  // Take the formatting off the English master and put it back on the
  // localized text — but only where the text it wrapped is recognisably the
  // same on both sides, which is what happens with product and brand names.

  var INLINE_RE = /<(a|strong|b|em|i)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

  function readMarkup(html) {
    var found = [], m;
    INLINE_RE.lastIndex = 0;
    while ((m = INLINE_RE.exec(String(html || ''))) !== null) {
      var tag = m[1].toLowerCase();
      var inner = stripTags(m[3]);
      if (!inner) continue;
      var hrefM = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[2] || '');
      found.push({
        tag: tag === 'b' ? 'strong' : tag === 'i' ? 'em' : tag,
        href: hrefM ? decodeEntities(hrefM[1] !== undefined ? hrefM[1] : hrefM[2] !== undefined ? hrefM[2] : hrefM[3]) : null,
        text: inner
      });
    }
    return found;
  }

  function carryMarkup(englishHtml, localizedText) {
    var marks = readMarkup(englishHtml);
    var plain = String(localizedText == null ? '' : localizedText);

    if (!marks.length) {
      return { html: escapeHtml(plain), text: plain, restored: [], unplaced: [], hadMarkup: false };
    }

    var restored = [], unplaced = [];
    // Build the output as escaped segments so a localized string containing
    // < or & cannot inject markup of its own.
    var pieces = [{ text: plain, wrapped: false }];

    marks.forEach(function (mark) {
      var placed = false;
      for (var i = 0; i < pieces.length && !placed; i++) {
        if (pieces[i].wrapped) continue;
        var at = pieces[i].text.indexOf(mark.text);
        if (at === -1) continue;

        var before = pieces[i].text.slice(0, at);
        var hit = pieces[i].text.slice(at, at + mark.text.length);
        var after = pieces[i].text.slice(at + mark.text.length);
        var replacement = [];
        if (before) replacement.push({ text: before, wrapped: false });
        replacement.push({ text: hit, wrapped: true, mark: mark });
        if (after) replacement.push({ text: after, wrapped: false });

        pieces.splice.apply(pieces, [i, 1].concat(replacement));
        restored.push(mark);
        placed = true;
      }
      if (!placed) unplaced.push(mark);
    });

    var html = pieces.map(function (p) {
      var body = escapeHtml(p.text);
      if (!p.wrapped) return body;
      if (p.mark.tag === 'a') return '<a href="' + escapeHtml(p.mark.href || '') + '">' + body + '</a>';
      return '<' + p.mark.tag + '>' + body + '</' + p.mark.tag + '>';
    }).join('');

    return { html: html, text: plain, restored: restored, unplaced: unplaced, hadMarkup: true };
  }

  // ─── PUBLIC ──────────────────────────────────────────────────────────────

  // config is optional and, when given, is the work-types.json object (the
  // same shape passed to BriefCompare.create) — it is what lets rows() and
  // fill() resolve a brief's target market instead of guessing at a column.

  function create(config) {
    function boundRows(briefText, options) {
      options = options || {};
      var merged = { market: options.market, config: options.config !== undefined ? options.config : config };
      return rows(briefText, merged);
    }

    // What the UI needs before it can offer a market override: every market
    // the brief declares, and which one the front matter already names.
    function marketsFor(briefText) {
      return marketsIn(briefText, config);
    }

    function fill(briefText, englishText, options) {
      options = options || {};
      var rowList = boundRows(briefText, options);
      var result = find(rowList, englishText);
      var carried = result.match ? carryMarkup(englishText, result.match.localized) : null;

      return {
        generatedAt: new Date().toISOString(),
        rowCount: rowList.length,
        market: options.market || (rowList[0] && rowList[0].market) || null,
        match: result.match,
        how: result.how,
        confidence: result.confidence || 0,
        candidates: result.candidates,
        carried: carried
      };
    }

    return {
      fill: fill,
      rows: boundRows,
      marketsIn: marketsFor,
      find: find,
      carryMarkup: carryMarkup,
      readMarkup: readMarkup,
      normalise: normalise
    };
  }

  return { create: create };
}));

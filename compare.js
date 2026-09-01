/* compare.js — brief versus built page.
 *
 * Takes the brief and the HTML of the page that got built from it, and
 * reports where they differ across five categories: metadata, body text,
 * images, links and structure.
 *
 * Extraction is regex over the markup rather than a DOM parse, because the
 * same code has to run in the browser and under node in the tests, and
 * DOMParser does not exist in node. That handles well-formed markup and can
 * be fooled by exotic cases — a deviation it cannot see is worse than one it
 * invents, so where it is unsure it reports rather than stays quiet.
 *
 * Comparison is verbatim after normalising: whitespace collapsed, curly
 * quotes straightened, nbsp folded. Anything left over is a real difference
 * for a human to judge. Output always carries the original text, never the
 * normalised form.
 *
 * Runs in the browser (window.BriefCompare) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefCompare = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── NORMALISING ─────────────────────────────────────────────────────────
  // Two strings mean the same thing if they differ only by the punctuation a
  // CMS rewrites on its way to the page. Case is NOT folded — a changed
  // capital in a heading is a real deviation.

  function decodeEntities(s) {
    return String(s)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/gi, "'")
      .replace(/&ldquo;|&rdquo;/gi, '"')
      .replace(/&mdash;/gi, '—')
      .replace(/&ndash;/gi, '–')
      .replace(/&trade;/gi, '™')
      .replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); });
  }

  function normalise(s) {
    return decodeEntities(s)
      .replace(/[\u2018\u2019\u201B]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function same(a, b) { return normalise(a) === normalise(b); }

  // ─── ROWS AND CELLS ──────────────────────────────────────────────────────
  // Briefs arrive as Excel and CSV exports, and a cell holding more than one
  // paragraph is wrapped in quotes and keeps its newlines. Splitting the text
  // on \n before honouring those quotes tears one row into several: the row
  // stops looking tabular, so the whole brief falls to the prose fallback, and
  // the fragments arrive carrying an orphan quote that no page will match.
  // That one mistake produced 74 phantom findings on a real Portugal brief.

  function splitRows(text) {
    var rows = [], cells = [], cell = '', quoted = false;
    var s = String(text == null ? '' : text).replace(/\r\n?/g, '\n');

    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (quoted) {
        // "" inside a quoted cell is an escaped quote, not the end of it.
        if (ch !== '"') { cell += ch; continue; }
        if (s.charAt(i + 1) === '"') { cell += '"'; i++; continue; }
        quoted = false;
        continue;
      }
      // A quote only opens a cell at its start; mid-cell it is punctuation.
      if (ch === '"' && cell === '') { quoted = true; continue; }
      if (ch === '\t') { cells.push(cell); cell = ''; continue; }
      if (ch === '\n') { cells.push(cell); rows.push(cells); cells = []; cell = ''; continue; }
      cell += ch;
    }
    cells.push(cell);
    rows.push(cells);

    return rows.filter(function (r) {
      return r.some(function (c) { return c.trim() !== ''; });
    });
  }

  // ─── URL IDENTITY ────────────────────────────────────────────────────────
  // The same page has different URLs in every environment: preview vs www,
  // .aspx on Tridion vs extensionless on AEM. Comparing those raw makes every
  // link a false deviation, which buries the ones that matter. Reduce both
  // sides to a path and compare that; a difference that lives only in the
  // host or the extension is an environment difference, not a defect.

  function pathOf(url) {
    var s = String(url == null ? '' : url).trim();
    s = s.replace(/#.*$/, '');
    s = s.replace(/^https?:\/\//i, '');
    var slash = s.indexOf('/');
    var head = slash === -1 ? s : s.slice(0, slash);
    if (/^[^/]*\./.test(head)) s = slash === -1 ? '/' : s.slice(slash);
    s = s.replace(/\.(aspx|html?|jsp)(?=$|\?)/i, '');
    // Tridion serves a directory page as index.aspx where AEM serves it
    // extensionless — the same page, either side of the migration.
    s = s.replace(/\/(index|default)(?=$|\?)/i, '');
    s = s.replace(/\/+$/, '');
    return (s || '/').toLowerCase();
  }

  function samePath(a, b) { return pathOf(a) === pathOf(b); }

  // ─── ASSET IDENTITY ──────────────────────────────────────────────────────
  // A brief names an asset ("KONE_Feat_Handrail_B_Landscape-004"); the page
  // carries a DAM or Scene7 embed URL that may be cropped, renamed with a
  // variant suffix, or hung with preset parameters. Match on the identity
  // underneath rather than the string.

  function assetIdentity(value, variantPattern) {
    var v = String(value == null ? '' : value).trim();
    v = v.replace(/[?#].*$/, '');
    v = v.split('/').pop();
    v = v.replace(/\.(jpe?g|png|webp|gif|svg|avif)$/i, '');
    v = v.replace(new RegExp(variantPattern || '[-_](\\d{1,2}|crop|thumb|small|large|mobile|desktop)$', 'i'), '');
    return v.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // ─── HTML EXTRACTION ─────────────────────────────────────────────────────

  var CHROME_RE = /<(nav|header|footer|script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

  // The leading (?:^|[\s]) matters: without it, a search for "src" happily
  // matches inside "data-src", which is how a lazy-loading placeholder and the
  // real image can swap places depending on attribute order.
  function attr(tag, name) {
    var m = new RegExp('[\\s]' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
    if (!m) return '';
    return decodeEntities(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
  }

  // A lazy-loaded image carries the placeholder in src and the real asset in
  // data-src. Prefer whichever actually names an asset.
  var PLACEHOLDER_RE = /ajax-loader|\bloader\b|\bblank\.|\bspacer\.|data:image\/gif|1x1\./i;

  function imageSrc(tag) {
    var src = attr(tag, 'src');
    var lazy = attr(tag, 'data-src') || attr(tag, 'data-original') || attr(tag, 'data-lazy-src');
    if (!src) return lazy;
    if (lazy && PLACEHOLDER_RE.test(src)) return lazy;
    return src;
  }

  function safeAnchor(attrs, label, cfg) {
    if (/\b(?:aria-expanded|aria-controls|data-toggle|data-bs-toggle|role\s*=\s*["']?(?:button|tab))/i.test(attrs)) return true;
    var patterns = (cfg && cfg.safeAnchorLabels) ||
      ['back to top', 'top of page', 'skip to', 'voltar ao topo', 'scroll to top'];
    var text = normalise(label).toLowerCase();
    if (!text) return false;
    return patterns.some(function (p) { return text.indexOf(String(p).toLowerCase()) !== -1; });
  }

  // The visible text in document order, one entry per run between tags. Lets
  // a check reason about what a reader sees without depending on which
  // elements a template happened to wrap it in.

  function textNodes(html) {
    var out = [], re = /<[^>]*>/g, last = 0, m;
    while ((m = re.exec(html)) !== null) {
      if (m.index > last) out.push(html.slice(last, m.index));
      last = re.lastIndex;
    }
    if (last < html.length) out.push(html.slice(last));
    return out;
  }

  function stripTags(html) {
    return normalise(String(html).replace(/<[^>]*>/g, ' '));
  }

  // Nav, header and footer would otherwise fill the body-text report with
  // menu labels and cookie copy. Prefer an explicit main region; fall back to
  // the body with the chrome cut out.
  function mainRegion(html, selectors) {
    var i, m;
    for (i = 0; i < selectors.length; i++) {
      var sel = selectors[i];
      if (sel === 'main') {
        m = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html);
      } else if (sel.charAt(0) === '.') {
        m = new RegExp('<([a-z]+)[^>]*class\\s*=\\s*["\'][^"\']*\\b' +
          sel.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
          '\\b[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/\\1>', 'i').exec(html);
        if (m) m = [m[0], m[2]];
      } else if (sel.charAt(0) === '[') {
        m = /<[a-z]+\b[^>]*role\s*=\s*["']main["'][^>]*>([\s\S]*?)<\/[a-z]+>/i.exec(html);
      }
      if (m && m[1] && stripTags(m[1]).length > 0) {
        return { html: m[1], via: sel };
      }
    }
    var body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html);
    return { html: String(body ? body[1] : html).replace(CHROME_RE, ' '), via: 'body minus nav, header and footer' };
  }

  function readPage(html, cfg) {
    html = String(html == null ? '' : html);
    var head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
    var headHtml = head ? head[1] : html;
    var region = mainRegion(html, (cfg && cfg.contentSelectors) || ['main', '[role=main]']);

    function meta(name) {
      var re = new RegExp('<meta\\b[^>]*name\\s*=\\s*["\']' + name + '["\'][^>]*>', 'i');
      var tag = re.exec(headHtml);
      if (!tag) {
        re = new RegExp('<meta\\b[^>]*content\\s*=\\s*["\'][^"\']*["\'][^>]*name\\s*=\\s*["\']' + name + '["\'][^>]*>', 'i');
        tag = re.exec(headHtml);
      }
      return tag ? attr(tag[0], 'content') : null;
    }

    // Open Graph uses property=, not name=, so meta() above cannot see it. That
    // is why og:title was never read: the brief's meta title was being compared
    // against the window title instead, which is a different field entirely.
    function og(name) {
      var re = new RegExp('<meta\\b[^>]*property\\s*=\\s*["\']og:' + name + '["\'][^>]*>', 'i');
      var tag = re.exec(headHtml);
      if (!tag) {
        re = new RegExp('<meta\\b[^>]*content\\s*=\\s*["\'][^"\']*["\'][^>]*property\\s*=\\s*["\']og:' + name + '["\'][^>]*>', 'i');
        tag = re.exec(headHtml);
      }
      return tag ? attr(tag[0], 'content') : null;
    }

    var title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(headHtml);
    var canonicalTag = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(headHtml);
    var canonicalHref = canonicalTag ? attr(canonicalTag[0], 'href') : null;

    // The page path is the last segment of the URL — the page's name in the
    // CMS tree, which is a different thing from either title.
    var segments = pathOf(canonicalHref || '').split('/').filter(function (s) { return s !== ''; });

    var headings = [], hm, hre = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    while ((hm = hre.exec(region.html)) !== null) {
      headings.push({ level: hm[1].toLowerCase(), text: stripTags(hm[2]) });
    }

    var images = [], im, ire = /<img\b[^>]*>/gi;
    while ((im = ire.exec(region.html)) !== null) {
      images.push({ src: imageSrc(im[0]), alt: attr(im[0], 'alt') });
    }

    var links = [], placeholders = [], lm, lre = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    while ((lm = lre.exec(region.html)) !== null) {
      var href = attr('<a ' + lm[1] + '>', 'href');
      var label = stripTags(lm[2]);
      // href="#" and an empty href are placeholders someone meant to fill in.
      // An in-page anchor (#item-123) is a real destination and is not.
      // Some anchors are legitimately "#" — back-to-top, skip links, and the
      // toggles that drive accordions and tabs — so they are excluded by
      // label and by the ARIA attributes that give them away. "Back to top"
      // was reported as a defect on a page where it was working correctly.
      if (!href || href === '#') {
        if (!safeAnchor(lm[1], label, cfg)) placeholders.push({ href: href, text: label });
        continue;
      }
      if (href.charAt(0) === '#') continue;
      links.push({ href: href, text: label });
    }

    // A call to action rendered as bare text: the label shipped, the link did
    // not. Matches a single-level container, which is how these are written.
    var deadCtas = [], cm;
    var cre = new RegExp('<(?:div|p|span)\\b[^>]*class\\s*=\\s*["\'][^"\']*\\b(?:' +
      ((cfg && cfg.ctaContainers) || ['actions', 'cta', 'ctalink']).join('|') +
      ')\\b[^"\']*["\'][^>]*>([\\s\\S]*?)</(?:div|p|span)>', 'gi');
    while ((cm = cre.exec(region.html)) !== null) {
      var inner = cm[1];
      var label2 = stripTags(inner);
      if (label2 && inner.indexOf('<a') === -1) deadCtas.push(label2);
    }

    // A stat card is a figure standing on its own, captioned by the text that
    // follows it. When the two disagree the page contradicts itself, and no
    // brief is needed to see it.
    //
    // Deliberately structure-independent. Earlier versions keyed off the tag
    // holding the figure and kept missing real cards: the tag list left out
    // headings, the figure had to be the tag's entire content so nested markup
    // hid it, and a non-breaking space between the number and its percent sign
    // broke the match. Reading the text nodes instead means the markup around
    // the figure — however a template chooses to nest it — cannot hide it.
    var statConflicts = [];
    var statNodes = textNodes(region.html.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ''))
      .map(function (t) { return normalise(t); })
      .filter(function (t) { return t !== ''; });

    for (var si = 0; si < statNodes.length; si++) {
      var node = statNodes[si], figure = null, nextAt = si + 1;

      if (/^\d[\d.,]*\s*%$/.test(node)) {
        figure = node.replace(/\s+/g, '');
      } else if (/^\d[\d.,]*$/.test(node) && /^%/.test(statNodes[si + 1] || '')) {
        // Templates that style the percent sign separately split it off.
        figure = node + '%';
        nextAt = si + 2;
      }
      if (!figure) continue;

      // A caption is prose, not the next cell of a table. A row of bare
      // figures reads as figure-then-different-figure and would otherwise be
      // reported as a contradiction on every column. Two conditions keep that
      // out: the text immediately after must not itself be a bare figure, and
      // the window must contain actual words. The cost is a caption whose own
      // percentage is styled into a separate element, which is rare enough to
      // be worth trading for silence on data tables.
      if (/^\d[\d.,]*\s*%?$/.test(statNodes[nextAt] || '')) continue;

      var after = statNodes.slice(nextAt).join(' ').slice(0, 200);
      if ((after.match(/[A-Za-z\u00C0-\u024F]/g) || []).length < 3) continue;

      var caption = /(\d[\d.,]*\s*%)/.exec(after);
      if (!caption) continue;

      var captionFigure = caption[1].replace(/\s+/g, '');
      if (captionFigure === figure) continue;

      var stop = after.indexOf('.', caption.index);
      statConflicts.push({
        figure: figure,
        caption: after.slice(0, stop === -1 ? Math.min(after.length, caption.index + 60) : stop + 1).trim()
      });
    }

    return {
      // Three distinct fields that were previously conflated: og:title is the
      // meta title, the window title is the page name, and the last URL
      // segment is the page path.
      metaTitle: og('title'),
      pageName: title ? stripTags(title[1]) : null,
      pagePath: segments.length ? segments[segments.length - 1] : null,
      description: meta('description') || og('description'),
      keywords: meta('keywords'),
      canonical: canonicalHref,
      h1: headings.filter(function (h) { return h.level === 'h1'; }).map(function (h) { return h.text; }),
      headings: headings,
      images: images,
      links: links,
      placeholderLinks: placeholders,
      deadCtas: deadCtas,
      statConflicts: statConflicts,
      text: stripTags(region.html),
      regionVia: region.via
    };
  }

  // ─── BRIEF EXPECTATIONS ──────────────────────────────────────────────────
  // A brief's shape follows its playbook, so each one is read differently:
  // a new-page brief is labelled lines and numbered sections, a localization
  // brief is a table whose third column is the copy that must appear.

  function labelled(text, label) {
    var re = new RegExp('^\\s*' + label + '\\s*[:\\t]\\s*(.+)$', 'im');
    var m = re.exec(text);
    return m ? m[1].trim() : null;
  }

  function localisedRow(rows, label) {
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i];
      if (cells.length >= 3 && normalise(cells[0]).toLowerCase() === label.toLowerCase()) {
        var last = cells[cells.length - 1].trim();
        if (last) return last;
      }
    }
    return null;
  }

  function readBrief(text, workTypeId) {
    text = String(text == null ? '' : text);
    var expect = { mode: null, metadata: {}, sections: [], body: [], images: [], links: [] };
    var i, m;

    if (workTypeId === 'localization') {
      // Localization briefs arrive both ways: a table with an English master
      // column, or the localized copy as prose. Columns are exact, so use them
      // when they are there and fall back to prose when they are not.
      var rows = splitRows(text);
      var tabular = rows.filter(function (r) { return r.length >= 3; }).length;
      if (tabular < 2) {
        expect.mode = 'prose';
        // Prose asserts nothing about structure. A short line in a prose brief
        // is as likely to be a stat, a CTA label or a market name as a
        // heading, and calling every line under 80 characters a section put 39
        // findings in the structure category on a page that had none of them.
        rows.forEach(function (r) {
          var v = r.join(' ').trim();
          if (v.length >= 40) expect.body.push(v);
        });
        return expect;
      }
      expect.mode = 'columns';
      expect.metadata.title = localisedRow(rows, 'Meta title');
      expect.metadata.pageName = localisedRow(rows, 'Page name');
      expect.metadata.description = localisedRow(rows, 'Meta description');
      expect.metadata.keywords = localisedRow(rows, 'Meta keywords');
      ['Headline', 'Subheading', 'Title', 'Body'].forEach(function (label) {
        rows.forEach(function (cells) {
          if (cells.length >= 3 && normalise(cells[0]).toLowerCase() === label.toLowerCase()) {
            var v = cells[cells.length - 1].trim();
            if (!v) return;
            if (label === 'Headline' || label === 'Title') expect.sections.push(v);
            else expect.body.push(v);
          }
        });
      });
      // A localization brief carries the CTA label and the CTA destination on
      // separate rows ("CTA / Learn more" then "CTA Link / /digital-services/").
      // Pairing them in order is what lets the comparer check where a button
      // actually points, not just what it says.
      var labels = [], hrefs = [];
      rows.forEach(function (cells) {
        if (cells.length < 3) return;
        var key = normalise(cells[0]);
        if (!/^cta\b/i.test(key)) return;
        var value = cells[cells.length - 1].trim();
        if (!value) return;
        if (/link/i.test(key)) hrefs.push(value);
        else labels.push(value);
      });
      labels.forEach(function (label, i) {
        var href = hrefs[i];
        // Only treat it as a destination if it looks like one — these rows
        // sometimes hold prose ("Anchor link to the tech specs table").
        var looksLikeUrl = href && /^(https?:\/\/|\/)/.test(href);
        expect.links.push({ text: label, href: looksLikeUrl ? href : null });
      });
      return expect;
    }

    if (workTypeId === 'keyword-update') {
      expect.mode = 'columns';
      var kwRows = splitRows(text);
      for (i = 0; i < kwRows.length; i++) {
        var cells = kwRows[i];
        if (cells.length >= 2 && /^https?:\/\//i.test(cells[0].trim())) {
          expect.metadata.keywords = cells[cells.length - 1].trim();
          break;
        }
      }
      return expect;
    }

    // new-page, and content-update briefs that carry replacement copy
    expect.mode = 'labelled';
    expect.metadata.title = labelled(text, 'Meta Title');
    expect.metadata.pageName = labelled(text, 'Page Name');
    expect.metadata.description = labelled(text, 'Meta Description');
    expect.metadata.keywords = labelled(text, 'Meta Keywords');
    expect.metadata.canonical = labelled(text, 'URL Path');

    var lines = splitRows(text).map(function (r) { return r.join('\t'); });
    for (i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (/^(meta title|meta description|meta keywords|url path)\s*:/i.test(line)) continue;

      m = /^(.*?)\s*\[\d+\.\d+\]\s*$/.exec(line);
      if (m && m[1]) { expect.sections.push(m[1].trim()); continue; }

      m = /^(?:HERO\s*:\s*)?AEM Assets\s*[-–]\s*(.+)$/i.exec(line);
      if (m) { expect.images.push(m[1].trim()); continue; }

      if (line.length >= 40) expect.body.push(line);
    }
    return expect;
  }

  // A cell that arrived from a broken CSV split carries half a quote pair.
  // The pair is punctuation the page never renders, so it must not decide a
  // match — 35 paragraphs were reported missing over a single leading quote.

  function unwrapQuotes(s) {
    var v = String(s == null ? '' : s).trim();
    if ((v.match(/"/g) || []).length % 2 === 1) {
      if (v.charAt(0) === '"') v = v.slice(1);
      else if (v.charAt(v.length - 1) === '"') v = v.slice(0, -1);
    }
    return v.trim();
  }

  // A brief cell often holds two or three sentences that the page renders in
  // separate elements, so the paragraph never appears as one continuous
  // string however well it is normalised. Only descend to sentences when the
  // whole paragraph fails, so a fragment can never match by accident.

  function sentencesOf(text) {
    var out = [], m, re = /[^.!?]+[.!?]*/g;
    while ((m = re.exec(text)) !== null) {
      var s = m[0].trim();
      if (s.length >= 25) out.push(s);
    }
    return out;
  }

  // ─── COMPARING ───────────────────────────────────────────────────────────

  // Metadata is compared word for word — normalise() folds only the punctuation
  // a CMS rewrites on its way to the page, and never case. What matters as much
  // as the comparison is saying when there was nothing to compare: a brief that
  // defines no metadata used to render identically to one that matched, which
  // is how an English <title> shipped on a Portuguese page unreported.

  // These are three different fields and were being treated as one. og:title is
  // the meta title, the window title is the page name, and the last URL segment
  // is the page path. Every row is returned whether or not the brief mentions
  // it, so an author can always see what the page is actually carrying — the
  // Metadata block used to be blank unless the brief defined something.

  function metadataRows(expect, page) {
    // Not every template ships Open Graph. Rather than call the meta title
    // missing on every such page, fall back to the window title for the
    // comparison and say that is what happened — the absence is worth a
    // glance, but it is not the same defect as a wrong title.
    var ogMissing = page.metaTitle == null || page.metaTitle === '';
    var metaTitleValue = ogMissing ? page.pageName : page.metaTitle;

    return [
      { field: 'Meta title', source: ogMissing ? 'window title (page carries no og:title)' : 'og:title',
        want: expect.metadata.title, got: metaTitleValue, matches: same, soft: ogMissing },
      { field: 'Page name', source: 'window title',
        want: expect.metadata.pageName, got: page.pageName, matches: same },
      // Displayed as the last segment, compared as a whole path so that a
      // preview host or an .aspx extension never registers as a difference.
      { field: 'Page path', source: 'last URL segment',
        want: expect.metadata.canonical, got: page.pagePath, compareAgainst: page.canonical, matches: samePath },
      { field: 'Meta description', source: null,
        want: expect.metadata.description, got: page.description, matches: same },
      { field: 'Meta keywords', source: null,
        want: expect.metadata.keywords, got: page.keywords, matches: same }
    ].map(function (row) {
      var want = row.want, got = row.got, state;
      var against = row.compareAgainst !== undefined ? row.compareAgainst : got;

      if (want == null || want === '') state = 'not-in-brief';
      else if (against == null || against === '') state = 'missing';
      else state = row.matches(want, against) ? 'matches' : 'differs';

      return {
        field: row.field,
        source: row.source,
        expected: want || null,
        found: got || null,
        state: state,
        soft: !!row.soft
      };
    });
  }

  function metadataDefined(expect, page) {
    return metadataRows(expect, page).filter(function (r) { return r.state !== 'not-in-brief'; })
      .map(function (r) { return r.field; });
  }

  function metadataDeviations(expect, page) {
    var out = [];
    metadataRows(expect, page).forEach(function (row) {
      // A field the brief never mentioned is shown for information, not judged.
      if (row.state === 'not-in-brief') return;
      if (row.state === 'matches') {
        // Matched, but against the fallback rather than the field the brief
        // means. Worth a look, not a defect.
        if (row.soft) {
          out.push({
            field: row.field, expected: row.expected, found: row.found,
            note: 'the page carries no og:title, so this was compared against the window title',
            severity: 'check', fromBrief: true
          });
        }
        return;
      }
      out.push({
        field: row.field,
        expected: row.expected,
        found: row.found,
        note: row.state === 'missing' ? 'missing from the page' : 'differs',
        severity: 'break',
        fromBrief: true
      });
    });

    if (page.h1.length === 0) out.push({ field: 'H1', expected: null, found: null, note: 'the page has no H1', severity: 'break' });
    else if (page.h1.length > 1) {
      out.push({ field: 'H1', expected: 'one H1', found: page.h1.join(' / '), note: page.h1.length + ' H1 tags on the page', severity: 'break' });
    }
    return out;
  }

  function bodyDeviations(expect, page) {
    var out = [];
    var pageText = normalise(page.text);
    expect.body.forEach(function (paragraph) {
      var want = unwrapQuotes(paragraph);
      if (!want) return;
      if (pageText.indexOf(normalise(want)) !== -1) return;
      // The whole paragraph is not there in one piece. That is usually the
      // page splitting it across elements rather than copy going missing, so
      // report only the sentences that are genuinely absent.
      var parts = sentencesOf(want);
      if (!parts.length) {
        out.push({ expected: paragraph, note: 'not found on the page', severity: 'break', fromBrief: true });
        return;
      }
      parts.forEach(function (part) {
        if (pageText.indexOf(normalise(part)) === -1) {
          out.push({ expected: part, note: 'not found on the page', severity: 'break', fromBrief: true });
        }
      });
    });
    (page.statConflicts || []).forEach(function (c) {
      out.push({
        expected: c.figure,
        found: c.caption,
        note: 'the figure and its caption disagree on the page',
        severity: 'break'
      });
    });

    return out;
  }

  function imageDeviations(expect, page, variantPattern) {
    var out = [];
    var onPage = page.images.map(function (img) { return assetIdentity(img.src, variantPattern); })
      .filter(function (id) { return id.length > 0; });

    expect.images.forEach(function (name) {
      var wanted = assetIdentity(name, variantPattern);
      if (!wanted) return;
      var found = onPage.some(function (id) {
        return id === wanted || id.indexOf(wanted) !== -1 || wanted.indexOf(id) !== -1;
      });
      if (found) return;
      // Deliberately not a failure. A DAM or Scene7 embed URL frequently
      // carries none of the brief's asset name, so this fires on correct
      // pages — treat it as something to glance at, not something broken.
      out.push({
        expected: name,
        note: 'no image on the page resolves to this asset — DAM embed URLs often do not carry the brief\'s asset name, so check by eye',
        severity: 'check',
        fromBrief: true
      });
    });

    page.images.forEach(function (img) {
      if (!img.src) out.push({ expected: null, found: img.alt || '(no alt)', note: 'image tag with no src', severity: 'break' });
      else if (!img.alt) out.push({ expected: null, found: img.src, note: 'image has no alt text', severity: 'break' });
    });
    return out;
  }

  function linkDeviations(expect, page) {
    var out = [];
    expect.links.forEach(function (want) {
      var byText = page.links.filter(function (l) { return same(l.text, want.text); })[0];
      if (!byText) {
        // The anchor may be on the page but held back as a placeholder. That
        // is one defect, and it is already reported below — saying the link is
        // also missing would report the same anchor twice.
        var asPlaceholder = (page.placeholderLinks || []).filter(function (l) { return same(l.text, want.text); })[0];
        if (!asPlaceholder) {
          out.push({ expected: want.text, found: null, note: 'link not found on the page', severity: 'break', fromBrief: true });
        }
        return;
      }
      if (want.href && !samePath(byText.href, want.href)) {
        out.push({ expected: want.text + ' → ' + want.href, found: byText.href, note: 'points somewhere else', severity: 'break', fromBrief: true });
      }
    });
    page.links.forEach(function (l) {
      if (/^https?:\/\/[^/]*author|\/content\//i.test(l.href)) {
        out.push({ expected: null, found: l.href, note: 'author or /content/ path published to the live page', severity: 'break' });
      }
    });

    // Neither of these needs the brief to be right about them.
    (page.placeholderLinks || []).forEach(function (l) {
      out.push({
        expected: null,
        found: l.text || '(no label)',
        note: l.href === '#' ? 'link still points at the placeholder href="#"' : 'link has no destination',
        severity: 'break'
      });
    });
    (page.deadCtas || []).forEach(function (label) {
      out.push({ expected: null, found: label, note: 'call to action is bare text with no link', severity: 'break' });
    });
    return out;
  }

  function structureDeviations(expect, page) {
    var out = [];

    // A heading that appears twice is a structural fault and needs no brief to
    // be one, so it is reported whether or not the brief listed any sections.
    var seen = {};
    page.headings.forEach(function (h) {
      var k = normalise(h.text).toLowerCase();
      if (!k) return;
      if (seen[k]) {
        if (seen[k] === 1) out.push({ expected: h.text, note: 'this heading appears more than once on the page', severity: 'break' });
        seen[k]++;
      } else seen[k] = 1;
    });

    if (!expect.sections.length) return out;
    var pageHeadings = page.headings.map(function (h) { return normalise(h.text).toLowerCase(); });
    var cursor = -1;
    expect.sections.forEach(function (section) {
      var at = pageHeadings.indexOf(normalise(section).toLowerCase());
      if (at === -1) { out.push({ expected: section, note: 'section heading missing from the page', severity: 'break', fromBrief: true }); return; }
      if (at < cursor) out.push({ expected: section, note: 'section appears out of the brief\'s order', severity: 'break', fromBrief: true });
      cursor = Math.max(cursor, at);
    });
    return out;
  }

  // The five categories with every brief-derived finding removed — what the
  // page says about itself. Used by both guards: a brief that could not be
  // read and a brief that was read wrongly should still surface these.

  function pageOnlyCategories(page, cfg) {
    var expect = { mode: null, metadata: {}, sections: [], body: [], images: [], links: [] };
    var categories = [
      { id: 'metadata', label: 'Metadata', deviations: metadataDeviations(expect, page) },
      { id: 'body', label: 'Body Text', deviations: bodyDeviations(expect, page) },
      { id: 'images', label: 'Images', deviations: imageDeviations(expect, page, cfg.assetVariantPattern) },
      { id: 'links', label: 'Hyperlinks / CTAs', deviations: linkDeviations(expect, page) },
      { id: 'structure', label: 'Structure', deviations: structureDeviations(expect, page) }
    ];
    var breaks = 0, checks = 0;
    categories.forEach(function (c) {
      c.deviations = c.deviations.filter(function (d) { return !d.fromBrief; });
      c.deviations.forEach(function (d) { if (d.severity === 'check') checks++; else breaks++; });
    });
    // An empty category here would render as "No deviations", and nothing in
    // it was checked — that is the false pass these guards exist to prevent.
    // Only categories that actually found something are shown.
    return {
      categories: categories.filter(function (c) { return c.deviations.length > 0; }),
      breaks: breaks,
      checks: checks
    };
  }

  function create(config) {
    var cfg = (config && config['work-types'] && config['work-types'].compare) || {};
    var supported = cfg.workTypes || ['new-page', 'localization', 'content-update', 'keyword-update'];

    function compare(briefText, html, options) {
      options = options || {};
      var workTypeId = options.workTypeId || 'new-page';

      if (supported.indexOf(workTypeId) === -1) {
        return {
          generatedAt: new Date().toISOString(),
          supported: false,
          workTypeId: workTypeId,
          note: 'There is no built page to read for this kind of job — check it by following the URL instead.',
          categories: []
        };
      }

      var page = readPage(html, cfg);
      var expect = readBrief(briefText, workTypeId);

      // The bug this exists to prevent: zero expectations compared against any
      // page yields zero deviations, and five empty categories read exactly
      // like a pass. A comparison that never happened must never look like one
      // that succeeded.
      var expectationCount =
        Object.keys(expect.metadata).filter(function (k) { return expect.metadata[k]; }).length +
        expect.sections.length + expect.body.length + expect.images.length + expect.links.length;

      if (expectationCount === 0) {
        // Nothing to compare against does not mean nothing to say. The checks
        // that read the page alone — placeholder links, dead CTAs, a figure
        // that contradicts its caption, a heading used twice — are as true
        // without a brief as with one, so they are still reported here.
        var pageOnly = pageOnlyCategories(page, cfg);
        return {
          generatedAt: new Date().toISOString(),
          supported: true,
          unreadable: true,
          workTypeId: workTypeId,
          mode: expect.mode,
          regionVia: page.regionVia,
          note: 'Nothing could be read out of this brief, so there was nothing to compare the page against — ' +
                'this is not a pass. A localization brief needs either tab-separated columns or the localized ' +
                'copy as text; a new-page brief needs its Meta Title, Meta Description and URL Path lines. ' +
                'The findings below come from the page alone and need no brief to be right.',
          breaks: pageOnly.breaks,
          checks: pageOnly.checks,
          categories: pageOnly.categories
        };
      }

      // Real defects first, things to glance at second — a reviewer should
      // never have to read past a low-priority check to find a break.
      function ordered(list) {
        return list.slice().sort(function (a, b) {
          var rank = { 'break': 0, 'check': 1 };
          return (rank[a.severity] || 0) - (rank[b.severity] || 0);
        });
      }

      var categories = [
        { id: 'metadata', label: 'Metadata', deviations: ordered(metadataDeviations(expect, page)) },
        { id: 'body', label: 'Body Text', deviations: ordered(bodyDeviations(expect, page)) },
        { id: 'images', label: 'Images', deviations: ordered(imageDeviations(expect, page, cfg.assetVariantPattern)) },
        { id: 'links', label: 'Hyperlinks / CTAs', deviations: ordered(linkDeviations(expect, page)) },
        { id: 'structure', label: 'Structure', deviations: ordered(structureDeviations(expect, page)) }
      ];

      // The question the tool exists to answer is not "what is different" but
      // "is everything the brief asked for actually on the page". Counting that
      // is what makes the two failure modes legible without a heuristic: zero
      // of zero is a brief that did not parse, and two of seventy-four is a
      // brief that parsed wrongly. Both used to need a special guard to read.
      var briefFailures = 0;
      categories.forEach(function (c) {
        c.deviations.forEach(function (d) { if (d.fromBrief) briefFailures++; });
      });
      var coverage = {
        total: expectationCount,
        found: Math.max(0, expectationCount - briefFailures),
        missing: briefFailures,
        complete: briefFailures === 0
      };
      var missRate = expectationCount > 0 ? briefFailures / expectationCount : 0;

      // A near-total miss still says the brief was probably misread rather than
      // the page badly built — but with the count on screen, suppressing the
      // findings would hide the very thing that explains it. Warn, and show.
      var suspectParse = expectationCount >= 8 && missRate >= 0.9;

      // Metadata is always shown, brief or no brief, so the author can see what
      // the page carries. The rows carry their own state.
      var defined = metadataDefined(expect, page);
      categories[0].rows = metadataRows(expect, page);
      if (!defined.length) {
        categories[0].note = 'The brief defines no metadata, so none of it was checked — this is not a pass. ' +
          'What the page carries is listed below for reference.';
      }

      var breaks = 0, checks = 0;
      categories.forEach(function (c) {
        c.deviations.forEach(function (d) { if (d.severity === 'check') checks++; else breaks++; });
      });

      return {
        generatedAt: new Date().toISOString(),
        supported: true,
        unreadable: false,
        workTypeId: workTypeId,
        mode: expect.mode,
        expectations: expectationCount,
        coverage: coverage,
        suspectParse: suspectParse,
        parseNote: suspectParse
          ? coverage.found + ' of ' + coverage.total + ' items from the brief were found on the page. ' +
            'Failing nearly everything usually means the brief was read wrongly rather than the page built ' +
            'wrongly — the brief was read as ' + (expect.mode === 'columns' ? 'a table, so check the column ' +
            'order and that no row has been torn in half.' : 'prose, so check that its table columns survived ' +
            'the paste — upload an Excel or Word brief rather than pasting it.')
          : null,
        metadataChecked: defined,
        regionVia: page.regionVia,
        breaks: breaks,
        checks: checks,
        categories: categories
      };
    }

    return {
      compare: compare,
      readPage: function (h) { return readPage(h, cfg); },
      readBrief: readBrief,
      splitRows: splitRows,
      normalise: normalise,
      pathOf: pathOf,
      assetIdentity: function (v) { return assetIdentity(v, cfg.assetVariantPattern); }
    };
  }

  return { create: create };
}));

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

    var title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(headHtml);
    var canonicalTag = /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i.exec(headHtml);

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
      if (!href || href === '#') { placeholders.push({ href: href, text: label }); continue; }
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

    // A stat card is a short element holding just a figure, captioned by the
    // text that follows it. When the figure and the caption disagree, the page
    // contradicts itself and no brief is needed to see it.
    var statConflicts = [], sm;
    var sre = /<(span|div|strong|p)\b[^>]*>\s*((?:\d[\d.,]*)\s*%)\s*<\/\1>/gi;
    while ((sm = sre.exec(region.html)) !== null) {
      var figure = normalise(sm[2]).replace(/\s+/g, '');
      var after = stripTags(region.html.slice(sm.index + sm[0].length, sm.index + sm[0].length + 500));
      var caption = /((?:\d[\d.,]*)\s*%)/.exec(after);
      if (!caption) continue;
      var captionFigure = caption[1].replace(/\s+/g, '');
      if (captionFigure !== figure) {
        var end = after.indexOf('.', caption.index);
        statConflicts.push({
          figure: figure,
          caption: after.slice(0, end === -1 ? Math.min(after.length, caption.index + 60) : end + 1).trim()
        });
      }
    }

    return {
      title: title ? stripTags(title[1]) : null,
      description: meta('description'),
      keywords: meta('keywords'),
      canonical: canonicalTag ? attr(canonicalTag[0], 'href') : null,
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

  function localisedRow(text, label) {
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var cells = lines[i].split('\t');
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
      var tabular = text.split(/\r?\n/).filter(function (l) { return l.split('\t').length >= 3; }).length;
      if (tabular < 2) {
        expect.mode = 'prose';
        text.split(/\r?\n/).forEach(function (line) {
          var v = line.trim();
          if (!v) return;
          if (v.length <= 80) expect.sections.push(v);
          else expect.body.push(v);
        });
        return expect;
      }
      expect.mode = 'columns';
      expect.metadata.title = localisedRow(text, 'Meta title');
      expect.metadata.description = localisedRow(text, 'Meta description');
      ['Headline', 'Subheading', 'Title', 'Body'].forEach(function (label) {
        var lines = text.split(/\r?\n/);
        lines.forEach(function (line) {
          var cells = line.split('\t');
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
      text.split(/\r?\n/).forEach(function (line) {
        var cells = line.split('\t');
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
      var rows = text.split(/\r?\n/);
      for (i = 0; i < rows.length; i++) {
        var cells = rows[i].split('\t');
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
    expect.metadata.description = labelled(text, 'Meta Description');
    expect.metadata.keywords = labelled(text, 'Meta Keywords');
    expect.metadata.canonical = labelled(text, 'URL Path');

    var lines = text.split(/\r?\n/);
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

  // ─── COMPARING ───────────────────────────────────────────────────────────

  function metadataDeviations(expect, page) {
    var out = [];
    [
      ['Meta title', expect.metadata.title, page.title, same],
      ['Meta description', expect.metadata.description, page.description, same],
      ['Meta keywords', expect.metadata.keywords, page.keywords, same],
      // The canonical is a URL, so an environment difference is not a defect.
      ['Canonical / URL path', expect.metadata.canonical, page.canonical, samePath]
    ].forEach(function (row) {
      var label = row[0], want = row[1], got = row[2], matches = row[3];
      if (want == null) return;
      if (got == null || got === '') {
        out.push({ field: label, expected: want, found: null, note: 'missing from the page', severity: 'break' });
      } else if (!matches(want, got)) {
        out.push({ field: label, expected: want, found: got, note: 'differs', severity: 'break' });
      }
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
    expect.body.forEach(function (sentence) {
      if (pageText.indexOf(normalise(sentence)) === -1) {
        out.push({ expected: sentence, note: 'not found on the page', severity: 'break' });
      }
    });
    (page.statConflicts || []).forEach(function (c) {
      out.push({
        expected: c.figure,
        found: c.caption,
        note: 'the figure and its caption disagree on the page',
        severity: 'break'
      });
    });

    var seen = {};
    page.headings.forEach(function (h) {
      var k = normalise(h.text).toLowerCase();
      if (!k) return;
      if (seen[k]) { if (seen[k] === 1) out.push({ expected: h.text, note: 'section appears more than once on the page', severity: 'break' }); seen[k]++; }
      else seen[k] = 1;
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
        severity: 'check'
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
      if (!byText) { out.push({ expected: want.text, found: null, note: 'link not found on the page', severity: 'break' }); return; }
      if (want.href && !samePath(byText.href, want.href)) {
        out.push({ expected: want.text + ' → ' + want.href, found: byText.href, note: 'points somewhere else', severity: 'break' });
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
    if (!expect.sections.length) return out;
    var pageHeadings = page.headings.map(function (h) { return normalise(h.text).toLowerCase(); });
    var cursor = -1;
    expect.sections.forEach(function (section) {
      var at = pageHeadings.indexOf(normalise(section).toLowerCase());
      if (at === -1) { out.push({ expected: section, note: 'section heading missing from the page', severity: 'break' }); return; }
      if (at < cursor) out.push({ expected: section, note: 'section appears out of the brief\'s order', severity: 'break' });
      cursor = Math.max(cursor, at);
    });
    return out;
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
        return {
          generatedAt: new Date().toISOString(),
          supported: true,
          unreadable: true,
          workTypeId: workTypeId,
          mode: expect.mode,
          note: 'Nothing could be read out of this brief, so there was nothing to compare the page against — ' +
                'this is not a pass. A localization brief needs either tab-separated columns or the localized ' +
                'copy as text; a new-page brief needs its Meta Title, Meta Description and URL Path lines.',
          breaks: 0,
          checks: 0,
          categories: []
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
      normalise: normalise,
      pathOf: pathOf,
      assetIdentity: function (v) { return assetIdentity(v, cfg.assetVariantPattern); }
    };
  }

  return { create: create };
}));

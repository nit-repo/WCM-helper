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

  // ─── HTML EXTRACTION ─────────────────────────────────────────────────────

  var CHROME_RE = /<(nav|header|footer|script|style|noscript|svg)\b[^>]*>[\s\S]*?<\/\1>/gi;

  function attr(tag, name) {
    var m = new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
    if (!m) return '';
    return decodeEntities(m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]);
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
      images.push({ src: attr(im[0], 'src'), alt: attr(im[0], 'alt') });
    }

    var links = [], lm, lre = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    while ((lm = lre.exec(region.html)) !== null) {
      var href = attr('<a ' + lm[1] + '>', 'href');
      if (!href || href.charAt(0) === '#') continue;
      links.push({ href: href, text: stripTags(lm[2]) });
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
    var expect = { metadata: {}, sections: [], body: [], images: [], links: [] };
    var i, m;

    if (workTypeId === 'localization') {
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
      var lm, lre = /^CTA\b[^\t]*\t[^\t]*\t(.+)$/gim;
      while ((lm = lre.exec(text)) !== null) expect.links.push({ text: lm[1].trim(), href: null });
      return expect;
    }

    if (workTypeId === 'keyword-update') {
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
      ['Meta title', expect.metadata.title, page.title],
      ['Meta description', expect.metadata.description, page.description],
      ['Meta keywords', expect.metadata.keywords, page.keywords],
      ['Canonical / URL path', expect.metadata.canonical, page.canonical]
    ].forEach(function (row) {
      var label = row[0], want = row[1], got = row[2];
      if (want == null) return;
      if (got == null || got === '') out.push({ field: label, expected: want, found: null, note: 'missing from the page' });
      else if (!same(want, got)) out.push({ field: label, expected: want, found: got, note: 'differs' });
    });

    if (page.h1.length === 0) out.push({ field: 'H1', expected: null, found: null, note: 'the page has no H1' });
    else if (page.h1.length > 1) {
      out.push({ field: 'H1', expected: 'one H1', found: page.h1.join(' / '), note: page.h1.length + ' H1 tags on the page' });
    }
    return out;
  }

  function bodyDeviations(expect, page) {
    var out = [];
    var pageText = normalise(page.text);
    expect.body.forEach(function (sentence) {
      if (pageText.indexOf(normalise(sentence)) === -1) {
        out.push({ expected: sentence, note: 'not found on the page' });
      }
    });
    var seen = {};
    page.headings.forEach(function (h) {
      var k = normalise(h.text).toLowerCase();
      if (!k) return;
      if (seen[k]) { if (seen[k] === 1) out.push({ expected: h.text, note: 'section appears more than once on the page' }); seen[k]++; }
      else seen[k] = 1;
    });
    return out;
  }

  function imageDeviations(expect, page) {
    var out = [];
    var srcs = page.images.map(function (img) { return normalise(img.src).toLowerCase(); }).join(' | ');
    expect.images.forEach(function (name) {
      var needle = normalise(name).toLowerCase().replace(/\.(jpg|jpeg|png|webp|gif)$/, '');
      if (srcs.indexOf(needle) === -1) out.push({ expected: name, note: 'no image on the page references this asset' });
    });
    page.images.forEach(function (img) {
      if (!img.src) out.push({ expected: null, found: img.alt || '(no alt)', note: 'image tag with no src' });
      else if (!img.alt) out.push({ expected: null, found: img.src, note: 'image has no alt text' });
    });
    return out;
  }

  function linkDeviations(expect, page) {
    var out = [];
    expect.links.forEach(function (want) {
      var byText = page.links.filter(function (l) { return same(l.text, want.text); })[0];
      if (!byText) { out.push({ expected: want.text, found: null, note: 'link not found on the page' }); return; }
      if (want.href && !same(byText.href, want.href)) {
        out.push({ expected: want.text + ' → ' + want.href, found: byText.href, note: 'points somewhere else' });
      }
    });
    page.links.forEach(function (l) {
      if (/^https?:\/\/[^/]*author|\/content\//i.test(l.href)) {
        out.push({ expected: null, found: l.href, note: 'author or /content/ path published to the live page' });
      }
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
      if (at === -1) { out.push({ expected: section, note: 'section heading missing from the page' }); return; }
      if (at < cursor) out.push({ expected: section, note: 'section appears out of the brief\'s order' });
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

      return {
        generatedAt: new Date().toISOString(),
        supported: true,
        workTypeId: workTypeId,
        regionVia: page.regionVia,
        categories: [
          { id: 'metadata', label: 'Metadata', deviations: metadataDeviations(expect, page) },
          { id: 'body', label: 'Body Text', deviations: bodyDeviations(expect, page) },
          { id: 'images', label: 'Images', deviations: imageDeviations(expect, page) },
          { id: 'links', label: 'Hyperlinks / CTAs', deviations: linkDeviations(expect, page) },
          { id: 'structure', label: 'Structure', deviations: structureDeviations(expect, page) }
        ]
      };
    }

    return { compare: compare, readPage: function (h) { return readPage(h, cfg); }, readBrief: readBrief, normalise: normalise };
  }

  return { create: create };
}));

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
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./brief.js'));
  else root.BriefCompare = factory(root.BriefShared);
}(typeof self !== 'undefined' ? self : this, function (Brief) {
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
      // &reg; was missing while &trade; was here, so a brief writing the
      // registered mark never matched a page rendering the entity.
      .replace(/&reg;/gi, '\u00AE')
      .replace(/&copy;/gi, '\u00A9')
      .replace(/&deg;/gi, '\u00B0')
      .replace(/&hellip;/gi, '\u2026')
      .replace(/&#x([0-9a-f]+);/gi, function (_, n) { return String.fromCharCode(parseInt(n, 16)); })
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

  // Keywords are a set, not a sentence. A brief writes them one per bullet and
  // the page renders them comma-joined with no spaces, so comparing the two as
  // strings called a correct list a difference. Separator and order noise is
  // not a defect; a missing or extra keyword still is.
  function termsOf(v) {
    return normalise(v).split(',').map(function (t) { return t.trim(); })
      .filter(Boolean).sort().join('|');
  }
  function sameList(a, b) { return termsOf(a) === termsOf(b); }

  // ─── ROWS AND CELLS ──────────────────────────────────────────────────────
  // Quote-aware splitting, section grouping and provenance moved to brief.js
  // once engine.js and filler.js turned out to need the exact same parse —
  // see brief.js for why. Local aliases so the rest of this file reads the
  // same as before the move.

  var splitRows = Brief.splitRows;
  var sectionsByRow = Brief.sectionsByRow;
  var want = Brief.want;

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

  // pathOf() above deliberately discards the host — that is what makes a
  // preview host and a live host the same page for path comparison. Picking
  // a brief needs the opposite: a localization brief declares a market, not
  // a path, so its evidence is the host a market's domain resolves to.
  function pageHost(url) {
    var s = String(url == null ? '' : url).trim().replace(/^https?:\/\//i, '');
    var slash = s.indexOf('/');
    var host = slash === -1 ? s : s.slice(0, slash);
    return host.toLowerCase().replace(/^www\./, '');
  }

  // ─── ASSET IDENTITY ──────────────────────────────────────────────────────
  // A brief names an asset ("KONE_Feat_Handrail_B_Landscape-004"); the page
  // carries a DAM or Scene7 embed URL that may be cropped, renamed with a
  // variant suffix, or hung with preset parameters. Match on the identity
  // underneath rather than the string.

  function assetIdentity(value, variantPattern) {
    var v = String(value == null ? '' : value).trim();
    v = v.replace(/[?#].*$/, '');
    v = v.split('/').pop();
    // A filename with a space in it arrives percent-encoded in the src and
    // plain in the brief, so "Graphic 1" resolved to graphic1 while the page's
    // own "Graphic%201.jpg" resolved to graphic201 and the two never matched.
    // Malformed encoding is left exactly as it came.
    try { v = decodeURIComponent(v); } catch (e) { /* not valid encoding: keep as-is */ }
    // Scene7 names the rendition after the asset, separated by a colon:
    // "Monospace100_img_1-1:760x428(16-9)". The preset is delivery, not
    // identity, and a brief names the asset without it.
    v = v.replace(/:.*$/, '');
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

  // ─── COMPONENTS ──────────────────────────────────────────────────────────
  // Tridion prints what it authored. A content block is a <section> carrying a
  // module-<name> class and an item id, and every authored field inside it
  // carries its CMS field path in a comment, repeat index included:
  //
  //   <section class="module module-faq" id="item-142402">
  //     <!-- Start Component Field: {"XPath":"tcm:Content/custom:Accordion/custom:items[1]/custom:title"} -->
  //
  // So "the first item in the FAQ" is not something to infer from class-name
  // guessing or to count by hand — the page states it. Reading it is what lets
  // a finding say where it lives instead of quoting a brief row number back.

  function classesOf(tag) {
    var cls = attr(tag, 'class');
    return cls ? cls.split(/\s+/).filter(function (c) { return c; }) : [];
  }

  var VOID_TAG_RE = /^<(br|img|input|hr|meta|link|source|area|base|col|embed|param|track|wbr)\b/i;

  // The end of the element opening at openIndex, counting opens against closes
  // of the same tag rather than stopping at the first close. Modules are
  // <section> and do not nest today; a lazy [\s\S]*? would still be one
  // template change away from closing on the wrong tag.
  function elementEnd(html, tagName, openIndex) {
    var re = new RegExp('<(/?)' + tagName + '\\b', 'gi');
    re.lastIndex = openIndex;
    var depth = 0, m;
    while ((m = re.exec(html)) !== null) {
      if (m[1]) {
        depth--;
        if (depth === 0) {
          var close = html.indexOf('>', m.index);
          return close === -1 ? html.length : close + 1;
        }
      } else depth++;
    }
    return html.length;
  }

  var FIELD_RE = /<!--\s*Start Component Field:\s*\{[^}]*"XPath"\s*:\s*"([^"]+)"[^}]*\}\s*-->/gi;

  // tcm:Content/custom:Accordion/custom:items[1]/custom:title -> Accordion/items[1]/title
  function fieldPath(xpath) {
    return String(xpath)
      .replace(/^tcm:Content\//i, '')
      .split('/')
      .map(function (s) { return s.replace(/^custom:/i, ''); })
      .join('/');
  }

  // The value sits either side of the comment depending on the template: after
  // it for a heading or a rich-text block, before it for a button or link
  // label. Take what follows to the end of the enclosing element; when that is
  // empty, take what precedes back to the previous tag. Both shapes are on the
  // real page, which is why this reads both ways rather than picking one.
  function fieldValueAfter(html, from) {
    var depth = 0, i = from, out = '';
    while (i < html.length) {
      var lt = html.indexOf('<', i);
      if (lt === -1) { out += html.slice(i); break; }
      out += html.slice(i, lt);
      var isComment = html.substr(lt, 4) === '<!--';
      if (!isComment) {
        if (html.charAt(lt + 1) === '/') {
          if (depth === 0) break;
          depth--;
        } else if (!VOID_TAG_RE.test(html.slice(lt, lt + 12))) {
          var tagEnd = html.indexOf('>', lt);
          if (tagEnd === -1 || html.charAt(tagEnd - 1) !== '/') depth++;
        }
      }
      var gt = isComment ? html.indexOf('-->', lt) + 2 : html.indexOf('>', lt);
      if (gt === -1 || gt < lt) break;
      i = gt + 1;
    }
    return normalise(stripTags(out));
  }

  function fieldValueBefore(html, commentStart) {
    var prevGt = html.lastIndexOf('>', commentStart);
    if (prevGt === -1) return '';
    return normalise(html.slice(prevGt + 1, commentStart));
  }

  function fieldsIn(html, offset) {
    var out = [], m;
    FIELD_RE.lastIndex = 0;
    while ((m = FIELD_RE.exec(html)) !== null) {
      var after = fieldValueAfter(html, m.index + m[0].length);
      var value = after || fieldValueBefore(html, m.index);
      out.push({
        path: fieldPath(m[1]),
        value: value,
        at: offset + m.index
      });
    }
    return out;
  }

  // module-value-highlights -> "Value highlights"; module-faq -> "FAQ". Short
  // slugs are acronyms on this estate (faq, cta), so they stay uppercase.
  function humanise(name, prefix) {
    var slug = name.indexOf(prefix) === 0 ? name.slice(prefix.length) : name;
    var words = slug.split('-').filter(function (w) { return w; });
    return words.map(function (w, i) {
      if (w.length <= 3) return w.toUpperCase();
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w;
    }).join(' ');
  }

  function firstHeading(html) {
    var m = /<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(html);
    return m ? stripTags(m[1]) : null;
  }

  // The CME id of the component, which is what opens it in Tridion. It is not
  // always inside its own section — on the carousel the comment sits before
  // the opening tag — so this is read when it is there and never assumed.
  function componentIdIn(html) {
    var m = /<!--\s*Start Component Presentation:\s*\{[^}]*"ComponentID"\s*:\s*"([^"]+)"/i.exec(html);
    return m ? m[1] : null;
  }

  // The CSS classes a live production page renders are the only structural
  // signal it carries — the Component Presentation/Field comments a CMS
  // preview page has are stripped before publish. tridionComponents (see
  // tridion-component-taxonomy.md) maps a set of classes co-occurring on a
  // section to the canonical Tridion component type that renders them, so a
  // locator can still say "Accordion" rather than only the CSS-derived label.
  // The most specific match wins (most classes required), so a broad key
  // like "accordion" never shadows a narrower "module module-faq" match.
  function tridionComponentOf(tokens, cfg) {
    var map = (cfg && cfg.tridionComponents) || {};
    var best = null, bestCount = 0;
    Object.keys(map).forEach(function (key) {
      var need = key.split(/\s+/).filter(function (t) { return t; });
      var allPresent = need.every(function (t) { return tokens.indexOf(t) !== -1; });
      if (allPresent && need.length > bestCount) { best = map[key]; bestCount = need.length; }
    });
    return best;
  }

  function modulesIn(regionHtml, cfg) {
    var prefix = (cfg && cfg.modulePrefix) || 'module-';
    var extra = (cfg && cfg.moduleClasses) || ['hero-banner'];
    var out = [], re = /<section\b[^>]*>/gi, m;
    while ((m = re.exec(regionHtml)) !== null) {
      var tokens = classesOf(m[0]);
      var name = tokens.filter(function (c) {
        return c.indexOf(prefix) === 0 || extra.indexOf(c) !== -1;
      })[0];
      if (!name) continue;
      var end = elementEnd(regionHtml, 'section', m.index);
      var inner = regionHtml.slice(m.index, end);
      out.push({
        name: name,
        label: humanise(name, prefix),
        // The item id is this page's anchor and nothing more: the same
        // component is a different number on every page, and three sections
        // on the real page carry none at all. It is a reference, never a name.
        id: attr(m[0], 'id') || null,
        componentId: componentIdIn(inner),
        // The canonical Tridion component type, from CSS alone. Distinct
        // from componentId (this page's per-instance CME id, only present
        // with markers) — this is the type, derivable even without markers.
        component: tridionComponentOf(tokens, cfg),
        heading: firstHeading(inner),
        start: m.index,
        end: end,
        text: stripTags(inner),
        fields: fieldsIn(inner, m.index)
      });
      re.lastIndex = end;
    }

    // A page carries two content-rivers and two multi-CTAs. Type alone cannot
    // tell them apart, so a module of a repeated type takes its position.
    var counts = {};
    out.forEach(function (mod) { counts[mod.name] = (counts[mod.name] || 0) + 1; });
    var seen = {};
    out.forEach(function (mod) {
      seen[mod.name] = (seen[mod.name] || 0) + 1;
      mod.ordinal = seen[mod.name];
      mod.ofType = counts[mod.name];
    });
    return out;
  }

  // The one place a location string is built. What is stable lives in the
  // name — the component's type, its position when the type repeats, and the
  // field path, which is the component's schema and identical wherever it is
  // used. The per-page ids ride alongside as references.

  function moduleLabel(mod) {
    return mod.label + (mod.ofType > 1 ? ' #' + mod.ordinal : '');
  }

  // A module's own field markers, when it has any, already give the exact
  // slot a finding sits in \u2014 that always wins. Only when there are none (a
  // live page, stripped of markers) does the CSS-derived component name
  // stand in, and only then: a page that already has a precise field path
  // never needs the coarser fallback.
  function componentSuffix(mod) {
    return (!mod.fields || !mod.fields.length) && mod.component ? mod.component : null;
  }

  function placeOf(mod, fieldPath) {
    var suffix = fieldPath || componentSuffix(mod);
    return {
      where: moduleLabel(mod) + (suffix ? ' \u00b7 ' + suffix : ''),
      anchor: mod.id ? '#' + mod.id : null,
      componentId: mod.componentId || null,
      moduleHeading: mod.heading || null
    };
  }

  // Attach a place to a finding, leaving the finding untouched when the page
  // has no components to place it in.
  function at(finding, page, offset) {
    var loc = whereOf(page, offset);
    if (!loc) return finding;
    finding.where = loc.where;
    if (loc.anchor) finding.anchor = loc.anchor;
    if (loc.componentId) finding.componentId = loc.componentId;
    if (loc.moduleHeading) finding.moduleHeading = loc.moduleHeading;
    return finding;
  }

  // Where on the page a finding lives: the module containing it, and the
  // nearest authored field at or before it. "FAQ · Accordion/items[1]/title".
  function whereOf(page, offset) {
    if (offset == null || !page.modules) return null;
    var mod = page.modules.filter(function (m) { return offset >= m.start && offset < m.end; })[0];
    if (!mod) return null;
    var field = null;
    mod.fields.forEach(function (f) { if (f.at <= offset) field = f; });
    return placeOf(mod, field ? field.path : null);
  }

  // ─── SOURCE LANGUAGE ─────────────────────────────────────────────────────
  // A localization brief is written in the target language. When the page then
  // carries English prose in an authored field, that field was never
  // translated — the defect a "not found on the page" row can never name,
  // because the row is looking for text that was never written.

  var ENGLISH_WORDS = ['the', 'and', 'is', 'are', 'of', 'to', 'for', 'with', 'that',
    'this', 'from', 'have', 'has', 'will', 'can', 'your', 'you', 'our', 'we', 'it',
    'as', 'on', 'in', 'by', 'be', 'not', 'all', 'more', 'how', 'what', 'so', 'us'];

  function englishScore(text) {
    var s = ' ' + normalise(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
    var hits = 0;
    ENGLISH_WORDS.forEach(function (w) { if (s.indexOf(' ' + w + ' ') !== -1) hits++; });
    return hits;
  }

  // Three distinct English function words, so a stray brand name — "KONE
  // 24/7 Connected Services", "Max Floors" — never trips it.
  function looksEnglish(text) { return englishScore(text) >= 3; }

  // Inline elements carry no whitespace of their own — a browser renders
  // "elevators</span></a>, also" with no gap before the comma, because span
  // and a are inline. Replacing every tag with a space invented one there
  // that no reader sees, and failed an exact match against a real page over
  // it. Block elements and <br> do separate content and still contribute a
  // space; an unknown tag defaults to block, which is today's behaviour.
  var INLINE_TAG_RE = /^(a|span|strong|b|em|i|u|sup|sub|small|code|mark|abbr|cite|q|s|del|ins|label|font)$/i;

  function stripTags(html) {
    var out = String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, function (m, tag) {
        return INLINE_TAG_RE.test(tag) ? '' : ' ';
      });
    return normalise(out);
  }

  // A recurring shape: find every element among a set of tags carrying one
  // of a configured set of class tokens, and read its text. A dead CTA and
  // an accordion question are the same extraction with a different tag list
  // and a different class list — this is that extraction written once. The
  // \1 backreference closes on the tag that actually opened, rather than any
  // tag in the list, which the first version of this (dead CTAs) did not do.
  function elementsByClass(html, tags, classList) {
    var out = [], m;
    var re = new RegExp('<(' + tags.join('|') + ')\\b[^>]*class\\s*=\\s*["\'][^"\']*\\b(?:' +
      classList.join('|') + ')\\b[^"\']*["\'][^>]*>([\\s\\S]*?)<\\/\\1>', 'gi');
    while ((m = re.exec(html)) !== null) {
      out.push({ text: stripTags(m[2]), inner: m[2], at: m.index });
    }
    return out;
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

    // The template injects the window title as a hidden H2 several times over.
    // Counting those as headings reported three duplicates on a page that
    // renders one, so a heading nobody can see is carried but marked.
    var headings = [], hm, hre = /<(h[1-3])\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    while ((hm = hre.exec(region.html)) !== null) {
      headings.push({
        level: hm[1].toLowerCase(),
        text: stripTags(hm[3]),
        hidden: /display\s*:\s*none/i.test(hm[2]),
        at: hm.index
      });
    }

    var images = [], im, ire = /<img\b[^>]*>/gi;
    while ((im = ire.exec(region.html)) !== null) {
      images.push({ src: imageSrc(im[0]), alt: attr(im[0], 'alt'), at: im.index });
    }

    // Body copy at paragraph granularity, with the offset each one sits at.
    // page.text is the whole region flattened, which is all the comparer ever
    // needed; a brief generated from the page needs to put each paragraph
    // under the heading it belongs to, and that takes offsets.
    var paragraphs = [], pm, pre = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    while ((pm = pre.exec(region.html)) !== null) {
      var para = stripTags(pm[2]);
      if (para) paragraphs.push({ tag: pm[1].toLowerCase(), text: para, at: pm.index });
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
        if (!safeAnchor(lm[1], label, cfg)) placeholders.push({ href: href, text: label, at: lm.index });
        continue;
      }
      if (href.charAt(0) === '#') continue;
      links.push({ href: href, text: label, at: lm.index });
    }

    // A call to action rendered as bare text: the label shipped, the link did
    // not. Matches a single-level container, which is how these are written.
    var deadCtas = elementsByClass(region.html, ['div', 'p', 'span'],
        (cfg && cfg.ctaContainers) || ['actions', 'cta', 'ctalink'])
      .filter(function (el) { return el.text && el.inner.indexOf('<a') === -1; })
      .map(function (el) { return { text: el.text, at: el.at }; });

    // An accordion question functions as a heading — it labels a block of
    // content a reader expands — whether or not the template wrapped it in
    // an h-tag. This one doesn't: the question is bare <button> text. Read
    // it the same way a CTA container is read, by a configurable class
    // token, so the structure check has something to find it with.
    var triggerHeadings = elementsByClass(region.html, ['button', 'a', 'div', 'span'],
        (cfg && cfg.accordionTriggers) || ['accordion-trigger'])
      .filter(function (el) { return el.text; })
      .map(function (el) { return { text: el.text, at: el.at }; });

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
      paragraphs: paragraphs,
      images: images,
      links: links,
      placeholderLinks: placeholders,
      deadCtas: deadCtas,
      triggerHeadings: triggerHeadings,
      text: stripTags(region.html),
      // The declared language of the page against the one the template stamps
      // on <body>. Both are on the real Slovenia page and they disagree.
      lang: (/<html\b[^>]*>/i.exec(html) ? attr(/<html\b[^>]*>/i.exec(html)[0], 'lang') : '') || null,
      dataLang: (/<body\b[^>]*>/i.exec(html) ? attr(/<body\b[^>]*>/i.exec(html)[0], 'data-lang') : '') || null,
      modules: modulesIn(region.html, cfg),
      regionVia: region.via
    };
  }

  // ─── BRIEF EXPECTATIONS ──────────────────────────────────────────────────
  // A brief's shape follows its playbook, so each one is read differently:
  // a new-page brief is labelled lines and numbered sections, a localization
  // brief is a table whose third column is the copy that must appear.

  // A labelled brief opens with front matter — the rows that say what the page
  // is rather than what it says. Reading them by their exact spelling stopped
  // working the moment a real brief arrived: it wrote "Page Title/" wrapped
  // onto "Title Tag", "Meta Description/Meta Tag", and "Keywords" with its
  // four values on bullet rows underneath. None of it matched, so every
  // metadata field read "not defined in the brief" on a page that matched the
  // brief exactly, and the front matter fell through to the body catch-all
  // below and reported as eleven missing paragraphs.

  var BULLET_RE = /^[\u2022\u25CF\u25AA\u00B7*\u2013\u2014-]$/;

  var DEFAULT_BRIEF_LABELS = {
    title: ['meta title', 'page title', 'title tag', 'page title/title tag', 'seo title'],
    pageName: ['page name', 'window title'],
    description: ['meta description', 'meta tag', 'meta description/meta tag'],
    keywords: ['meta keywords', 'keywords'],
    canonical: ['url path', 'url', 'page url'],
    topic: ['blog topic', 'blog topic/title', 'topic', 'h1'],
    image: ['cover image', 'image link', 'hero image'],
    links: ['internal links', 'links']
  };

  function labelKey(raw) {
    return normalise(raw).toLowerCase()
      .replace(/\s*\/\s*/g, '/')
      .replace(/[:\s]+$/, '')
      .trim();
  }

  // The whole label is tested before either half of a slashed one, and that
  // order carries weight: "Blog Topic /Title" has to resolve to the H1, not
  // to the meta title, and in the brief that surfaced this the two are
  // deliberately different sentences.
  function fieldFor(label, labels) {
    var key = labelKey(label);
    if (!key) return null;
    var tries = [key].concat(key.split('/').map(function (p) { return p.trim(); }));
    for (var t = 0; t < tries.length; t++) {
      for (var field in labels) {
        if (labels.hasOwnProperty(field) && labels[field].indexOf(tries[t]) !== -1) return field;
      }
    }
    return null;
  }

  // Label-shaped, not prose: short, few words, and not ending in sentence
  // punctuation. Deliberately generous on length so an instruction line
  // ("Please publish blog under Modernisation tab") is recognised as a
  // declaration and kept out of the body copy.
  function labelShaped(s) {
    var v = String(s == null ? '' : s).trim();
    return v.length > 0 && v.length <= 60 && v.split(/\s+/).length <= 8 && !/[.!?]$/.test(v);
  }

  function frontMatter(rows, labels) {
    var fields = [], pending = '', i = 0;

    function push(label, values, row) {
      fields.push({ label: String(label).trim(), field: fieldFor(label, labels), values: values, row: row });
    }

    for (; i < rows.length; i++) {
      var cells = rows[i];
      var filled = cells.filter(function (c) { return c.trim() !== ''; });
      if (!filled.length) continue;

      // The copy block's own two idioms — a numbered section marker and an
      // AEM asset line — are short enough to read as labels. They are not:
      // they belong to the loop below, and a brief that opens straight into
      // "FAQs[8.0]" has no front matter at all.
      var joined = cells.join('\t').trim();
      if (/\[\d+\.\d+\]\s*$/.test(joined) || /^(?:HERO\s*:\s*)?AEM Assets\s*[-\u2013]/i.test(joined)) break;

      // A bullet row carries one more value for the row above it — how a
      // brief writes four keywords or three internal links.
      if (BULLET_RE.test(filled[0].trim()) && fields.length) {
        fields[fields.length - 1].values = fields[fields.length - 1].values.concat(
          filled.slice(1).map(function (c) { return c.trim(); }).filter(Boolean));
        continue;
      }

      var head = (cells[0] || '').trim();
      var values = cells.slice(1).map(function (c) { return c.trim(); })
        .filter(function (c) { return c && !BULLET_RE.test(c); });

      // Colon form in a single cell. Only a known label, a URL, or a value
      // short enough not to be prose counts — without that guard a line like
      // "In this article: how long lifts last, how they age, and when ..."
      // would be eaten as a declaration. 60 is the same bar brief.js already
      // uses to tell a section heading from a sentence.
      if (cells.length === 1 && head.indexOf(':') !== -1) {
        var at = head.indexOf(':');
        var lab = head.slice(0, at).trim(), val = head.slice(at + 1).trim();
        if (labelShaped(lab) &&
            (fieldFor(pending + lab, labels) || /^https?:\/\//i.test(val) || val.length <= 60)) {
          push(pending + lab, val ? [val] : [], i + 1);
          pending = '';
          continue;
        }
        break;
      }

      // A pasted label can wrap: "Page Title/" on its own row, "Title Tag"
      // carrying the value on the next. Hold the first half for the second.
      if (cells.length === 1 && !values.length && labelShaped(head) && /\/$/.test(head)) {
        pending = head;
        continue;
      }

      if (labelShaped(pending + head)) {
        push(pending + head, values, i + 1);
        pending = '';
        continue;
      }

      break;
    }

    // The first row that is none of those ends the front matter for good.
    // Everything below it is copy, read exactly as it always was.
    return { fields: fields, copyFrom: i };
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

  var SECTION_ROLE_RE = /header|title|headline/i;
  var BODY_ROLE_RE = /\bbody\b|text|paragraph|description|content|copy/i;

  // A cell can hold more than one paragraph pasted into one spreadsheet cell
  // (Alt+Enter), the same shape a quoted multi-line .xlsx cell now produces
  // once readXlsx quotes it correctly. Splitting on the blank line between
  // paragraphs — rather than assuming one column is one paragraph — means
  // this reads correctly whether the sheet keeps each paragraph in its own
  // column or folds several into one cell.
  function paragraphsOf(text) {
    return String(text).split(/\n\s*\n+/).map(function (s) { return s.trim(); }).filter(Boolean);
  }

  // Each row of a markets-by-field table is one market's own copy — a
  // header text and a body text, scoped to that market. The raw tab-join of
  // the whole row is never used as an expectation: that pollutes the body
  // text with the row's own identity columns (the country name, the
  // language name), which is exactly what made a genuinely correct
  // translation report as "not found on the page".
  function readMarketsByField(rows, shape) {
    var expect = { mode: 'markets-by-field', metadata: {}, sections: [], body: [], images: [], links: [], frontMatter: [], shapeNote: shape.reason };
    var header = shape.headerCells;
    var unclassified = [];

    var roles = header.map(function (label, i) {
      if (i === 0) return 'identity';
      if (SECTION_ROLE_RE.test(label)) return 'section';
      if (BODY_ROLE_RE.test(label)) return 'body';
      unclassified.push(label);
      return null;
    });
    if (unclassified.length) expect.unclassifiedColumns = unclassified;

    shape.dataRows.forEach(function (rowIndex) {
      var cells = rows[rowIndex];
      var market = (cells[0] || '').trim() || null;
      roles.forEach(function (role, i) {
        var v = (cells[i] || '').trim();
        if (!v || (role !== 'section' && role !== 'body')) return;
        paragraphsOf(v).forEach(function (p) {
          expect[role === 'section' ? 'sections' : 'body'].push(want(p, market, rowIndex + 1));
        });
      });
    });

    return expect;
  }

  function readBrief(text, workTypeId, config) {
    text = String(text == null ? '' : text);
    var expect = { mode: null, metadata: {}, sections: [], body: [], images: [], links: [], frontMatter: [] };
    var i, m;

    if (workTypeId === 'localization') {
      // Localization briefs arrive several ways: a table with one row per
      // content field and one column per market, a table transposed the
      // other way — one row per market, one column per field — or the
      // localized copy as prose. Read the table's own shape rather than
      // assuming which of the first two it is.
      var rows = splitRows(text);
      var shape = Brief.detectOrientation(rows, config);
      if (shape.orientation === 'markets-by-field') {
        return readMarketsByField(rows, shape);
      }
      var tabular = rows.filter(function (r) { return r.length >= 3; }).length;
      if (tabular < 2) {
        expect.mode = 'prose';
        // Prose asserts nothing about structure. A short line in a prose brief
        // is as likely to be a stat, a CTA label or a market name as a
        // heading, and calling every line under 80 characters a section put 39
        // findings in the structure category on a page that had none of them.
        rows.forEach(function (r, i) {
          var v = r.join(' ').trim();
          if (v.length >= 40) expect.body.push(want(v, null, i + 1));
        });
        return expect;
      }
      expect.mode = 'columns';
      expect.metadata.title = localisedRow(rows, 'Meta title');
      expect.metadata.pageName = localisedRow(rows, 'Page name');
      expect.metadata.description = localisedRow(rows, 'Meta description');
      expect.metadata.keywords = localisedRow(rows, 'Meta keywords');
      var sectionAt = sectionsByRow(rows);
      ['Headline', 'Subheading', 'Title', 'Body'].forEach(function (label) {
        rows.forEach(function (cells, i) {
          if (cells.length >= 3 && normalise(cells[0]).toLowerCase() === label.toLowerCase()) {
            var v = cells[cells.length - 1].trim();
            if (!v) return;
            var w = want(v, sectionAt[i], i + 1);
            if (label === 'Headline' || label === 'Title') expect.sections.push(w);
            else expect.body.push(w);
          }
        });
      });
      // A localization brief carries the CTA label and the CTA destination on
      // separate rows ("CTA / Learn more" then "CTA Link / /digital-services/").
      // Pairing them in order is what lets the comparer check where a button
      // actually points, not just what it says.
      var labels = [], hrefs = [];
      rows.forEach(function (cells, i) {
        if (cells.length < 3) return;
        var key = normalise(cells[0]);
        if (!/^cta\b/i.test(key)) return;
        var value = cells[cells.length - 1].trim();
        if (!value) return;
        if (/link/i.test(key)) hrefs.push(value);
        else labels.push({ value: value, section: sectionAt[i], row: i + 1 });
      });
      labels.forEach(function (label, i) {
        var href = hrefs[i];
        // Only treat it as a destination if it looks like one — these rows
        // sometimes hold prose ("Anchor link to the tech specs table").
        var looksLikeUrl = href && /^(https?:\/\/|\/)/.test(href);
        expect.links.push({
          text: label.value, href: looksLikeUrl ? href : null,
          section: label.section, row: label.row
        });
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
    var briefRows = splitRows(text);
    var labels = (config && config.compare && config.compare.briefLabels) || DEFAULT_BRIEF_LABELS;
    var front = frontMatter(briefRows, labels);

    front.fields.forEach(function (f) {
      var value = f.values.join(', ');
      if (f.field === 'title' || f.field === 'pageName' ||
          f.field === 'description' || f.field === 'canonical') {
        if (value) expect.metadata[f.field] = value;
      } else if (f.field === 'keywords') {
        if (value) expect.metadata.keywords = value;
      } else if (f.field === 'topic') {
        // The H1 the page has to carry as a heading, which is a different
        // assertion from the same words appearing somewhere in the copy.
        if (value) expect.sections.push(want(value, null, f.row));
      } else if (f.field === 'image') {
        f.values.forEach(function (v) { expect.images.push(want(v, null, f.row)); });
      } else if (f.field === 'links') {
        f.values.forEach(function (v) {
          expect.links.push({ text: v, href: /^(https?:\/\/|\/)/.test(v) ? v : null, section: null, row: f.row });
        });
      } else {
        // A label the vocabulary does not know is never silently dropped: it
        // is kept out of the body copy, and named on the Metadata block so an
        // author can see the tool read the row and made nothing of it.
        expect.frontMatter.push({ label: f.label, value: value || null, row: f.row });
      }
    });

    var lines = briefRows.map(function (r) { return r.join('\t'); });
    for (i = front.copyFrom; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;

      m = /^(.*?)\s*\[\d+\.\d+\]\s*$/.exec(line);
      if (m && m[1]) { expect.sections.push(want(m[1].trim(), null, i + 1)); continue; }

      m = /^(?:HERO\s*:\s*)?AEM Assets\s*[-–]\s*(.+)$/i.exec(line);
      if (m) { expect.images.push(want(m[1].trim(), null, i + 1)); continue; }

      if (line.length >= 40) expect.body.push(want(line, null, i + 1));
    }
    return expect;
  }

  // ─── BRIEF FROM A BUILT PAGE ─────────────────────────────────────────────
  // The inverse of readBrief: given the markup of a page somebody already
  // built, write the brief that describes it. Useful for re-briefing a page
  // into another market, for handing a translator a source of truth, and for
  // pages where the brief was never kept.
  //
  // It emits the vocabulary readBrief parses, which makes the whole thing a
  // round trip: generate a brief from a page, compare it back against that
  // same page, and the report should be empty. Where it is not, that is a gap
  // worth knowing about — so nothing here is trimmed to whatever happens to
  // compare clean.
  //
  // The one rule it never breaks: it does not invent. A field the page does
  // not carry produces no row at all, rather than an empty one that would
  // read as "the brief asked for nothing here".

  // What to call an asset in the brief. assetIdentity() is a match key —
  // lowercased and stripped of punctuation — which is unreadable in a
  // document, so the name keeps the file's own spelling and only has to
  // resolve back to the same key.
  function assetName(src) {
    var v = String(src == null ? '' : src).trim().replace(/[?#].*$/, '').split('/').pop();
    try { v = decodeURIComponent(v); } catch (e) { /* not valid encoding: keep as-is */ }
    return v.replace(/:.*$/, '').replace(/\.(jpe?g|png|webp|gif|svg|avif)$/i, '').trim();
  }

  function internalLinks(page, cfg) {
    var host = pageHost(page.canonical || '');
    var seen = {}, out = [];
    (page.links || []).forEach(function (l) {
      var href = String(l.href || '').trim();
      if (!href) return;
      // Relative hrefs are this site by definition; absolute ones only count
      // when they point at the page's own host, so the chrome's social and
      // partner links never arrive as internal links.
      var absolute = /^https?:\/\//i.test(href);
      if (absolute && (!host || pageHost(href) !== host)) return;
      if (!absolute && href.charAt(0) !== '/') return;
      // A link into the CME, or an unpublished author path, is a defect the
      // comparer reports on this very page. Briefing it would be asking the
      // next page to reproduce the bug.
      var editor = (cfg && cfg.editorLinkPattern) || '/ui/editor/item\\?item=';
      if (new RegExp(editor, 'i').test(href)) return;
      if (/^https?:\/\/[^/]*author|\/content\//i.test(href)) return;
      var key = pathOf(href);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push(href);
    });
    return out;
  }

  function briefFrom(html, cfg) {
    var page = readPage(html, cfg);
    var lines = [], notes = {
      fields: [], sections: 0, paragraphs: 0, images: 0,
      links: 0, hiddenHeadings: 0, unnamedImages: [],
      regionVia: page.regionVia
    };

    function field(label, value) {
      if (value == null || String(value).trim() === '') return;
      lines.push(label + '\t' + String(value).trim());
      notes.fields.push(label);
    }

    field('Page Title/Title Tag', page.metaTitle || page.pageName);
    field('Page Name', page.pageName);
    field('Meta Description/Meta Tag', page.description);
    field('Meta Keywords', page.keywords);
    field('URL Path', page.canonical);

    var hrefs = internalLinks(page, cfg);
    notes.links = hrefs.length;
    hrefs.forEach(function (href, i) {
      lines.push((i === 0 ? 'Internal Links\t' : '') + '\u25CF\t' + href);
    });
    if (hrefs.length) notes.fields.push('Internal Links');

    // Headings, copy and images merged into one stream and read in the order
    // the page renders them, so every paragraph lands under its own heading.
    var stream = [];
    (page.headings || []).forEach(function (h) {
      // The template stamps the window title into several display:none H2s.
      // A brief must not ask for a heading nobody can see.
      if (h.hidden) { notes.hiddenHeadings++; return; }
      if (h.text) stream.push({ kind: 'heading', level: h.level, text: h.text, at: h.at });
    });
    (page.paragraphs || []).forEach(function (p) {
      stream.push({ kind: 'copy', text: p.text, at: p.at });
    });
    (page.images || []).forEach(function (img) {
      var name = assetName(img.src);
      // An asset whose name cannot be read out of its src is reported rather
      // than guessed at — a made-up name in a brief is worse than none.
      if (!name) { notes.unnamedImages.push(img.src); return; }
      stream.push({ kind: 'image', text: name, at: img.at });
    });
    stream.sort(function (a, b) { return a.at - b.at; });

    var major = 0, minor = 0;
    if (lines.length) lines.push('');
    stream.forEach(function (item) {
      if (item.kind === 'heading') {
        if (item.level === 'h3') minor++;
        else { major++; minor = 1; }
        lines.push(item.text + '[' + major + '.' + minor + ']');
        notes.sections++;
      } else if (item.kind === 'image') {
        lines.push('AEM Assets - ' + item.text);
        notes.images++;
      } else {
        lines.push(item.text);
        notes.paragraphs++;
      }
    });

    return { text: lines.join('\n'), notes: notes };
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

  // A terminator only ends a sentence when whitespace or the end of the text
  // follows it. Without that check every dot inside a URL was a sentence
  // boundary, and one brief row holding three internal links reported as four
  // missing paragraphs — "https://www.", "kone.", "com.", "au/blogs/x.".
  function sentencesOf(text) {
    var s = String(text == null ? '' : text), out = [], start = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch !== '.' && ch !== '!' && ch !== '?') continue;
      var next = s.charAt(i + 1);
      if (next && !/\s/.test(next)) continue;
      var part = s.slice(start, i + 1).trim();
      if (part.length >= 25) out.push(part);
      start = i + 1;
    }
    var tail = s.slice(start).trim();
    if (tail.length >= 25) out.push(tail);
    return out;
  }

  // ─── COMPARING ───────────────────────────────────────────────────────────

  // Presence is not enough. Every check here used to ask "does this appear at
  // all", so two brief rows carrying the same line both resolved against a
  // single occurrence on the page and a missing component reported as
  // complete. What the brief asks for twice, the page has to carry twice.

  function occurrences(haystack, needle) {
    if (!needle) return 0;
    var n = 0, at = 0;
    while ((at = haystack.indexOf(needle, at)) !== -1) { n++; at += needle.length; }
    return n;
  }

  function groupWants(items) {
    var groups = [], index = {};
    items.forEach(function (it) {
      var key = normalise(it.text).toLowerCase();
      if (!key) return;
      if (!index[key]) { index[key] = { key: key, text: it.text, wants: [] }; groups.push(index[key]); }
      index[key].wants.push(it);
    });
    return groups;
  }

  // "Proof point, row 34; Sustentabilidade, row 51" — so an author can open
  // both places the brief asked for it rather than guessing which one is short.
  function whereFrom(wants) {
    var seen = {}, parts = [];
    wants.forEach(function (w) {
      var s = w.section && w.row ? w.section + ', row ' + w.row
            : w.row ? 'row ' + w.row
            : w.section || '';
      if (s && !seen[s]) { seen[s] = 1; parts.push(s); }
    });
    return parts.join('; ');
  }

  function countFindings(group, pageCount, out) {
    var briefCount = group.wants.length;
    var where = whereFrom(group.wants);

    if (pageCount < briefCount) {
      out.push({
        expected: group.text,
        note: 'the brief asks for this ' + briefCount + ' times and the page carries it ' +
              pageCount + (where ? ' — ' + where : ''),
        severity: 'break',
        fromBrief: true,
        missing: briefCount - pageCount
      });
      return;
    }
    if (pageCount > briefCount) {
      // The reverse question, and a noisier one: templates repeat copy in
      // teasers and related-content rails. Worth a look, not a defect.
      out.push({
        expected: group.text,
        note: 'the page carries this ' + pageCount + ' times and the brief asks for it ' + briefCount,
        severity: 'check',
        fromBrief: false
      });
    }
  }


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
        want: expect.metadata.keywords, got: page.keywords, matches: sameList }
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

    // Neither of these needs the brief: the page contradicts itself.
    if (page.lang && page.dataLang && page.lang.toLowerCase().slice(0, 2) !== page.dataLang.toLowerCase().slice(0, 2)) {
      out.push({
        field: 'Page language', expected: page.lang, found: page.dataLang,
        note: 'the page is served as lang="' + page.lang + '" but the template carries data-lang="' +
              page.dataLang + '" — the two disagree, and analytics and search read the second',
        severity: 'break'
      });
    }

    if (page.h1.length === 0) out.push({ field: 'H1', expected: null, found: null, note: 'the page has no H1', severity: 'break' });
    else if (page.h1.length > 1) {
      out.push({ field: 'H1', expected: 'one H1', found: page.h1.join(' / '), note: page.h1.length + ' H1 tags on the page', severity: 'break' });
    }
    return out;
  }

  // Which component a piece of brief copy landed in. The whole-region count
  // stays the authority on found-or-missing: a page built without module
  // sections has no components to search, and summing per module would report
  // every row missing. This only answers "where".

  function bodyMatches(expect, page) {
    var pageText = normalise(page.text);
    var mods = (page.modules || []).map(function (m) {
      var suffix = componentSuffix(m);
      return { label: moduleLabel(m) + (suffix ? ' · ' + suffix : ''), text: normalise(m.text) };
    });
    function locate(needle) {
      var hit = mods.filter(function (m) { return m.text.indexOf(needle) !== -1; })[0];
      return hit ? hit.label : null;
    }

    var cleaned = expect.body.map(function (w) {
      return { text: unwrapQuotes(w.text), section: w.section, row: w.row };
    }).filter(function (w) { return w.text; });

    var groups = groupWants(cleaned).map(function (group) {
      var needle = normalise(group.text);
      var pageCount = occurrences(pageText, needle);
      var parts = [], absent = [], where = null, status;

      if (pageCount > 0) {
        status = 'found';
        where = locate(needle);
      } else {
        // Not there in one piece. That is usually the page splitting a
        // paragraph across elements rather than copy going missing, so descend
        // and report only the sentences that are genuinely absent.
        parts = sentencesOf(group.text);
        absent = parts.filter(function (part) { return occurrences(pageText, normalise(part)) === 0; });
        if (parts.length && !absent.length) {
          status = 'found';
          pageCount = 1;
          where = locate(normalise(parts[0]));
        } else if (parts.length && absent.length < parts.length) {
          // Some sentences are genuinely on the page, some are not — neither
          // a clean pass nor a total miss. Reported as its own status so it
          // never reads identically to a row that is 100% absent.
          status = 'partial';
          where = locate(normalise(parts.filter(function (p) { return absent.indexOf(p) === -1; })[0]));
        } else {
          status = 'missing';
        }
      }
      return { group: group, status: status, in: where, pageCount: pageCount, parts: parts, absent: absent };
    });

    var index = {};
    groups.forEach(function (g) { index[g.group.key] = g; });

    // One entry per brief row, in the brief's own order, whether it matched or
    // not — the passing side of the comparison, which the report has never
    // shown. An author could see that a row failed but never that it was
    // checked, or where it landed.
    var ledger = cleaned.map(function (w) {
      var g = index[normalise(w.text).toLowerCase()];
      var entry = {
        row: w.row, section: w.section, text: w.text,
        status: g ? g.status : 'missing',
        in: g ? g.in : null,
        between: null
      };
      // Only meaningful for 'partial' — how many sentences this row split
      // into and how many of them are genuinely on the page, so a partial
      // row can say what's actually missing rather than just "partial".
      if (g && g.status === 'partial') { entry.partsTotal = g.parts.length; entry.partsFound = g.parts.length - g.absent.length; }
      return entry;
    });
    bracket(ledger);

    return { groups: groups, ledger: ledger };
  }

  // A missing row is placed by the rows around it that did match: the nearest
  // located row above and below name the span it belongs in. Derived from the
  // matches, never guessed — with nothing either side, it says nothing.
  function bracket(ledger) {
    ledger.forEach(function (entry, i) {
      if (entry.status !== 'missing') return;
      var before = null, after = null, j;
      for (j = i - 1; j >= 0; j--) { if (ledger[j].in) { before = ledger[j].in; break; } }
      for (j = i + 1; j < ledger.length; j++) { if (ledger[j].in) { after = ledger[j].in; break; } }
      if (before || after) entry.between = [before, after];
    });
  }

  function bodyDeviations(expect, page, matches) {
    matches = matches || bodyMatches(expect, page);
    var out = [];

    matches.groups.forEach(function (g) {
      var group = g.group;
      var where = whereFrom(group.wants);

      if (g.status === 'found') { countFindings(group, g.pageCount, out); return; }

      if (!g.parts.length) {
        out.push({
          expected: group.text,
          note: 'not found on the page' + (where ? ' — ' + where : ''),
          severity: 'break', fromBrief: true, missing: group.wants.length
        });
        return;
      }
      // Each genuinely absent fragment is still reported on its own — an
      // author needs to see every one — but a row counts once against
      // coverage however many fragments it splits into. This was pushing
      // group.wants.length on every fragment, so a row that split into 3
      // absent sentences over-counted coverage by 3x.
      g.absent.forEach(function (part, idx) {
        out.push({
          expected: part,
          note: 'not found on the page' + (where ? ' — ' + where : ''),
          severity: 'break', fromBrief: true, missing: idx === 0 ? group.wants.length : 0
        });
      });
    });

    return out.concat(fieldDeviations(expect, page));
  }

  // What the page carries, read field by field rather than as one blob of
  // text. Both of these name the CMS field an author has to open, because the
  // page states it — neither can be expressed as a brief row number.

  var ASSET_FIELD_RE = /image|url|dam|src|asset/i;

  function fieldDeviations(expect, page) {
    var out = [];
    var briefText = expect.body.concat(expect.sections)
      .map(function (w) { return w.text; }).join(' ');
    // Only a brief written in something other than English can tell us that
    // English on the page is untranslated. An English brief says nothing.
    var localizing = briefText.length > 0 && !looksEnglish(briefText);

    (page.modules || []).forEach(function (mod) {
      mod.fields.forEach(function (field) {
        // Same builder the offset-based findings use, so a field finding and a
        // link finding in the same component read identically.
        var place = placeOf(mod, field.path);

        function report(finding) {
          finding.where = place.where;
          if (place.anchor) finding.anchor = place.anchor;
          if (place.componentId) finding.componentId = place.componentId;
          if (place.moduleHeading) finding.moduleHeading = place.moduleHeading;
          out.push(finding);
        }

        if (!field.value) {
          // An asset field holds a URL the image checks already cover; an
          // empty text field is a component shipped with a hole in it.
          if (ASSET_FIELD_RE.test(field.path)) return;
          report({
            expected: null, found: null,
            note: 'this field is empty on the page — the component was published without it',
            severity: 'break'
          });
          return;
        }

        if (localizing && looksEnglish(field.value)) {
          report({
            expected: null, found: field.value,
            note: 'this field reads as English on a page the brief localizes — it was never translated',
            severity: 'break'
          });
        }
      });
    });
    return out;
  }

  function imageDeviations(expect, page, variantPattern) {
    var out = [];
    var onPage = page.images.map(function (img) { return assetIdentity(img.src, variantPattern); })
      .filter(function (id) { return id.length > 0; });

    expect.images.forEach(function (w) {
      var name = w && w.text !== undefined ? w.text : w;
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
      if (!img.src) out.push(at({ expected: null, found: img.alt || '(no alt)', note: 'image tag with no src', severity: 'break' }, page, img.at));
      else if (!img.alt) out.push(at({ expected: null, found: img.src, note: 'image has no alt text', severity: 'break' }, page, img.at));
    });
    return out;
  }

  // Every link the brief asks for, matched or not, in the brief's own order —
  // the same passing side of the comparison the body text has had since the
  // ledger was added. A links block that said "No deviations" could not show
  // that three internal links had actually been found, or where they landed.

  function linkMatches(expect, page) {
    var out = [], ledger = [], claimed = [];

    expect.links.forEach(function (want) {
      // A brief that declares a bare URL has no anchor text to match on, and
      // the page's own anchor reads "KONE elevator modernisation". Matching
      // those by label reported three present links as missing; a want with
      // no label of its own is matched by where it points instead.
      var hrefOnly = !!want.href && same(want.text, want.href);
      var byText = page.links.filter(function (l, idx) {
        return claimed.indexOf(idx) === -1 &&
          (hrefOnly ? samePath(l.href, want.href) : same(l.text, want.text));
      })[0];
      if (byText) claimed.push(page.links.indexOf(byText));

      var entry = {
        row: want.row, section: want.section,
        text: want.text + (want.href && !hrefOnly ? ' → ' + want.href : ''),
        status: byText ? 'found' : 'missing', in: null, where: null, between: null
      };
      ledger.push(entry);

      if (!byText) {
        // The anchor may be on the page but held back as a placeholder. That
        // is one defect, and it is already reported below — saying the link is
        // also missing would report the same anchor twice.
        var asPlaceholder = (page.placeholderLinks || []).filter(function (l) { return same(l.text, want.text); })[0];
        entry.where = asPlaceholder
          ? 'on the page, but as a placeholder that goes nowhere'
          : 'no anchor on the page ' + (hrefOnly ? 'points here' : 'carries this label');
        if (!asPlaceholder) {
          var where = whereFrom([want]);
          out.push({
            expected: want.text, found: null,
            note: 'link not found on the page' + (where ? ' — ' + where : ''),
            severity: 'break', fromBrief: true, missing: 1
          });
        }
        return;
      }

      entry.in = byText.text || byText.href;
      entry.where = hrefOnly
        ? 'found as “' + byText.text + '”'
        : 'found, pointing at ' + (byText.href || 'nothing');

      if (want.href && !hrefOnly && !samePath(byText.href, want.href)) {
        entry.status = 'missing';
        entry.where = 'found, but pointing at ' + byText.href;
        out.push({ expected: want.text + ' → ' + want.href, found: byText.href, note: 'points somewhere else', severity: 'break', fromBrief: true });
      }
    });

    return { deviations: out, ledger: ledger };
  }

  function linkDeviations(expect, page, cfg, linkMatch) {
    var out = (linkMatch || linkMatches(expect, page)).deviations.slice();
    page.links.forEach(function (l) {
      if (/^https?:\/\/[^/]*author|\/content\//i.test(l.href)) {
        out.push(at({
          expected: null, found: l.href,
          note: 'author or /content/ path published to the live page', severity: 'break'
        }, page, l.at));
      }
      // The Tridion twin of the same defect: a link into the CME editor,
      // authored into body copy where a document link belongs.
      var editor = (cfg && cfg.editorLinkPattern) || '/ui/editor/item\\?item=';
      if (new RegExp(editor, 'i').test(l.href)) {
        out.push(at({
          expected: null, found: l.href,
          note: 'this links into the CMS editor, not to a published page — an author pasted a CME URL',
          severity: 'break'
        }, page, l.at));
      }
    });

    // Neither of these needs the brief to be right about them.
    (page.placeholderLinks || []).forEach(function (l) {
      out.push(at({
        expected: null,
        found: l.text || '(no label)',
        note: l.href === '#' ? 'link still points at the placeholder href="#"' : 'link has no destination',
        severity: 'break'
      }, page, l.at));
    });
    (page.deadCtas || []).forEach(function (cta) {
      out.push(at({
        expected: null, found: cta.text,
        note: 'call to action is bare text with no link', severity: 'break'
      }, page, cta.at));
    });
    return out;
  }

  function structureDeviations(expect, page) {
    var out = [];

    // A heading that appears twice is a structural fault and needs no brief to
    // be one, so it is reported whether or not the brief listed any sections.
    // A heading nobody can see is not a duplicate anyone can read. The KONE
    // template stamps the window title into several display:none H2s, which
    // reported as three duplicates on a page that renders one.
    var seen = {};
    page.headings.filter(function (h) { return !h.hidden; }).forEach(function (h) {
      var k = normalise(h.text).toLowerCase();
      if (!k) return;
      if (seen[k]) {
        if (seen[k] === 1) {
          out.push(at({
            expected: h.text,
            note: 'this heading appears more than once on the page', severity: 'break'
          }, page, h.at));
        }
        seen[k]++;
      } else seen[k] = 1;
    });

    if (!expect.sections.length) return out;

    // A brief's numbered section marker (Emergency Braking Systems[2.1]) is
    // the same shape whether the page renders it as a real h1-h3 or as an
    // accordion question with no heading tag at all — a KONE AEM template
    // does the latter. Both count as "a heading the brief asked for exists
    // here", so the presence and order checks read a pool of both, merged
    // back into document order by offset. The duplicate-heading check above
    // is untouched: that one is about real HTML structure, and an accordion
    // legitimately reuses the same button markup for every question.
    var pageHeadings = page.headings
      .concat(page.triggerHeadings || [])
      .sort(function (a, b) { return a.at - b.at; })
      .map(function (h) { return normalise(h.text).toLowerCase(); });

    groupWants(expect.sections).forEach(function (group) {
      var pageCount = pageHeadings.filter(function (h) { return h === group.key; }).length;
      var where = whereFrom(group.wants);
      if (pageCount === 0) {
        out.push({
          expected: group.text,
          note: 'section heading missing from the page' + (where ? ' — ' + where : ''),
          severity: 'break', fromBrief: true, missing: group.wants.length
        });
        return;
      }
      countFindings(group, pageCount, out);
    });

    // Order is checked on the brief's sequence, independently of the counts.
    var cursor = -1;
    expect.sections.forEach(function (w) {
      var at = pageHeadings.indexOf(normalise(w.text).toLowerCase());
      if (at === -1) return;
      if (at < cursor) {
        out.push({ expected: w.text, note: 'section appears out of the brief\'s order', severity: 'break', fromBrief: true });
      }
      cursor = Math.max(cursor, at);
    });
    return out;
  }

  // Real defects first, things to glance at second — a reviewer should never
  // have to read past a low-priority check to find a break.
  function ordered(list) {
    return list.slice().sort(function (a, b) {
      var rank = { 'break': 0, 'check': 1 };
      return (rank[a.severity] || 0) - (rank[b.severity] || 0);
    });
  }

  // The one place the five categories are built, in their final order. Both
  // the normal comparison and the two guards that fall back to page-only
  // checks call this, so a reorder or a new category is one array to
  // change — not two that have to be kept in sync by hand, which is exactly
  // how Structure could have ended up before Body Text in one path and
  // after it in the other.
  function buildCategories(expect, page, cfg) {
    var bodyMatch = bodyMatches(expect, page);
    var linkMatch = linkMatches(expect, page);
    return [
      { id: 'metadata', label: 'Metadata', deviations: ordered(metadataDeviations(expect, page)) },
      { id: 'structure', label: 'Structure', deviations: ordered(structureDeviations(expect, page)) },
      { id: 'body', label: 'Body Text', ledger: bodyMatch.ledger,
        deviations: ordered(bodyDeviations(expect, page, bodyMatch)) },
      { id: 'images', label: 'Images', deviations: ordered(imageDeviations(expect, page, cfg.assetVariantPattern)) },
      { id: 'links', label: 'Hyperlinks / CTAs', ledger: linkMatch.ledger,
        deviations: ordered(linkDeviations(expect, page, cfg, linkMatch)) }
    ];
  }

  // The five categories with every brief-derived finding removed — what the
  // page says about itself. Used by both guards: a brief that could not be
  // read and a brief that was read wrongly should still surface these.

  function pageOnlyCategories(page, cfg) {
    var expect = { mode: null, metadata: {}, sections: [], body: [], images: [], links: [], frontMatter: [] };
    var categories = buildCategories(expect, page, cfg);
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

  // ─── PICKING A BRIEF ─────────────────────────────────────────────────────
  // Compare has always assumed one brief matches one page. This answers
  // "which of several candidate briefs actually goes with this page" —
  // a ranking step that runs before the ordinary compare() above, not a new
  // mode of it: compare()'s one-brief-one-page contract is untouched.

  // What a brief itself declares about which page it targets: an explicit
  // URL Path if it has one (new-page/content-update briefs), else a
  // declared target market resolved to a domain (localization briefs).
  // Null when the brief declares neither — it isn't disqualified, it just
  // carries no fast-path evidence and falls to coverage scoring below.
  function declaredSignal(text, workTypeId, marketConfig) {
    var expect = readBrief(text, workTypeId, marketConfig);
    if (expect.metadata.canonical) {
      return { kind: 'url', path: pathOf(expect.metadata.canonical),
        label: 'declares URL Path ' + expect.metadata.canonical };
    }
    var model = Brief.parse(text, marketConfig);
    var market = model.targetMarket && Brief.marketOf(model, model.targetMarket);
    if (market) {
      return { kind: 'market', domain: market.domain.toLowerCase(),
        label: 'declares market ' + model.targetMarket + ' (' + market.domain + ')' };
    }
    return null;
  }

  function create(config) {
    var cfg = (config && config['work-types'] && config['work-types'].compare) || {};
    var supported = cfg.workTypes || ['new-page', 'localization', 'content-update', 'keyword-update'];
    var workTypesConfig = (config && config['work-types']) || {};

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
      var expect = readBrief(briefText, workTypeId, workTypesConfig);

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

      var categories = buildCategories(expect, page, cfg);

      // The question the tool exists to answer is not "what is different" but
      // "is everything the brief asked for actually on the page". Counting that
      // is what makes the two failure modes legible without a heuristic: zero
      // of zero is a brief that did not parse, and two of seventy-four is a
      // brief that parsed wrongly. Both used to need a special guard to read.
      // Count the occurrences that are short, not the findings — one finding can
      // stand for a line the brief asked for twice and the page carries once.
      var briefFailures = 0;
      categories.forEach(function (c) {
        c.deviations.forEach(function (d) {
          // A deviation with no missing count at all defaults to 1 — most
          // deviations never set it. An explicit 0 must stay 0: that's how
          // a row's second and later absent fragments say "already counted
          // by the first one", and `d.missing || 1` was silently turning
          // that 0 back into a 1, over-counting a multi-sentence miss.
          if (d.fromBrief) briefFailures += (d.missing != null ? d.missing : 1);
        });
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
      // A front-matter row whose label the tool does not recognise is kept out
      // of the body copy, which means it is also never compared against
      // anything. Saying so is the difference between a row that was checked
      // and a row that was quietly ignored.
      if (expect.frontMatter && expect.frontMatter.length) {
        var unread = expect.frontMatter.map(function (f) { return f.label; }).join(', ');
        categories[0].note = (categories[0].note ? categories[0].note + ' ' : '') +
          'The brief also declares ' + unread + ' — not a field this tool knows how to check, so ' +
          (expect.frontMatter.length === 1 ? 'it was' : 'they were') + ' read as front matter and left alone.';
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

    // candidates: [{id, label, text, workTypeId}] — workTypeId supplied by
    // the caller, which already classifies each brief via engine.analyse()
    // before calling compare() today; this stays engine-agnostic, the same
    // boundary compare.js already keeps.
    //
    // Never picks silently, the same shape filler.js's find() already
    // established: how names which signal decided, candidates always carry
    // every candidate's evidence, picked is null whenever it isn't sure.
    // "Confident" reuses engine.js's classify() rule — the winner beats the
    // runner-up outright, or there is no runner-up — rather than inventing
    // a margin to defend later.
    function pickBrief(candidates, html) {
      var page = readPage(html, cfg);
      var pagePath = pathOf(page.canonical || '');
      var host = pageHost(page.canonical);

      var declared = candidates.map(function (c) {
        var sig = declaredSignal(c.text, c.workTypeId, workTypesConfig);
        var matches = !!sig && !!page.canonical &&
          (sig.kind === 'url' ? sig.path === pagePath : host === sig.domain);
        return { candidate: c, signal: sig, matches: matches };
      });
      var urlHits = declared.filter(function (d) { return d.matches; });

      if (urlHits.length === 1) {
        return {
          how: 'declared-url', picked: urlHits[0].candidate,
          reason: urlHits[0].candidate.label + ' ' + urlHits[0].signal.label + ', which matches the page.',
          candidates: declared.map(function (d) {
            return { id: d.candidate.id, label: d.candidate.label, declared: d.signal, matches: d.matches, coverage: null };
          })
        };
      }

      // No declared match, or more than one — content coverage decides.
      // Both of compare()'s early-return shapes (unsupported work type,
      // unreadable brief) carry no coverage field at all, which scores 0
      // here — exactly right: a candidate this can't even read loses the
      // ranking on its own.
      var scored = candidates.map(function (c) {
        var result = compare(c.text, html, { workTypeId: c.workTypeId });
        var score = (result.coverage && result.coverage.total) ? result.coverage.found / result.coverage.total : 0;
        return {
          candidate: c, score: score,
          declared: (declared.filter(function (d) { return d.candidate === c; })[0] || {}).signal || null
        };
      }).sort(function (a, b) { return b.score - a.score; });

      if (!scored.length) return { how: 'none', picked: null, reason: 'No candidate briefs given.', candidates: [] };

      var top = scored[0], runnerUp = scored[1];
      var confident = top.score > 0 && (!runnerUp || top.score > runnerUp.score);
      var candOut = scored.map(function (s) {
        return { id: s.candidate.id, label: s.candidate.label, declared: s.declared, matches: false, coverage: s.score };
      });

      if (confident) {
        return {
          how: 'coverage', picked: top.candidate,
          reason: top.candidate.label + ' covers ' + Math.round(top.score * 100) + '% of the page, ahead of the rest.',
          candidates: candOut
        };
      }
      return {
        how: 'ambiguous', picked: null,
        reason: urlHits.length > 1
          ? urlHits.length + ' briefs all declare a URL that matches this page, and content coverage does not separate them either.'
          : 'No brief declares a URL or market that matches this page, and content coverage does not separate them clearly.',
        candidates: candOut
      };
    }

    return {
      compare: compare,
      pickBrief: pickBrief,
      readPage: function (h) { return readPage(h, cfg); },
      readBrief: readBrief,
      briefFrom: function (h) { return briefFrom(h, cfg); },
      // Exposed so a test can assert a location without a defect to hang it
      // on — the id-less carousel ships no defect on the real page.
      placeIn: placeOf,
      splitRows: splitRows,
      normalise: normalise,
      pathOf: pathOf,
      assetIdentity: function (v) { return assetIdentity(v, cfg.assetVariantPattern); }
    };
  }

  return { create: create };
}));

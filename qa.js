/* qa.js — QA a built page on its own, no brief.
 *
 * Compare answers "does the page match the brief". QA answers the other
 * question a release needs: "is this page sound by itself". It starts from
 * every page-only finding compare.js already makes (placeholder links, dead
 * CTAs, CME and author links, images without alt, duplicate headings, the
 * Form Assembly ID) and adds the checks the WCM Page QA Framework names as
 * must-haves: robots against digitalData, title duplication, internal-host
 * leakage and mixed content, hreflang, an .aspx canonical, a single H1, and
 * link text a screen reader can use.
 *
 * Every check is a pure function of the page. Where the page came from — a
 * paste, the bookmarklet, or (later) a backend fetch — is not its business.
 *
 * Findings are grouped under the framework's five categories. The four
 * issues the framework calls known template defects are kept apart and never
 * counted against the page: a page is not failed for its template.
 *
 * Runs in the browser (window.BriefQA) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./compare.js'), require('./linkmatch.js'), require('./proof.js'));
  } else root.BriefQA = factory(root.BriefCompare, root.BriefLinks, root.BriefProof);
}(typeof self !== 'undefined' ? self : this, function (Compare, Links, Proof) {
  'use strict';

  var DEFAULT_QA = {
    internalHosts: ['preview.kone', 'preview-training.kone', 'web-cms.kone.com', 'staging', '-dev.',
      'localhost', '127.0.0.1'],
    genericLinkText: [
      'click here', 'here', 'read more', 'more', 'learn more', 'find out more', 'this link', 'link',
      'clicca qui', 'qui', 'leggi di più', 'scopri di più', 'scopri',
      'haga clic aquí', 'aquí', 'leer más', 'más información',
      'clique aqui', 'aqui', 'saiba mais', 'leia mais',
      'hier klicken', 'hier', 'mehr', 'weiterlesen', 'mehr erfahren',
      'cliquez ici', 'ici', 'en savoir plus', 'lire la suite'
    ],
    // Redirects and load time, judged on what the backend saw: more
    // redirects than this is a fix; the HTML taking longer than slowMs, or
    // its first byte longer than slowTtfbMs, is a check.
    speed: { maxRedirects: 3, slowMs: 3000, slowTtfbMs: 800 },
    cme: {
      newUi: 'https://web-cms.kone.com/ui/editor/page?activeItem={id}&item={id}&tab=general.constraints',
      oldUi: 'https://web-cms.kone.com/WebUI/item.aspx?tcm=64#id={id}'
    }
  };

  var CATEGORIES = [
    ['metadata', 'Metadata'],
    ['body', 'Body text'],
    ['images', 'Images'],
    ['links', 'Hyperlinks'],
    ['structure', 'Structure']
  ];

  // ─── SMALL READERS ───────────────────────────────────────────────────────
  // Deliberately local rather than widening compare.js's readPage: the same
  // independent-pass convention page-model.js follows.

  function attr(tag, name) {
    var m = new RegExp('[\\s]' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i').exec(tag);
    if (!m) return null;
    return m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
  }

  function hostOf(url) {
    var m = /^(?:https?:)?\/\/([^/?#:]+)/i.exec(String(url || '').trim());
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  }

  // The same environment the framework's report template asks for, read off
  // the canonical host. A page with no canonical says so rather than being
  // assumed live.
  function environmentOf(canonical) {
    var host = hostOf(canonical);
    if (!host) return { id: 'unknown', label: 'Unknown', why: 'the page carries no canonical URL' };
    if (/^preview(-[a-z]+)?\./.test(host)) return { id: 'tridion-preview', label: 'Tridion preview', why: 'canonical is on ' + host };
    if (/(^|[.-])author[.-]|adobeaemcloud/.test(host)) return { id: 'aem-author', label: 'AEM author preview', why: 'canonical is on ' + host };
    return { id: 'production', label: 'Production', why: 'canonical is on ' + host };
  }

  function metaTag(html, name) {
    var re = new RegExp('<meta\\b[^>]*(?:name|property)\\s*=\\s*["\']' + name + '["\'][^>]*>', 'i');
    var m = re.exec(html);
    return m ? m[0] : null;
  }

  // ─── THE CHECKS ──────────────────────────────────────────────────────────
  // Each returns findings: { category, severity, field, note, expected,
  // found, known }. known marks a framework §8 template issue.

  function robotsFindings(facts, page) {
    var out = [];
    var robots = (facts.robots || '').toLowerCase();
    var noindex = /noindex/.test(robots), nofollow = /nofollow/.test(robots);
    var dd = page.digitalData;

    if (dd && (dd.indexOptions || dd.followLinksOptions)) {
      // An absent robots tag means index, follow — what a crawler assumes.
      var ddNoindex = dd.indexOptions ? /^no/i.test(dd.indexOptions) : noindex;
      var ddNofollow = dd.followLinksOptions ? /^no/i.test(dd.followLinksOptions) : nofollow;
      if (ddNoindex !== noindex || ddNofollow !== nofollow) {
        out.push({
          category: 'metadata', severity: 'check', field: 'Robots', known: true,
          expected: 'digitalData: ' + [dd.indexOptions, dd.followLinksOptions].filter(Boolean).join(', '),
          found: 'robots: ' + (facts.robots || '(no robots tag — index, follow)'),
          note: 'the robots meta tag and the digitalData object disagree about indexing — search engines follow the robots tag'
        });
      }
    }

    if (noindex && facts.environment.id === 'production') {
      out.push({
        category: 'metadata', severity: 'check', field: 'Robots', found: facts.robots,
        note: 'this production page tells search engines not to index it — confirm it is not meant to rank'
      });
    }
    return out;
  }

  var TITLE_SPLIT = /\s+[|\-\u2013\u2014]\s+/;

  function titleKey(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  // A doubled or partial site name in a title ("| KONE India - KONE India",
  // "| KONE - KONE Slovenija"), or null. Only the trailing segments carry the
  // site name; the first is the page's own subject and routinely contains
  // the brand ("KONE MonoSpace").
  function duplicateNote(title, normalise) {
    var parts = normalise(title).split(TITLE_SPLIT).map(titleKey).filter(Boolean);
    var seen = {}, doubled = null;
    parts.forEach(function (p) { if (seen[p]) doubled = p; seen[p] = true; });
    if (doubled) return 'double title — "' + doubled + '" appears twice';
    var tail = parts.slice(1);
    for (var i = 0; i < tail.length; i++) {
      for (var j = 0; j < tail.length; j++) {
        if (i !== j && (' ' + tail[j] + ' ').indexOf(' ' + tail[i] + ' ') !== -1) {
          return 'partial duplicate — "' + tail[i] + '" repeats inside "' + tail[j] + '"';
        }
      }
    }
    return null;
  }

  function titleFindings(page, normalise) {
    var out = [];
    if (!page.pageName || !normalise(page.pageName)) {
      out.push({ category: 'metadata', severity: 'break', field: 'Page title', note: 'the page has no <title>' });
    }
    titlesOf(page, normalise).forEach(function (t) {
      var dup = duplicateNote(t.title, normalise);
      if (dup) out.push({ category: 'metadata', severity: 'check', field: t.field, known: true, found: t.title, note: dup });
    });
    return out;
  }

  // The page title, and og:title when it says something different.
  function titlesOf(page, normalise) {
    var out = [];
    if (page.pageName && normalise(page.pageName)) out.push({ field: 'Page title', source: '<title>', title: page.pageName });
    if (page.metaTitle && normalise(page.metaTitle) !== normalise(page.pageName || '')) {
      out.push({ field: 'og:title', source: 'og:title', title: page.metaTitle });
    }
    return out;
  }

  function nameKey(s) { return String(s).toLowerCase().replace(/\s+/g, ' ').trim(); }

  // KONE's naming rule for a page title: "Page Name - KONE <the page's own
  // country>" (or "| KONE <country>"), in that market's spelling, or
  // "- KONE Corporation" — the real kone.in "Introducing One Week
  // Modernization - KONE India" is the model. Green only on a confirmed name
  // for the page's own market; red only when the title is wrong beyond doubt
  // (no title, a doubled site name, another market's confirmed name);
  // everything uncertain is amber, so a guessed spelling in the registry can
  // never fail a page. A share title (og:title) may be the page name alone:
  // the page title carries the site name.
  function lastSeparator(t) { return Math.max(t.lastIndexOf(' | '), t.lastIndexOf(' - ')); }

  function titleFormat(title, market, entries, normalise, share) {
    if (!title || !normalise(title)) return { state: 'red', reason: 'no title' };
    var t = normalise(title);
    if (duplicateNote(t, normalise)) return { state: 'red', reason: 'site name doubled — see Known template issues', known: true };

    var at = lastSeparator(t);
    if (at === -1) {
      if (/\s[\u2013\u2014]\s*KONE\b/i.test(t)) return { state: 'amber', reason: 'the site name follows a long dash — use " - KONE <country>"' };
      if (share && !/\bKONE\b/.test(t)) return { state: 'green', reason: 'the page name alone — the page title carries the site name' };
      return { state: 'amber', reason: 'no site name — expected " - KONE <country>" or " - KONE Corporation"' };
    }
    var sep = t.charAt(at + 1);
    var suffix = t.slice(at + 3).trim();
    var m = /^KONE(?:\s+(.+))?$/.exec(suffix);
    if (!m) return { state: 'amber', reason: '"' + suffix + '" is not KONE Corporation or KONE <country>' };
    if (!m[1]) return { state: 'amber', reason: '"' + sep + ' KONE" with no country' };

    var name = nameKey(m[1]);
    function has(list) { return (list || []).some(function (n) { return nameKey(n) === name; }); }
    function isSiteName(seg) {
      var k = /^KONE\s+(.+)$/.exec(seg);
      if (!k) return false;
      var n = nameKey(k[1]);
      return n === 'corporation' || entries.some(function (e) {
        return (e.siteNames || []).concat(e.siteNamesDraft || []).some(function (x) { return nameKey(x) === n; });
      });
    }
    // "X - KONE Corporation - KONE Bahrain": two site names, keep the last.
    var head = t.slice(0, at), prev = lastSeparator(head);
    if (prev !== -1 && isSiteName(head.slice(prev + 3).trim())) {
      return { state: 'amber', reason: 'two site names — "' + head.slice(prev + 3).trim() + '" and "KONE ' + m[1] + '"; keep only "' + sep + ' KONE ' + m[1] + '"' };
    }
    if (name === 'corporation') return { state: 'green', reason: 'KONE Corporation' };

    var own = market && !market.ambiguous ? market : null;
    if (own && has(own.siteNames)) return { state: 'green', reason: 'KONE ' + m[1] + ' — the confirmed name for ' + own.name };

    var other = entries.filter(function (e) { return has(e.siteNames) && (!own || e.base !== own.base); })[0];
    if (other && own) {
      return { state: 'red', reason: '"KONE ' + m[1] + '" is the ' + other.base + ' site\'s name, on a ' + own.name + ' page' };
    }
    if (!own) return { state: 'amber', reason: 'the page\'s market could not be determined, so "KONE ' + m[1] + '" was not verified' };
    if (has(own.siteNamesDraft)) {
      return { state: 'amber', reason: '"KONE ' + m[1] + '" matches the draft spelling for ' + own.name + ', not yet confirmed' };
    }
    return { state: 'amber', reason: '"KONE ' + m[1] + '" is not a confirmed site name for ' + own.name };
  }

  var RESOURCE_RE = /<(a|img|script|iframe|source|link|video|audio|embed)\b[^>]*>/gi;
  var ACTIVE = { script: true, iframe: true, embed: true, link: true };
  var PASSIVE = { img: true, source: true, video: true, audio: true };

  function categoryOfTag(tag) {
    if (tag === 'a') return 'links';
    if (PASSIVE[tag]) return 'images';
    return 'structure';
  }

  function resourcesIn(html) {
    var out = [], m;
    RESOURCE_RE.lastIndex = 0;
    while ((m = RESOURCE_RE.exec(html)) !== null) {
      var tag = m[1].toLowerCase();
      var url = attr(m[0], tag === 'a' || tag === 'link' ? 'href' : 'src');
      if (!url) continue;
      out.push({ tag: tag, url: url.trim(), rel: (attr(m[0], 'rel') || '').toLowerCase() });
    }
    return out;
  }

  function leakageFindings(html, facts, qaCfg, alreadyReported) {
    var out = [];
    var hosts = qaCfg.internalHosts || DEFAULT_QA.internalHosts;
    var resources = resourcesIn(html);
    var internal = resources.filter(function (r) {
      // The page's own canonical names the page itself, not somewhere it sends a visitor.
      if (facts.canonical && r.url === facts.canonical) return false;
      var h = hostOf(r.url);
      return h && hosts.some(function (p) { return h.indexOf(String(p).toLowerCase()) !== -1; });
    });

    if (internal.length) {
      if (facts.environment.id === 'tridion-preview' || facts.environment.id === 'aem-author') {
        out.push({
          category: 'links', severity: 'check', field: 'Internal hosts',
          found: internal.length + ' link' + (internal.length === 1 ? '' : 's') + ' to ' + hostOf(internal[0].url),
          note: 'this is a ' + facts.environment.label + ' build, so links to preview and CMS hosts are expected — ' +
                'run QA on the live page to catch any that would leak'
        });
      } else {
        var seen = {};
        internal.forEach(function (r) {
          if (seen[r.url] || alreadyReported[r.url]) return;
          seen[r.url] = true;
          out.push({
            category: categoryOfTag(r.tag), severity: facts.environment.id === 'production' ? 'break' : 'check',
            field: '<' + r.tag + '>', found: r.url,
            note: 'points at an internal or staging host — a visitor cannot reach it, and it exposes a non-public system'
          });
        });
      }
    }

    // Mixed content only exists on a page served over https.
    if (/^https:\/\//i.test(facts.canonical || '')) {
      var seenMixed = {};
      resources.forEach(function (r) {
        if (!/^http:\/\//i.test(r.url) || r.tag === 'a' || seenMixed[r.url]) return;
        if (r.tag === 'link' && !/stylesheet|icon|preload|manifest/.test(r.rel)) return;
        seenMixed[r.url] = true;
        var active = !!ACTIVE[r.tag];
        out.push({
          category: categoryOfTag(r.tag), severity: active ? 'break' : 'check',
          field: 'Mixed content', found: r.url,
          note: active
            ? 'an http:// ' + r.tag + ' on an https page — browsers block it outright'
            : 'an http:// ' + r.tag + ' on an https page — browsers warn, and may not show it'
        });
      });
    }
    return out;
  }

  var HREFLANG_RE = /^(x-default|[a-z]{2,3}(-([a-z]{2}|[a-z]{4}|\d{3}))?)$/i;

  function hreflangFindings(html, facts, pathOf) {
    var out = [], m, alternates = [];
    var re = /<link\b[^>]*>/gi;
    while ((m = re.exec(html)) !== null) {
      var code = attr(m[0], 'hreflang');
      if (code === null || !/alternate/i.test(attr(m[0], 'rel') || '')) continue;
      alternates.push({ code: code.trim(), href: (attr(m[0], 'href') || '').trim() });
    }
    facts.hreflang = alternates;

    if (!alternates.length) {
      out.push({
        category: 'metadata', severity: 'check', field: 'hreflang',
        note: 'no hreflang alternates — fine for a single-language market, a gap where the market has language versions'
      });
      return out;
    }

    var codes = {};
    alternates.forEach(function (a) {
      if (!HREFLANG_RE.test(a.code)) {
        out.push({ category: 'metadata', severity: 'break', field: 'hreflang', found: a.code + ' → ' + a.href,
          note: '"' + a.code + '" is not a valid hreflang code (language, or language-REGION, or x-default)' });
      }
      var k = a.code.toLowerCase();
      if (codes[k]) {
        out.push({ category: 'metadata', severity: 'break', field: 'hreflang', found: a.code,
          note: 'hreflang "' + a.code + '" is declared more than once' });
      }
      codes[k] = true;
    });

    if (facts.canonical) {
      var own = hostOf(facts.canonical) + pathOf(facts.canonical);
      var self = alternates.some(function (a) { return hostOf(a.href) + pathOf(a.href) === own; });
      if (!self) {
        out.push({ category: 'metadata', severity: 'check', field: 'hreflang', found: alternates.length + ' alternates',
          note: 'none of the hreflang alternates points back at this page — each language version should list itself' });
      }
    }
    return out;
  }

  function aspxFindings(facts) {
    if (!facts.canonical || !/\.aspx(?=$|[?#])/i.test(facts.canonical)) return [];
    return [{
      category: 'metadata', severity: 'check', field: 'Canonical', known: true, found: facts.canonical,
      note: 'the canonical URL still carries .aspx'
    }];
  }

  function keywordFindings(page) {
    if (page.keywords !== '') return [];
    return [{
      category: 'metadata', severity: 'check', field: 'Meta keywords', known: true,
      note: 'the meta keywords tag is present but empty'
    }];
  }

  // Document-wide and visible only: a hero's <h1> can sit outside the main
  // region readPage scopes to, and a template's display:none heading is not
  // one a reader or a crawler counts.
  function h1Findings(html, normalise) {
    var body = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
    var scope = body ? body[1] : html;
    var out = [], m, re = /<h1\b([^>]*)>([\s\S]*?)<\/h1>/gi, found = [];
    while ((m = re.exec(scope)) !== null) {
      if (/display\s*:\s*none/i.test(m[1]) || /\shidden(\s|=|$)/i.test(m[1])) continue;
      found.push(normalise(m[2].replace(/<[^>]*>/g, ' ')));
    }
    if (found.length === 0) {
      out.push({ category: 'metadata', severity: 'break', field: 'H1', note: 'the page has no visible H1' });
    } else if (found.length > 1) {
      out.push({ category: 'metadata', severity: 'break', field: 'H1', expected: 'one H1',
        found: found.join(' / '), note: found.length + ' visible H1 tags on the page' });
    }
    return out;
  }

  function linkTextFindings(regionHtml, qaCfg, normalise) {
    var out = [], m, re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
    var generic = {};
    (qaCfg.genericLinkText || DEFAULT_QA.genericLinkText).forEach(function (t) { generic[String(t).toLowerCase()] = true; });
    var seen = {};
    while ((m = re.exec(regionHtml)) !== null) {
      var href = attr('<a ' + m[1] + '>', 'href');
      // No href is a named anchor; "#" and empty are placeholders compare.js
      // already reports. Neither is this check's business.
      if (href === null || !href.trim() || href.trim() === '#') continue;
      var text = normalise(m[2].replace(/<[^>]*>/g, ' ')).replace(/[\s\u2192\u203a\u00bb>.\u2026]+$/, '').trim();
      if (!text) {
        var label = attr('<a ' + m[1] + '>', 'aria-label') || attr('<a ' + m[1] + '>', 'title');
        var img = /<img\b[^>]*>/i.exec(m[2]);
        var alt = img ? attr(img[0], 'alt') : null;
        if (!(label && label.trim()) && !(alt && alt.trim())) {
          out.push({ category: 'links', severity: 'break', field: 'Link text', found: href,
            note: 'link has no text, label or image alt — a screen reader announces only the URL' });
        }
        continue;
      }
      var key = text.toLowerCase();
      if (generic[key] && !seen[key + '|' + href]) {
        seen[key + '|' + href] = true;
        out.push({ category: 'links', severity: 'check', field: 'Link text', found: '"' + text + '" → ' + href,
          note: 'link text says nothing about where it goes — out of context, a screen reader reads only "' + text + '"' });
      }
    }
    return out;
  }

  // ─── ASSEMBLY ────────────────────────────────────────────────────────────


  // ─── LIVE FETCH ──────────────────────────────────────────────────────────
  // What the backend learned fetching the page — status, redirects, the
  // certificate — as findings. Pure: the fetch result is just data here.

  function sameUrl(a, b, pathOf) {
    return hostOf(a) === hostOf(b) && pathOf(a) === pathOf(b);
  }

  function seconds(ms) {
    return ms == null ? '' : (ms < 1000 ? (ms / 1000).toFixed(2) : (ms / 1000).toFixed(1)) + ' s';
  }

  // A fetch's redirects as one line: each address with the status it
  // answered, ending where the fetch ended. Empty when there were none.
  function redirectChain(live) {
    var hops = (live && live.redirects) || [];
    if (!hops.length) return '';
    return hops.map(function (h) { return h.url + ' (' + h.status + ')'; })
      .concat(live.finalUrl || hops[hops.length - 1].to).join(' → ');
  }

  function liveFindings(live, facts, pathOf, speed) {
    var out = [];
    if (!live) return out;
    speed = speed || DEFAULT_QA.speed;
    var finalUrl = live.finalUrl || live.url || '';
    if (/^http:\/\//i.test(finalUrl)) {
      out.push({ category: 'structure', severity: 'break', field: 'HTTPS',
        found: finalUrl, note: 'the page was served over plain http — browsers mark it not secure' });
    }
    var tls = live.tls;
    if (tls && !tls.valid) {
      out.push({ category: 'structure', severity: 'break', field: 'Certificate',
        found: tls.error || 'not valid',
        note: 'the site\'s certificate is not valid (' + (tls.error || 'unknown reason') + ') — browsers show a not-secure warning' });
    } else if (tls && tls.daysLeft !== null && tls.daysLeft < 30) {
      out.push({ category: 'structure', severity: 'check', field: 'Certificate',
        found: 'valid until ' + String(tls.validTo).slice(0, 10),
        note: 'the certificate expires in ' + tls.daysLeft + ' day' + (tls.daysLeft === 1 ? '' : 's') + ' — make sure it renews' });
    }
    var hops = (live.redirects || []).length;
    if (hops > speed.maxRedirects) {
      out.push({ category: 'links', severity: 'break', field: 'Redirect chain',
        found: redirectChain(live), note: hops + ' redirects — more than ' + speed.maxRedirects +
          '; link straight to the final URL and shorten the chain' });
    } else if (hops > 1) {
      out.push({ category: 'links', severity: 'check', field: 'Redirect chain',
        found: redirectChain(live), note: 'reached through ' + hops + ' redirects — links to it should point at the final URL' });
    }
    if (live.status && live.status !== 200) {
      out.push({ category: 'structure', severity: 'break', field: 'Final status',
        found: String(live.status), note: 'the page answered ' + live.status + ', not 200 — browsers and search engines may not treat it as a normal page' });
    }
    // Server and network time for the HTML alone, from the backend's server:
    // not what a visitor in the market sees, and not browser metrics.
    var timed = live.runs > 1 ? ' (average of ' + live.runs + ' fetches)' : '';
    if (typeof live.ms === 'number' && live.ms > speed.slowMs) {
      out.push({ category: 'structure', severity: 'check', field: 'Load time',
        found: seconds(live.ms), note: 'the HTML took ' + seconds(live.ms) + timed +
          (live.redirectMs ? ', ' + seconds(live.redirectMs) + ' of it redirects' : '') +
          ' — over ' + seconds(speed.slowMs) + '; measured from the backend\'s server, HTML only' });
    }
    if (typeof live.ttfbMs === 'number' && live.ttfbMs > speed.slowTtfbMs) {
      out.push({ category: 'structure', severity: 'check', field: 'Server response (TTFB)',
        found: seconds(live.ttfbMs), note: 'the first byte took ' + seconds(live.ttfbMs) + timed +
          ' — over ' + seconds(speed.slowTtfbMs) + '; measured from the backend\'s server' });
    }
    // On a preview build the canonical names the live page on purpose.
    if (facts.canonical && finalUrl && !/^preview(-[a-z]+)?\./.test(hostOf(finalUrl).replace(/^www\./, '')) &&
        !/^https?:\/\/preview(-[a-z]+)?\./i.test(finalUrl) && !sameUrl(finalUrl, facts.canonical, pathOf)) {
      out.push({ category: 'metadata', severity: 'check', field: 'Canonical', expected: finalUrl, found: facts.canonical,
        note: 'the page is served at one URL and its canonical names another — fine for a duplicate, wrong for an original' });
    }
    return out;
  }

  // ─── URL LIST ────────────────────────────────────────────────────────────
  // A crawl's URL list: one URL per line, optionally followed by the form id
  // that page should carry — "https://www.kone.ae/contact/, 752", tab- or
  // space-separated too. A header line ("url,expected_form_id") is skipped.
  function parseUrlList(text) {
    var out = [], seen = {};
    String(text == null ? '' : text).split(/\r?\n/).forEach(function (line) {
      var parts = line.trim().split(/\s*[,;\t]\s*|\s+/).filter(Boolean);
      if (!parts.length || /^url$/i.test(parts[0])) return;
      var url = /^https?:\/\//i.test(parts[0]) ? parts[0] : 'https://' + parts[0];
      if (seen[url]) return;
      seen[url] = true;
      var id = parts[1] && /^\d+$/.test(parts[1]) ? parts[1] : null;
      out.push({ url: url, expectedFormId: id });
    });
    return out;
  }

  // ─── FORMS ───────────────────────────────────────────────────────────────
  // Whether each embedded FormAssembly form is wired to one id: the form
  // element, the hidden tfa_dbFormId FormAssembly submits and the -WRPR
  // wrapper are rendered from the same form, and AEM's component names the
  // form twice (data-target-id and the publish script). Any two that differ
  // is a form built from mismatched parts. Which id the page should carry is
  // the Form Assembly ID check's question, not this one.

  var FORM_ID_SOURCES = [['formElement', 'form id'], ['dbFormId', 'tfa_dbFormId'], ['wrapper', 'wrapper'],
    ['publish', 'embed URL'], ['targetId', 'data-target-id']];

  function formFindings(forms, digitalData) {
    var out = [];
    (forms || []).forEach(function (f) {
      var seen = FORM_ID_SOURCES.filter(function (s) { return f.ids[s[0]]; });
      var values = seen.map(function (s) { return f.ids[s[0]]; }).filter(function (v, i, all) { return all.indexOf(v) === i; });
      if (values.length > 1) {
        out.push({ category: 'structure', severity: 'break', field: 'Form wiring',
          found: seen.map(function (s) { return s[1] + ' ' + (s[0] === 'wrapper' ? f.wrapperId : f.ids[s[0]]); }).join(' · '),
          where: f.where || null,
          note: 'the parts of this FormAssembly form name different forms — they must all carry the same number' });
      }
    });
    var dd = digitalData && digitalData.formAssemblyId;
    var embedded = (forms || []).map(function (f) { return f.formId; }).filter(Boolean);
    if (dd && embedded.length && embedded.indexOf(String(dd)) === -1) {
      out.push({ category: 'structure', severity: 'check', field: 'Form Assembly ID', expected: String(dd),
        found: embedded.join(', '),
        note: 'the page\'s digitalData names form ' + dd + ', but the form embedded on it is ' + embedded.join(', ') +
          ' — analytics and the form disagree' });
    }
    return out;
  }

  // One rule for what a link's address is, shared by the status check and
  // by placing a link on the page, so the two always agree on the key.
  function absHref(href, baseUrl) {
    href = String(href == null ? '' : href).trim();
    if (!href || /^(#|mailto:|tel:|javascript:|data:)/i.test(href)) return null;
    var abs;
    try { abs = new URL(href.replace(/&amp;/g, '&'), baseUrl || undefined).href; } catch (e) { return null; }
    if (!/^https?:\/\//i.test(abs)) return null;
    return abs.replace(/#.*$/, '');
  }

  // Every link worth a status check: absolute http(s) targets of the page's
  // anchors, relative ones resolved against where the page was served.
  function linksToCheck(html, baseUrl) {
    var out = [], seen = {}, m, re = /<a\b[^>]*>/gi;
    while ((m = re.exec(String(html || ''))) !== null) {
      var abs = absHref(attr(m[0], 'href'), baseUrl);
      if (!abs || seen[abs]) continue;
      seen[abs] = true;
      out.push(abs);
    }
    return out;
  }

  // ─── WHERE A LINK SITS ───────────────────────────────────────────────────
  // Links are checked across the whole page — header and footer included —
  // so a broken one is placed in full: the component it is in (or the
  // header, navigation or footer, outside any component), which block of
  // that component, the block's title, and whether it is hidden:
  //   Content blocks #2 › block 3 — "Digitally connected for more uptime"
  //   Header (hidden)
  // One pass over the tags with a stack of open elements; comments, scripts
  // and styles are blanked first, keeping every offset where it was.

  var ITEM_NOUNS = { 'content-block': 'block', 'teaser': 'teaser', 'content-river__item': 'item',
    'accordion-listitem': 'question', 'news-item': 'card', 'proofpoints-turningcard': 'card', 'card': 'card' };
  var VOID_NAMES = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/;
  var LANDMARKS = { header: 'Header', nav: 'Navigation', footer: 'Footer', aside: 'Sidebar' };

  function classesIn(tag) { return String(attr(tag, 'class') || '').split(/\s+/).filter(Boolean); }

  function hiddenTag(tag, classes) {
    return /\sstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(tag) ||
      /^<[a-z0-9-]+\b[^>]*\shidden(?=[\s>\/=])/i.test(tag.replace(/(["'])[^"']*\1/g, '""')) ||
      classes.some(function (c) { return c === 'hidden' || c === 'd-none' || c === 'hide'; });
  }

  function itemNoun(el) {
    for (var i = 0; i < el.classes.length; i++) if (ITEM_NOUNS[el.classes[i]]) return ITEM_NOUNS[el.classes[i]];
    return el.name === 'article' ? 'block' : null;
  }

  function landmarkOf(el) {
    if (LANDMARKS[el.name]) return LANDMARKS[el.name];
    for (var i = 0; i < el.classes.length; i++) {
      var c = el.classes[i];
      if (/(^|[-_])footer($|[-_])/.test(c)) return 'Footer';
      if (/(^|[-_])header($|[-_])/.test(c)) return 'Header';
      if (/(^|[-_])nav(igation)?($|[-_])/.test(c)) return 'Navigation';
    }
    return null;
  }

  var TITLE_RE = /<(h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>|<(button|a|div|span)\b([^>]*\bclass\s*=\s*["'][^"']*\baccordion-trigger\b[^"']*["'][^>]*)>([\s\S]*?)<\/\4>/gi;

  function titlesIn(text) {
    var out = [], m;
    TITLE_RE.lastIndex = 0;
    while ((m = TITLE_RE.exec(text)) !== null) {
      var attrs = m[2] || m[5] || '';
      if (/display\s*:\s*none/i.test(attrs)) continue;
      var t = decodeText((m[3] || m[6] || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
      if (t) out.push(t);
    }
    return out;
  }

  var NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', reg: '®', trade: '™', copy: '©', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘' };
  function decodeText(t) {
    return t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, e) {
      if (e.charAt(0) === '#') {
        var n = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n === 160 ? ' ' : isFinite(n) ? String.fromCharCode(n) : all;
      }
      return NAMED[e.toLowerCase()] || all;
    });
  }

  function clipTitle(t) { return t.length > 70 ? t.slice(0, 67).replace(/\s+\S*$/, '') + '…' : t; }

  // { absoluteUrl: [{ where, hidden, anchor }] }, every place a link appears.
  function linkPlaces(html, baseUrl, modules, moduleLabel) {
    return scanPlaces(html, modules, moduleLabel, null).links(baseUrl);
  }

  // Where anything else sits — a form, by the offset it starts at — in the
  // same terms as a link.
  function placesAt(html, offsets, modules, moduleLabel) {
    return scanPlaces(html, modules, moduleLabel, offsets).probes;
  }

  function scanPlaces(html, modules, moduleLabel, offsets) {
    html = String(html == null ? '' : html);
    var pending = (offsets || []).map(function (at, i) { return { at: at, i: i }; })
      .sort(function (a, b) { return a.at - b.at; });
    var probes = [];
    var scan = html.replace(/<!--[\s\S]*?-->|<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1>/gi,
      function (m) { return m.replace(/[^\n]/g, ' '); });
    var byStart = {};
    (modules || []).forEach(function (mod) { byStart[mod.start] = mod; });
    var stack = [], counters = {}, links = [], re = /<(\/?)([a-z][a-z0-9-]*)\b[^>]*>/gi, m;
    while ((m = re.exec(scan)) !== null) {
      var name = m[2].toLowerCase();
      // Every probe at or before this tag sits inside what is open now.
      while (pending.length && pending[0].at <= m.index) {
        var p0 = pending.shift();
        probes[p0.i] = { start: p0.at, ancestors: stack.slice(), selfTag: !m[1] && m.index === p0.at ? m[0] : null };
      }
      if (m[1]) {
        for (var i = stack.length - 1; i >= 0; i--) {
          if (stack[i].name === name) { stack[i].end = m.index; stack.length = i; break; }
        }
        continue;
      }
      var el = { name: name, start: m.index, end: null, tag: m[0], classes: classesIn(m[0]) };
      el.hidden = hiddenTag(el.tag, el.classes);
      el.module = byStart[m.index] || null;
      if (name === 'a') links.push({ el: el, ancestors: stack.slice() });
      if (VOID_NAMES.test(name) || /\/>$/.test(el.tag)) continue;
      // The blocks of a component are counted by their own kind, outermost
      // only: "block 3" is the third content block, whatever it contains.
      var noun = itemNoun(el);
      if (noun) {
        var modEl = null, inItem = false;
        for (var j = stack.length - 1; j >= 0; j--) {
          if (stack[j].item) inItem = true;
          if (stack[j].module) { modEl = stack[j]; break; }
        }
        if (modEl && !inItem) {
          var key = modEl.start + '|' + noun;
          counters[key] = (counters[key] || 0) + 1;
          el.item = { noun: noun, ordinal: counters[key] };
        }
      }
      stack.push(el);
    }
    pending.forEach(function (p0) { probes[p0.i] = { start: p0.at, ancestors: stack.slice(), selfTag: null }; });

    function describe(chain, hidden, start) {
      var modEl = null, itemEl = null, landEl = null, land = null;
      for (var i = chain.length - 1; i >= 0; i--) {
        var a = chain[i];
        if (a.hidden) hidden = true;
        if (!modEl && a.module) modEl = a;
        if (!modEl && !itemEl && a.item) itemEl = a;
        // The outermost landmark names it: a header's own <nav> is still the header.
        if ((land = landmarkOf(a))) landEl = a;
      }
      if (!modEl) itemEl = null;
      var mod = modEl && modEl.module;
      var box = itemEl || modEl || (landEl && !modEl ? landEl : null);
      var title = null;
      if (!box) {
        // Outside any component: the nearest heading above it, to find it by.
        var above = titlesIn(scan.slice(0, start));
        title = above.length ? above[above.length - 1] : null;
      } else {
        var before = titlesIn(scan.slice(box.start, start));
        title = before.length ? before[before.length - 1]
          : (titlesIn(scan.slice(box.start, box.end == null ? scan.length : box.end))[0] || null);
      }
      var where = (mod ? moduleLabel(mod) : landEl ? landmarkOf(landEl) : 'Page body') +
        (itemEl ? ' › ' + itemEl.item.noun + ' ' + itemEl.item.ordinal : '') +
        (title ? ' — "' + clipTitle(title) + '"' : '') + (hidden ? ' (hidden)' : '');
      return { where: where, hidden: hidden, anchor: mod && mod.id ? '#' + mod.id : null };
    }

    return {
      links: function (baseUrl) {
        var out = {};
        links.forEach(function (l) {
          var abs = absHref(attr(l.el.tag, 'href'), baseUrl);
          if (!abs) return;
          var place = describe(l.ancestors, l.el.hidden, l.el.start);
          var list = out[abs] = out[abs] || [];
          if (!list.some(function (p) { return p.where === place.where; })) list.push(place);
        });
        return out;
      },
      probes: probes.map(function (p) {
        var self = p.selfTag ? hiddenTag(p.selfTag, classesIn(p.selfTag)) : false;
        return describe(p.ancestors, self, p.start);
      })
    };
  }

  function isKone(url, domains) {
    var h = hostOf(url);
    return domains.some(function (d) { return h === d || h.slice(-(d.length + 1)) === '.' + d; });
  }

  // Link statuses from the backend, as Hyperlinks findings. Broken is a
  // break; a link that could not be verified is a check — never counted as
  // broken, never as fine.
  function linkStatusFindings(statuses, domains, places) {
    var out = [];
    (statuses || []).forEach(function (s) {
      var kind = isKone(s.url, domains) ? 'KONE' : 'external';
      var f = null;
      if (s.verdict === 'dead') {
        f = { category: 'links', severity: 'break', field: 'Broken link (' + kind + ')', found: s.url,
          note: s.reason || ('answered ' + s.status) };
      } else if (s.verdict === 'unverified' || s.verdict === 'refused') {
        f = { category: 'links', severity: 'check', field: 'Link not verified (' + kind + ')', found: s.url,
          note: (s.reason || 'no answer') + ' — open it by hand' };
      }
      if (!f) return;
      // Every place on the page the link appears, so it can be found.
      var at = (places && places[s.url]) || [];
      if (at.length) {
        f.where = at.map(function (p) { return p.where; }).join('  ·  ');
        var anchored = at.filter(function (p) { return p.anchor; })[0];
        if (anchored) f.anchor = anchored.anchor;
      }
      out.push(f);
    });
    return out;
  }

  function create(config) {
    config = config || {};
    var wt = config['work-types'] || {};
    var qaCfg = wt.qa || {};
    var cme = qaCfg.cme || DEFAULT_QA.cme;
    var speed = Object.assign({}, DEFAULT_QA.speed, qaCfg.speed || {});
    var comparerConfig = { 'work-types': wt };
    if (config['sites']) comparerConfig['sites'] = config['sites'];
    var comparer = Compare.create(comparerConfig);
    var normalise = comparer.normalise;
    var pathOf = comparer.pathOf;

    function cmeLink(pattern, id) { return id ? pattern.split('{id}').join(id) : null; }

    // The proofreading pass and the sitemap-aware link judge, both optional:
    // without their scripts QA still runs, with no Summary card.
    var linker = Links ? Links.create({ pathOf: pathOf, rulings: config['link-rulings'] }) : null;
    var proofCfg = config['proofreading'] || null;

    // Every KONE domain in the registry, for telling KONE links from external.
    var koneDomains = comparer.siteEntries().map(function (e) { return String(e.domain || '').toLowerCase(); })
      .concat(['kone.com']).filter(function (d, i, all) { return d && all.indexOf(d) === i; });

    // options.brief (optional): with a brief, QA is also the comparison —
    // one report, the brief's findings and the page's own in the same five
    // categories, coverage on top. Without one it is QA on the page alone.
    // options.workTypeId decides which playbook the brief is read with.
    // options.live (optional): the backend's fetch result for this page —
    // status, final URL, redirects, certificate — which adds its own facts
    // and findings. options.links (optional): link statuses from the
    // backend's link check, reported under Hyperlinks.
    // options.sitemap (optional): { urls, source } — the site's sitemap, so
    // dead links get a suggested destination and working ones are judged
    // for relevance. Its findings go to result.audit, the Summary, and never
    // into the break/check tally.
    function run(html, options) {
      options = options || {};
      html = String(html == null ? '' : html);
      var page = comparer.readPage(html);
      var head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
      var headHtml = head ? head[1] : html;

      var briefText = String(options.brief || '').trim();
      var workTypeId = options.workTypeId || 'new-page';
      var comparison = null, expect = null;
      if (briefText) {
        comparison = comparer.compare(briefText, html, { workTypeId: workTypeId });
        if (comparison.supported) expect = comparer.readBrief(briefText, workTypeId, wt);
      }
      var compared = !!(comparison && comparison.supported && !comparison.unreadable);

      var robotsTag = metaTag(headHtml, 'robots');
      var tcmTag = metaTag(headHtml, 'pagetcmid');
      var tcmRaw = tcmTag ? (attr(tcmTag, 'content') || '').trim() : '';
      var tcmId = /^tcm:\d+-\d+(-\d+)?$/i.test(tcmRaw) ? tcmRaw : null;
      // A page with no canonical still has a market when it was fetched
      // live: the URL it was served at says which site it is on.
      // Where each of the page's links sits, resolved against the same base
      // the link check uses — kept on the result, so statuses checked later
      // (a crawl's link pass) can be placed too.
      var linkBase = (options.live && options.live.finalUrl) || page.canonical || null;
      var places = null;
      function linkPlacesOf() {
        if (!places) places = linkPlaces(html, linkBase, comparer.modules(html), comparer.moduleLabel);
        return places;
      }
      var placed = page;
      if (!page.canonical && options.live && options.live.finalUrl) placed = Object.assign({}, page, { canonical: options.live.finalUrl });
      var formId = comparer.formIdFinding(expect, placed, { expectedFormId: options.expectedFormId || null });
      // Each FormAssembly form on the page, placed like a link.
      var forms = (page.forms || []).map(function (f) { return Object.assign({}, f); });
      if (forms.length) {
        placesAt(html, forms.map(function (f) { return f.start; }), comparer.modules(html), comparer.moduleLabel)
          .forEach(function (pl, i) { forms[i].where = pl.where; forms[i].hidden = pl.hidden; });
      }
      var market = comparer.marketOf(expect, placed);

      var facts = {
        canonical: page.canonical || null,
        environment: page.canonical || !(options.live && options.live.finalUrl)
          ? environmentOf(page.canonical)
          : (function (env) { env.why = 'no canonical; served from ' + hostOf(options.live.finalUrl); return env; }(environmentOf(options.live.finalUrl))),
        tcmId: tcmId,
        tcmRaw: tcmRaw || null,
        cmeNewUi: cmeLink(cme.newUi, tcmId),
        cmeOldUi: cmeLink(cme.oldUi, tcmId),
        pageTitle: page.pageName || null,
        lang: page.lang || null,
        dataLang: page.dataLang || null,
        market: market ? (market.ambiguous ? market.base + ' (language version not determined)' : market.name) : null,
        // Which site's sitemap to read for link suggestions.
        site: market && !market.ambiguous && market.domain ? { domain: market.domain, langPath: market.langPath || null } : null,
        robots: robotsTag ? attr(robotsTag, 'content') : null,
        digitalData: page.digitalData || null,
        forms: forms,
        expectedFormId: options.expectedFormId || null,
        hreflang: []
      };

      var byId = {};
      CATEGORIES.forEach(function (c) { byId[c[0]] = { id: c[0], label: c[1], deviations: [], rows: [] }; });

      // With a readable brief, start from the comparison — it already holds
      // the page-only findings too. Without one, from those alone. Compare's
      // own Form Assembly ID category is skipped: QA reports that itself,
      // under Structure, below.
      var start = compared ? comparison.categories : comparer.pageOnlyCategories(page).categories;
      start.forEach(function (c) {
        var target = byId[c.id];
        if (!target) return;
        c.deviations.forEach(function (d) {
          // QA counts H1s its own way (document-wide, visible only) below.
          if (c.id === 'metadata' && d.field === 'H1') return;
          target.deviations.push(d);
        });
        if (compared && c.ledger) target.ledger = c.ledger;
        if (compared && c.id === 'metadata') {
          target.rows = (c.rows || []).slice();
          if (c.note) target.note = c.note;
        }
      });

      var reportedUrls = {};
      (byId.links.deviations || []).forEach(function (d) { if (d.found) reportedUrls[d.found] = true; });

      var findings = []
        .concat(robotsFindings(facts, page))
        .concat(titleFindings(page, normalise))
        .concat(leakageFindings(html, facts, qaCfg, reportedUrls))
        .concat(hreflangFindings(html, facts, pathOf))
        .concat(aspxFindings(facts))
        .concat(keywordFindings(page))
        .concat(h1Findings(html, normalise))
        .concat(linkTextFindings(comparer.mainRegion(html).html, qaCfg, normalise))
        .concat(liveFindings(options.live, facts, pathOf, speed))
        .concat(linkStatusFindings(options.links, koneDomains, linkPlacesOf()))
        .concat(formFindings(forms, page.digitalData));

      if (options.live) {
        var lv = options.live;
        facts.live = { url: lv.url, finalUrl: lv.finalUrl, status: lv.status, verdict: lv.verdict,
          redirects: lv.redirects || [], tls: lv.tls || null, ms: lv.ms, bytes: lv.bytes,
          ttfbMs: lv.ttfbMs == null ? null : lv.ttfbMs, redirectMs: lv.redirectMs || 0, loop: !!lv.loop,
          runs: lv.runs || 1, runMs: lv.runMs || null, speed: speed };
      }
      if (options.links) {
        var tallyOf = function (v) { return options.links.filter(function (l) { return l.verdict === v; }).length; };
        facts.linkCheck = { checked: options.links.length, ok: tallyOf('ok'), dead: tallyOf('dead'),
          unverified: tallyOf('unverified') + tallyOf('refused') };
      }

      // The title naming rule, scored for each title the page carries.
      var entries = comparer.siteEntries();
      var formatRows = [];
      if (!page.pageName || !normalise(page.pageName)) {
        formatRows.push({ field: 'Title format', source: 'page title', expected: null, found: null,
          state: 'red', stateLabel: 'no title', soft: false, basis: 'expected' });
      }
      titlesOf(page, normalise).forEach(function (t) {
        var score = titleFormat(t.title, market, entries, normalise, t.field === 'og:title');
        formatRows.push({ field: 'Title format', source: t.field === 'og:title' ? 'og:title' : 'page title',
          expected: null, found: t.title, state: score.state, stateLabel: score.reason, soft: false, basis: 'expected' });
        // A doubled site name is already a known template issue; scoring it
        // again here would count the template against the page after all.
        if (score.known || score.state === 'green') return;
        findings.push({ category: 'metadata', severity: score.state === 'red' ? 'break' : 'check',
          field: 'Title format', found: t.title, note: score.reason });
      });

      var known = [];
      findings.forEach(function (f) {
        var d = { severity: f.severity, field: f.field, note: f.note };
        if (f.expected) d.expected = f.expected;
        if (f.found) d.found = f.found;
        if (f.where) d.where = f.where;
        if (f.anchor) d.anchor = f.anchor;
        if (f.known) known.push(d);
        else byId[f.category].deviations.push(d);
      });

      if (formId.severity) {
        byId.structure.deviations.push({ severity: formId.severity, field: 'Form Assembly ID',
          note: formId.note, expected: formId.expected, found: formId.found });
      }
      byId.structure.rows.push(formId.row);

      // What the page carries, shown whether or not anything is wrong with it.
      // With a brief, Compare's rows already show the titles, description and
      // path against the brief; QA adds only what they do not cover.
      function row(field, source, value) {
        return { field: field, source: source, expected: null, found: value || null,
          state: value ? 'present' : 'absent', soft: false, basis: 'expected' };
      }
      var indexing = facts.digitalData &&
        [facts.digitalData.indexOptions, facts.digitalData.followLinksOptions].filter(Boolean).join(', ');
      var hreflangCodes = facts.hreflang.length ? facts.hreflang.map(function (a) { return a.code; }).join(', ') : null;
      var pageRows = compared ? [] : [
        row('Page title', '<title>', page.pageName),
        row('Meta title', 'og:title', page.metaTitle),
        row('Meta description', null, page.description)
      ];
      byId.metadata.rows = byId.metadata.rows.concat(pageRows, formatRows, [
        row('Canonical', null, page.canonical),
        row('Robots', '<meta name="robots">', facts.robots),
        row('Indexing', 'digitalData', indexing),
        row('hreflang', '<link rel="alternate">', hreflangCodes)
      ]);

      // Body copy is judged against a brief; from the page alone the only
      // check is an empty Tridion field, which needs field markers to see.
      var hasFields = (page.modules || []).some(function (mod) { return mod.fields && mod.fields.length; });
      if (!compared && !byId.body.deviations.length && !hasFields) {
        byId.body.note = 'Body copy is checked against a brief — add one above to check it. From the page alone ' +
          'only an empty Tridion field can be caught, and this page carries no component field markers — so nothing here was checked.';
      }

      var categories = CATEGORIES.map(function (c) {
        var cat = byId[c[0]];
        cat.deviations.sort(function (a, b) {
          return (a.severity === 'check' ? 1 : 0) - (b.severity === 'check' ? 1 : 0);
        });
        if (!cat.rows.length) delete cat.rows;
        return cat;
      });

      var breaks = 0, checks = 0;
      categories.forEach(function (c) {
        c.deviations.forEach(function (d) { if (d.severity === 'check') checks++; else breaks++; });
      });

      var audit = buildAudit(html, page, facts, options.sitemap);
      if (audit) attachSuggestions(byId.links, audit.links);

      return {
        generatedAt: new Date().toISOString(),
        audit: audit,
        facts: facts,
        comparison: comparison && {
          supported: comparison.supported,
          unreadable: !!comparison.unreadable,
          note: comparison.note || null,
          workTypeId: workTypeId,
          mode: comparison.mode || null,
          expectations: comparison.expectations || 0,
          coverage: comparison.coverage || null,
          suspectParse: !!comparison.suspectParse,
          parseNote: comparison.parseNote || null
        },
        categories: categories,
        knownIssues: known,
        breaks: breaks,
        checks: checks,
        regionVia: page.regionVia,
        linkPlaces: linkPlacesOf()
      };
    }

    // ─── THE SUMMARY ─────────────────────────────────────────────────────
    // Links judged against the sitemap, spelling, lists and metadata: what a
    // reviewer would mark up, gathered in one place with a suggestion each.
    var indexCache = { key: null, index: null };

    function sitemapIndex(sitemap) {
      if (!sitemap || !linker) return null;
      var urls = sitemap.urls || (sitemap.text ? Links.parseSitemap(sitemap.text) : []);
      if (!urls.length) return null;
      var key = (sitemap.source || '') + '|' + urls.length + '|' + urls[0] + '|' + urls[urls.length - 1];
      if (indexCache.key !== key) indexCache = { key: key, index: linker.index(urls, { source: sitemap.source, host: sitemap.host }) };
      return indexCache.index;
    }

    function buildAudit(html, page, facts, sitemap) {
      if (!linker || !Proof) return null;
      var idx = sitemapIndex(sitemap);
      var region = comparer.mainRegion(html).html;
      var english = /^en\b/i.test(facts.lang || '') || /^en\b/i.test(facts.dataLang || '');
      var head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
      var description = head ? metaTag(head[1], 'description') : null;
      var links = linker.audit({ page: page, canonical: facts.canonical, index: idx });
      var spelling = Proof.spelling(html, proofCfg, { region: region, english: english,
        extraText: [{ text: page.pageName || '', label: 'title' },
          { text: description ? (attr(description, 'content') || '') : '', label: 'meta description' }] });
      var lists = Proof.lists(region);
      var meta = Proof.metadata(html, { canonical: facts.canonical, region: region });
      var linkIssues = links.rows.filter(function (r) { return r.verdict !== 'green'; });
      function tally(list) {
        var t = { red: 0, amber: 0 };
        list.forEach(function (f) { if (f.verdict === 'red') t.red++; else if (f.verdict === 'amber') t.amber++; });
        return t;
      }
      return {
        sitemap: idx ? { count: idx.count, source: idx.source, host: idx.host, prefix: idx.prefix } : null,
        english: english,
        links: links.rows,
        linkCounts: links.counts,
        spelling: spelling,
        lists: lists,
        metadata: meta,
        counts: { spelling: tally(spelling), links: tally(linkIssues), lists: tally(lists), metadata: tally(meta) }
      };
    }

    // The dead-CTA and placeholder findings QA already makes gain the page
    // the sitemap suggests for them.
    function attachSuggestions(linksCat, rows) {
      (linksCat.deviations || []).forEach(function (d) {
        var row = rows.filter(function (r) {
          return (r.kind === 'dead-cta' || r.kind === 'placeholder') && r.text === d.found && r.suggestions && r.suggestions.length;
        })[0];
        if (!row) return;
        var best = row.suggestions[0];
        d.suggest = best.url + (row.confident ? '' : ' (closest match — check it)');
      });
    }

    // One line per crawled page, for the crawl table and its CSV: what a
    // reader scans for before opening the full report.
    function crawlRow(r, live) {
      var worst = function (rows, field) {
        var rank = { red: 3, amber: 2, green: 1 }, best = null;
        (rows || []).forEach(function (row) {
          if (row.field !== field) return;
          if (!best || (rank[row.state] || 0) > (rank[best] || 0)) best = row.state;
        });
        return best;
      };
      var meta = r.categories.filter(function (c) { return c.id === 'metadata'; })[0] || {};
      var structure = r.categories.filter(function (c) { return c.id === 'structure'; })[0] || {};
      var form = (structure.rows || []).filter(function (row) { return row.field === 'Form Assembly ID'; })[0] || null;
      return {
        url: live ? live.url : (r.facts.canonical || ''),
        finalUrl: live ? live.finalUrl : null,
        status: live ? live.status : null,
        verdict: live ? live.verdict : 'ok',
        title: r.facts.pageTitle || null,
        titleFormat: worst(meta.rows, 'Title format'),
        formId: form ? form.state : null,
        formIdFound: form ? form.found : null,
        breaks: r.breaks,
        checks: r.checks,
        known: r.knownIssues.length,
        tcmId: r.facts.tcmId,
        cme: r.facts.cmeNewUi,
        market: r.facts.market,
        environment: r.facts.environment.label,
        redirects: live ? (live.redirects || []).length : null,
        redirectChain: live ? redirectChain(live) : '',
        redirectMs: live ? live.redirectMs || 0 : null,
        ttfbMs: live && live.ttfbMs != null ? live.ttfbMs : null,
        loadMs: live ? live.ms : null,
        bytes: live ? live.bytes : null,
        expectedFormId: r.facts.expectedFormId || null,
        forms: (r.facts.forms || []).map(function (f) {
          return { formId: f.formId, idSource: f.idSource, embed: f.embed, postHost: f.postHost, version: f.version,
            title: f.title, language: f.language, localization: f.localization, submit: f.submit, captcha: f.captcha };
        })
      };
    }

    // A crawl checks every link once across the whole run, after the pages
    // were judged — so the statuses for one page arrive after its report was
    // built. Folded in here rather than by re-running the page, whose HTML a
    // long crawl does not keep.
    function withLinkStatuses(r, statuses) {
      var findings = linkStatusFindings(statuses, koneDomains, r.linkPlaces);
      var out = Object.assign({}, r, { facts: Object.assign({}, r.facts), categories: r.categories.map(function (c) {
        if (c.id !== 'links') return c;
        var added = findings.map(function (f) {
          var d = { severity: f.severity, field: f.field, note: f.note, found: f.found };
          if (f.where) d.where = f.where;
          if (f.anchor) d.anchor = f.anchor;
          return d;
        });
        var devs = c.deviations.concat(added).sort(function (a, b) {
          return (a.severity === 'check' ? 1 : 0) - (b.severity === 'check' ? 1 : 0);
        });
        return Object.assign({}, c, { deviations: devs });
      }) });
      var tallyOf = function (v) { return statuses.filter(function (l) { return l.verdict === v; }).length; };
      out.facts.linkCheck = { checked: statuses.length, ok: tallyOf('ok'), dead: tallyOf('dead'),
        unverified: tallyOf('unverified') + tallyOf('refused') };
      out.breaks = 0; out.checks = 0;
      out.categories.forEach(function (c) {
        c.deviations.forEach(function (d) { if (d.severity === 'check') out.checks++; else out.breaks++; });
      });
      return out;
    }

    return { run: run, crawlRow: crawlRow, linksToCheck: linksToCheck, withLinkStatuses: withLinkStatuses };
  }

  return { create: create, DEFAULT_QA: DEFAULT_QA, linksToCheck: linksToCheck, linkPlaces: linkPlaces, placesAt: placesAt,
    redirectChain: redirectChain, parseUrlList: parseUrlList };
}));

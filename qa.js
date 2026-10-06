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
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./compare.js'));
  else root.BriefQA = factory(root.BriefCompare);
}(typeof self !== 'undefined' ? self : this, function (Compare) {
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

  // KONE's naming rule for a page title: "Page Name | KONE Corporation", or
  // "Page Name | KONE <the page's own country>" in that market's spelling.
  // Green only on a confirmed name for the page's own market; red only when
  // the title is wrong beyond doubt (no title, a doubled site name, another
  // market's confirmed name); everything uncertain is amber, so a guessed
  // spelling in the registry can never fail a page.
  function titleFormat(title, market, entries, normalise) {
    if (!title || !normalise(title)) return { state: 'red', reason: 'no title' };
    var t = normalise(title);
    if (duplicateNote(t, normalise)) return { state: 'red', reason: 'site name doubled — see Known template issues', known: true };

    var at = t.lastIndexOf(' | ');
    if (at === -1) {
      if (/\s[-\u2013\u2014]\s*KONE\b/i.test(t)) return { state: 'amber', reason: 'the site name is not after " | "' };
      return { state: 'amber', reason: 'no site name — expected "| KONE Corporation" or "| KONE <country>"' };
    }
    var suffix = t.slice(at + 3).trim();
    var m = /^KONE(?:\s+(.+))?$/.exec(suffix);
    if (!m) return { state: 'amber', reason: '"' + suffix + '" is not KONE Corporation or KONE <country>' };
    if (!m[1]) return { state: 'amber', reason: '"| KONE" with no country' };

    var name = nameKey(m[1]);
    if (name === 'corporation') return { state: 'green', reason: 'KONE Corporation' };

    var own = market && !market.ambiguous ? market : null;
    function has(list) { return (list || []).some(function (n) { return nameKey(n) === name; }); }
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

  function create(config) {
    config = config || {};
    var wt = config['work-types'] || {};
    var qaCfg = wt.qa || {};
    var cme = qaCfg.cme || DEFAULT_QA.cme;
    var comparerConfig = { 'work-types': wt };
    if (config['sites']) comparerConfig['sites'] = config['sites'];
    var comparer = Compare.create(comparerConfig);
    var normalise = comparer.normalise;
    var pathOf = comparer.pathOf;

    function cmeLink(pattern, id) { return id ? pattern.split('{id}').join(id) : null; }

    // options.brief (optional): with a brief, QA is also the comparison —
    // one report, the brief's findings and the page's own in the same five
    // categories, coverage on top. Without one it is QA on the page alone.
    // options.workTypeId decides which playbook the brief is read with.
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
      var formId = comparer.formIdFinding(expect, page);
      var market = comparer.marketOf(expect, page);

      var facts = {
        canonical: page.canonical || null,
        environment: environmentOf(page.canonical),
        tcmId: tcmId,
        tcmRaw: tcmRaw || null,
        cmeNewUi: cmeLink(cme.newUi, tcmId),
        cmeOldUi: cmeLink(cme.oldUi, tcmId),
        lang: page.lang || null,
        dataLang: page.dataLang || null,
        market: market ? (market.ambiguous ? market.base + ' (language version not determined)' : market.name) : null,
        robots: robotsTag ? attr(robotsTag, 'content') : null,
        digitalData: page.digitalData || null,
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
        .concat(linkTextFindings(comparer.mainRegion(html).html, qaCfg, normalise));

      // The title naming rule, scored for each title the page carries.
      var entries = comparer.siteEntries();
      var formatRows = [];
      if (!page.pageName || !normalise(page.pageName)) {
        formatRows.push({ field: 'Title format', source: 'page title', expected: null, found: null,
          state: 'red', stateLabel: 'no title', soft: false, basis: 'expected' });
      }
      titlesOf(page, normalise).forEach(function (t) {
        var score = titleFormat(t.title, market, entries, normalise);
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

      return {
        generatedAt: new Date().toISOString(),
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
        regionVia: page.regionVia
      };
    }

    return { run: run };
  }

  return { create: create, DEFAULT_QA: DEFAULT_QA };
}));

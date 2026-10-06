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

  function titleFindings(page, normalise) {
    var out = [];
    var titles = [];
    if (!page.pageName || !normalise(page.pageName)) {
      out.push({ category: 'metadata', severity: 'break', field: 'Page title', note: 'the page has no <title>' });
    } else {
      titles.push(['Page title', page.pageName]);
    }
    if (page.metaTitle && normalise(page.metaTitle) !== normalise(page.pageName || '')) {
      titles.push(['og:title', page.metaTitle]);
    }

    titles.forEach(function (t) {
      var parts = normalise(t[1]).split(TITLE_SPLIT).map(titleKey).filter(Boolean);
      var seen = {}, doubled = null;
      parts.forEach(function (p) { if (seen[p]) doubled = p; seen[p] = true; });
      if (doubled) {
        out.push({
          category: 'metadata', severity: 'check', field: t[0], known: true, found: t[1],
          note: 'double title — "' + doubled + '" appears twice'
        });
        return;
      }
      // Only the trailing segments carry the site name; the first is the
      // page's own subject and routinely contains the brand ("KONE MonoSpace").
      var tail = parts.slice(1);
      for (var i = 0; i < tail.length; i++) {
        for (var j = 0; j < tail.length; j++) {
          if (i !== j && (' ' + tail[j] + ' ').indexOf(' ' + tail[i] + ' ') !== -1) {
            out.push({
              category: 'metadata', severity: 'check', field: t[0], known: true, found: t[1],
              note: 'partial duplicate — "' + tail[i] + '" repeats inside "' + tail[j] + '"'
            });
            return;
          }
        }
      }
    });
    return out;
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
    if (config['form-ids']) comparerConfig['form-ids'] = config['form-ids'];
    var comparer = Compare.create(comparerConfig);
    var normalise = comparer.normalise;
    var pathOf = comparer.pathOf;

    function cmeLink(pattern, id) { return id ? pattern.split('{id}').join(id) : null; }

    function run(html) {
      html = String(html == null ? '' : html);
      var page = comparer.readPage(html);
      var head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html);
      var headHtml = head ? head[1] : html;

      var robotsTag = metaTag(headHtml, 'robots');
      var tcmTag = metaTag(headHtml, 'pagetcmid');
      var tcmRaw = tcmTag ? (attr(tcmTag, 'content') || '').trim() : '';
      var tcmId = /^tcm:\d+-\d+(-\d+)?$/i.test(tcmRaw) ? tcmRaw : null;
      var formId = comparer.formIdFinding(null, page);

      var facts = {
        canonical: page.canonical || null,
        environment: environmentOf(page.canonical),
        tcmId: tcmId,
        tcmRaw: tcmRaw || null,
        cmeNewUi: cmeLink(cme.newUi, tcmId),
        cmeOldUi: cmeLink(cme.oldUi, tcmId),
        lang: page.lang || null,
        dataLang: page.dataLang || null,
        market: formId.country || null,
        robots: robotsTag ? attr(robotsTag, 'content') : null,
        digitalData: page.digitalData || null,
        hreflang: []
      };

      // Start from everything compare.js already finds on the page alone.
      var pageOnly = comparer.pageOnlyCategories(page);
      var byId = {};
      CATEGORIES.forEach(function (c) { byId[c[0]] = { id: c[0], label: c[1], deviations: [], rows: [] }; });
      pageOnly.categories.forEach(function (c) {
        if (!byId[c.id]) return;
        c.deviations.forEach(function (d) {
          // QA counts H1s its own way (document-wide, visible only) below.
          if (c.id === 'metadata' && d.field === 'H1') return;
          byId[c.id].deviations.push(d);
        });
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
      function row(field, source, value) {
        return { field: field, source: source, expected: null, found: value || null,
          state: value ? 'present' : 'absent', soft: false };
      }
      byId.metadata.rows = [
        row('Page title', '<title>', page.pageName),
        row('Meta title', 'og:title', page.metaTitle),
        row('Meta description', null, page.description),
        row('Canonical', null, page.canonical),
        row('Robots', '<meta name="robots">', facts.robots),
        row('Indexing', 'digitalData', facts.digitalData &&
          [facts.digitalData.indexOptions, facts.digitalData.followLinksOptions].filter(Boolean).join(', ')),
        row('hreflang', '<link rel="alternate">', facts.hreflang.length
          ? facts.hreflang.map(function (a) { return a.code; }).join(', ') : null)
      ];

      // Body copy is judged against a brief; from the page alone the only
      // check is an empty Tridion field, which needs field markers to see.
      var hasFields = (page.modules || []).some(function (mod) { return mod.fields && mod.fields.length; });
      if (!byId.body.deviations.length && !hasFields) {
        byId.body.note = 'Body copy is checked against a brief, in Compare. From the page alone only an empty ' +
          'Tridion field can be caught, and this page carries no component field markers — so nothing here was checked.';
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

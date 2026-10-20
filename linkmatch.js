/* linkmatch.js — where should this link go, and does it go there?
 *
 * Given a site's sitemap, QA can say more about a link than "it has no
 * destination". It can name the page a dead call to action should point at
 * ("Learn more about KONE JumpLift" → /en/…/kone-jumplift.aspx), and judge
 * whether a working link goes somewhere sensible:
 *
 *   red    no destination; bare text; or a site path missing the language
 *          prefix every page on the site carries (/new-buildings/… where the
 *          real path is /en/new-buildings/…)
 *   green  the page it goes to is the page its text names
 *   amber  it goes to a listing page when a dedicated page exists, or to a
 *          page about something else, or to a path the sitemap does not list
 *
 * Generic text ("Get in touch") and links to other sites are not judged for
 * relevance — there is nothing in the text to judge them by, and other sites
 * are the link-status check's business.
 *
 * A team ruling ("MonoSpace 100 DX → /elevators/ is amber") is recorded in
 * config/link-rulings.json and applies only while both the text and the
 * target still match, so a link that changes is judged afresh rather than
 * excused by an old decision.
 *
 * Matching is token overlap between the link text and the page's address —
 * deterministic, no dictionary, no model. It reads the same links QA does
 * (comparer.readPage), so nothing is parsed twice.
 *
 * Runs in the browser (window.BriefLinks) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefLinks = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Words a link's text spends on being a link — "learn more about our",
  // "scopri di più" — in the six languages QA already knows, plus the brand
  // itself, which names every page and so tells pages apart not at all.
  // Generic call-to-action wording ("Explore options", "Start now") is here
  // too: it says nothing about where a link goes, so such a link is judged
  // by the component it sits in instead (contextOf below).
  var STOP = ('learn more about read find out discover explore see view get go to visit click here now touch ' +
    'option options start started begin continue browse try today ' +
    'opzioni inizia opciones comenzar empezar opcoes comecar optionen starten beginnen commencer ' +
    'the a an and or of for to in on at by with from your you our us we this that all its it is are ' +
    'kone corporation page link more info information details ' +
    'scopri di piu leggi qui maggiori informazioni il la le lo gli i un una del della dei delle per con su ' +
    'saiba mais leia aqui o os as um uma do da dos das para com em ' +
    'leer mas aqui haga clic el los las un una del para con en sobre nuestro nuestra ' +
    'mehr erfahren hier klicken der die das ein eine und fur mit zu uber unsere ' +
    'en savoir plus lire la suite ici le les un une des du pour avec sur notre nos').split(/\s+/);
  var STOP_SET = {};
  STOP.forEach(function (w) { STOP_SET[w] = true; });

  // Sections whose pages are articles about something, not the thing itself:
  // a press release about the JumpLift is never where "Learn more about
  // KONE JumpLift" should go. Named here for the common cases; any section
  // the sitemap shows holding dozens of pages is treated the same way.
  var EDITORIAL = ['news', 'news-insights', 'press-releases', 'press', 'stories', 'references', 'blogs', 'blog',
    'articles', 'notizie', 'noticias', 'noticias-y-referencias', 'aktuelles', 'actualites', 'case-studies'];
  var BULK_SECTION = 40;

  function fold(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
    return s.toLowerCase();
  }

  function stem(t) {
    if (/^\d+$/.test(t) || t.length <= 3) return t;
    if (/ies$/.test(t) && t.length > 5) return t.slice(0, -3) + 'y';
    if (/(ss|us|is)$/.test(t)) return t;
    if (/s$/.test(t)) return t.slice(0, -1);
    return t;
  }

  // The words in a link's text that could name a page.
  function tokens(text) {
    var out = [], seen = {};
    fold(text).replace(/[™®©]/g, ' ').split(/[^a-z0-9]+/).forEach(function (w) {
      if (!w || STOP_SET[w]) return;
      var t = stem(w);
      if (!t || STOP_SET[t] || seen[t]) return;
      seen[t] = true;
      out.push(t);
    });
    return out;
  }

  function slugTokens(segment) {
    return tokens(String(segment || '').replace(/[-_]+/g, ' '));
  }

  // A sitemap.xml (its <loc> values) or a plain list, one URL per line or
  // separated by spaces. Anything that is not an http(s) URL is skipped.
  function parseSitemap(text) {
    text = String(text || '');
    var urls = [], seen = {}, m;
    var locs = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
    var found = false;
    while ((m = locs.exec(text)) !== null) {
      found = true;
      add(m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').trim());
    }
    if (!found) text.split(/\s+/).forEach(function (t) { if (!/^#/.test(t)) add(t.trim()); });
    function add(u) {
      if (!/^https?:\/\/[^\s]+$/i.test(u) || seen[u]) return;
      seen[u] = true;
      urls.push(u);
    }
    return urls;
  }

  function hostOf(url) {
    var m = /^(?:https?:)?\/\/([^/?#:]+)/i.exec(String(url || '').trim());
    return m ? m[1].toLowerCase() : '';
  }
  function clip(s) { s = String(s || ''); return s.length > 60 ? s.slice(0, 57).replace(/\s+\S*$/, '') + '…' : s; }

  function siteHost(host) { return String(host || '').replace(/^(www|preview(-[a-z]+)?)\./, ''); }

  function create(options) {
    options = options || {};
    var pathOf = options.pathOf;
    if (typeof pathOf !== 'function') throw new Error('BriefLinks.create needs pathOf');
    var rulings = (options.rulings && options.rulings.rulings) || options.rulings || [];
    if (!Array.isArray(rulings)) rulings = [];

    // ─── THE SITEMAP, INDEXED ──────────────────────────────────────────────

    function index(urls, meta) {
      meta = meta || {};
      var entries = [], byPath = {}, firstSegs = {}, sections = {};
      (urls || []).forEach(function (url) {
        var path = pathOf(url);
        if (byPath[path]) return;
        var segs = path.split('/').filter(Boolean);
        var e = { url: url, path: path, segs: segs };
        byPath[path] = e;
        entries.push(e);
        if (segs[0]) firstSegs[segs[0]] = (firstSegs[segs[0]] || 0) + 1;
      });
      // The language prefix, if the site has one: a short first segment
      // carried by most of its pages (/en/…).
      var prefix = null, best = 0;
      Object.keys(firstSegs).forEach(function (k) { if (firstSegs[k] > best) { best = firstSegs[k]; prefix = k; } });
      if (!prefix || prefix.length > 5 || !/^[a-z]{2}(-[a-z]{2})?$/.test(prefix) || best < entries.length * 0.6) prefix = null;
      var depth0 = prefix ? 1 : 0;
      entries.forEach(function (e) {
        var rest = e.segs.slice(depth0);
        e.rest = rest;
        e.last = slugTokens(rest[rest.length - 1] || '');
        var all = {};
        rest.forEach(function (s) { slugTokens(s).forEach(function (t) { all[t] = true; }); });
        e.all = all;
        // Children counted per section path, to spot bulk editorial sections.
        for (var i = 1; i < rest.length; i++) {
          var key = rest.slice(0, i).join('/');
          sections[key] = (sections[key] || 0) + 1;
        }
      });
      entries.forEach(function (e) {
        e.editorial = e.rest.some(function (s, i) {
          if (EDITORIAL.indexOf(s) !== -1) return true;
          return i < e.rest.length - 1 && (sections[e.rest.slice(0, i + 1).join('/')] || 0) >= BULK_SECTION;
        });
      });
      return { entries: entries, byPath: byPath, prefix: prefix, count: entries.length,
        source: meta.source || null, host: meta.host || (entries[0] ? siteHost(hostOf(entries[0].url)) : null) };
    }

    // How well a page's address covers the words in a link's text. The last
    // segment — the page's own name — counts double; its own words the text
    // does not mention cost a little, so the dedicated page beats a longer one.
    function score(textTokens, e) {
      if (!textTokens.length) return 0;
      var lastSet = {};
      e.last.forEach(function (t) { lastSet[t] = true; });
      var got = 0;
      textTokens.forEach(function (t) { got += lastSet[t] ? 2 : e.all[t] ? 1 : 0; });
      var extra = e.last.filter(function (t) { return textTokens.indexOf(t) === -1; }).length;
      return got / (2 * textTokens.length) - 0.05 * extra;
    }

    function suggest(text, idx, opts) {
      opts = opts || {};
      var tt = tokens(text);
      if (!idx || !tt.length) return { tokens: tt, suggestions: [], confident: false };
      var wantsEditorial = tt.some(function (t) { return EDITORIAL.indexOf(t) !== -1 || /^(news|stor|press|reference|blog)/.test(t); });
      var ranked = idx.entries
        .filter(function (e) { return (wantsEditorial || !e.editorial) && e.path !== opts.exclude; })
        .map(function (e) { return { entry: e, score: score(tt, e) }; })
        .filter(function (r) { return r.score > 0.2; })
        .sort(function (a, b) { return b.score - a.score || a.entry.path.length - b.entry.path.length; })
        .slice(0, 3);
      var top = ranked[0], second = ranked[1];
      var confident = !!top && top.score >= 0.5 && (!second || top.score - second.score >= 0.1 ||
        second.entry.path.indexOf(top.entry.path + '/') === 0);
      return {
        tokens: tt,
        confident: confident,
        suggestions: ranked.map(function (r) {
          var named = tt.filter(function (t) { return r.entry.all[t]; });
          return { url: r.entry.url, path: r.entry.path, score: Math.round(r.score * 100) / 100,
            why: named.length ? 'its address names ' + named.join(', ') : 'closest match' };
        })
      };
    }

    // Pages a component's title names in full: every word of the page's own
    // name (its last address segment) appears in the title. Most such words
    // first, so "elevator upgrades" beats "elevators"; then the shorter path.
    function contextSuggest(headTokens, idx, exclude) {
      if (!idx || !headTokens.length) return [];
      var have = {};
      headTokens.forEach(function (t) { have[t] = true; });
      return idx.entries
        .filter(function (e) {
          return !e.editorial && e.path !== exclude && e.last.length &&
            e.last.every(function (t) { return have[t]; });
        })
        .sort(function (a, b) { return b.last.length - a.last.length || a.path.length - b.path.length; })
        .slice(0, 3)
        .map(function (e) {
          return { url: e.url, path: e.path, score: e.last.length, words: e.last.length,
            why: 'its address names ' + e.last.join(', ') + ', as the component\'s title does' };
        });
    }

    // ─── JUDGING THE PAGE'S LINKS ──────────────────────────────────────────

    function ruleFor(text, targetPath, host) {
      var plain = String(text || '').replace(/\s+/g, ' ').trim();
      for (var i = 0; i < rulings.length; i++) {
        var r = rulings[i];
        if (r.site && host && siteHost(host) !== siteHost(r.site)) continue;
        var re;
        try { re = new RegExp(r.text, 'i'); } catch (e) { continue; }
        if (!re.test(plain)) continue;
        if (pathOf(r.target) !== targetPath) continue;
        return r;
      }
      return null;
    }

    // ctx: { page (comparer.readPage), canonical, index (from index()), host }
    function audit(ctx) {
      var page = ctx.page || {};
      var idx = ctx.index || null;
      var canonical = ctx.canonical || page.canonical || '';
      var host = siteHost(ctx.host || hostOf(canonical) || (idx && idx.host) || '');
      var ownPath = canonical ? pathOf(canonical) : null;
      var rows = [], seen = {};

      function push(row) {
        var key = row.kind + '|' + row.text + '|' + (row.href || '');
        if (seen[key]) { seen[key].count++; return; }
        row.count = 1;
        seen[key] = row;
        rows.push(row);
      }
      function withSuggestions(row, opts, at) {
        var s = suggest(row.text, idx, opts);
        row.suggestions = s.suggestions;
        row.confident = s.confident;
        // Generic or empty text names nothing; the component's title may.
        if (!s.tokens.length && at != null) {
          var c = contextOf(at, row.text);
          row.suggestions = contextSuggest(c.headTokens, idx, ownPath);
          row.confident = !!row.suggestions[0] && row.suggestions[0].words >= 2;
          if (c.heading) row.context = { heading: c.heading };
        }
        return row;
      }

      // The component a link sits in: its title (the nearest visible heading
      // or accordion question before it) and the few paragraphs between that
      // title and the link. Offsets are readPage's, all in the same region.
      var titles = (page.headings || []).filter(function (h) { return !h.hidden && h.text; })
        .concat(page.triggerHeadings || [])
        .sort(function (a, b) { return a.at - b.at; });
      function contextOf(at, ownText) {
        var heading = null;
        titles.forEach(function (h) { if (h.at < at) heading = h; });
        var body = (page.paragraphs || []).filter(function (p) {
          return p.at < at && (!heading || p.at > heading.at) && p.text !== ownText;
        }).slice(heading ? -4 : -2).map(function (p) { return p.text; }).join(' ');
        return { heading: heading ? heading.text : null,
          headTokens: heading ? tokens(heading.text) : [], bodyTokens: tokens(body) };
      }

      (page.placeholderLinks || []).forEach(function (l) {
        push(withSuggestions({ kind: 'placeholder', text: l.text || '(no label)', href: l.href || '', verdict: 'red',
          reason: l.href === '#' ? 'the link still points at href="#"' : 'the link has no destination' }, {}, l.at));
      });
      (page.deadCtas || []).forEach(function (c) {
        push(withSuggestions({ kind: 'dead-cta', text: c.text, href: null, verdict: 'red',
          reason: 'a call to action written as bare text, with no link' }, {}, c.at));
      });

      (page.links || []).forEach(function (l) {
        var href = String(l.href || '').trim();
        var text = String(l.text || '').replace(/\s+/g, ' ').trim();
        if (/^(javascript:|~\/)/i.test(href)) {
          push(withSuggestions({ kind: 'placeholder', text: text || '(no label)', href: href, verdict: 'red',
            reason: href.charAt(0) === '~' ? 'a CMS-relative path (~/) that never resolves on the live site' : 'the link runs script instead of going anywhere' }));
          return;
        }
        if (/^(mailto:|tel:)/i.test(href)) return;
        var linkHost = hostOf(href);
        if (linkHost && siteHost(linkHost) !== host) return; // another site: link-status judges it
        var anchor = (/#(.+)$/.exec(href) || [])[1] || null;
        var target = pathOf(href);
        var tt = tokens(text);

        // A site path missing the language prefix every page carries.
        if (idx && idx.prefix && target.split('/')[1] !== idx.prefix) {
          var fixed = '/' + idx.prefix + (target === '/' ? '' : target);
          var fixedKnown = idx.byPath[fixed] || fixed === ownPath;
          if (fixedKnown) {
            var same = fixed === ownPath;
            push({ kind: 'link', text: text, href: href, target: target, verdict: 'red',
              reason: 'the path is missing the /' + idx.prefix + '/ every page on this site carries, so it does not resolve',
              suggestions: [{ url: same && anchor ? '#' + anchor : '/' + idx.prefix + href.replace(/^\/+/, '/'),
                path: fixed, score: 1,
                why: same ? 'it points back at this page — an in-page anchor is all it needs' : 'the same path with the /' + idx.prefix + '/ prefix is in the sitemap' }],
              confident: true });
            return;
          }
        }

        // Home and other root links, and text with nothing in it to judge.
        if (target === '/' || (idx && idx.prefix && target === '/' + idx.prefix)) return;
        if (!idx) return;

        var known = idx.byPath[target] || null;
        var isSelf = target === ownPath;
        // Generic text ("Explore options", "Learn more") promises nothing of
        // its own, so the component around it — its title and body — is
        // what the destination is judged against.
        if (!tt.length) {
          if (!known && !isSelf) {
            push(withSuggestions({ kind: 'link', text: text || '(no label)', href: href, target: target, verdict: 'amber',
              reason: 'the sitemap does not list this path' }, {}, l.at));
            return;
          }
          if (isSelf || !known.last.length) return;
          var c = contextOf(l.at, text);
          var inContext = {};
          c.headTokens.concat(c.bodyTokens).forEach(function (t) { inContext[t] = true; });
          var about = c.heading ? 'its component "' + clip(c.heading) + '"' : 'the text around it';
          var generic = { kind: 'link', text: text || '(no label)', href: href, target: target, suggestions: [], confident: true };
          if (c.heading) generic.context = { heading: c.heading };
          if (known.last.every(function (t) { return inContext[t]; })) {
            generic.verdict = 'green';
            generic.reason = 'generic link text — judged by ' + about + ', which is about ' + known.last.join(', ') + ', like the page it goes to';
          } else {
            var alt = contextSuggest(c.headTokens, idx, target);
            if (!alt.length || alt[0].words < 2) return; // nothing firm to compare against: not guessed at
            generic.verdict = 'amber';
            generic.reason = 'generic link text in ' + about + '; the page it goes to (' + target + ') is not about ' +
              alt[0].path.split('/').pop().replace(/[-_]+/g, ' ') + ' — a page that is exists';
            generic.suggestions = alt;
          }
          var gRule = ruleFor(text, target, host);
          if (gRule) {
            generic.verdict = gRule.verdict;
            generic.ruling = { id: gRule.id, note: gRule.note || null };
            generic.reason = (gRule.note || 'team ruling') + ' (ruling ' + gRule.id + ')';
          }
          push(generic);
          return;
        }

        var s = suggest(text, idx, {});
        var best = s.suggestions[0] || null;
        var row = { kind: 'link', text: text, href: href, target: target, suggestions: [], confident: s.confident };
        if (!known && !isSelf) {
          row.verdict = 'amber';
          row.reason = 'the sitemap does not list this path';
          row.suggestions = s.suggestions;
        } else if (isSelf) {
          row.verdict = 'green';
          row.reason = 'links to this page itself';
        } else {
          var mine = score(tt, known);
          var lastNamed = known.last.length && known.last.every(function (t) { return tt.indexOf(t) !== -1; });
          var better = best && best.path !== target && best.score > mine + 0.05 && best.score >= 0.5;
          if (better && best.path.indexOf(target + '/') === 0) {
            row.verdict = 'amber';
            row.reason = 'goes to the listing page ' + target + ' — a dedicated page exists';
            row.suggestions = s.suggestions.filter(function (x) { return x.path !== target; });
          } else if (lastNamed || (mine >= 0.6 && !better)) {
            row.verdict = 'green';
            row.reason = 'the page it goes to is the one its text names';
          } else if (better) {
            row.verdict = 'amber';
            row.reason = 'the text names ' + tt.join(', ') + '; a better-matching page exists';
            row.suggestions = s.suggestions.filter(function (x) { return x.path !== target; });
          } else {
            row.verdict = 'amber';
            row.reason = 'the page exists, but its address (' + target + ') is not about "' + tt.join(', ') +
              '", which the text names — check it is the destination meant';
            row.suggestions = s.suggestions.filter(function (x) { return x.path !== target; });
            if (!row.suggestions.length) row.reason += '; no other page in the sitemap is named for "' + tt.join(', ') + '" either';
          }
        }
        var rule = ruleFor(text, target, host);
        if (rule) {
          row.verdict = rule.verdict;
          row.ruling = { id: rule.id, note: rule.note || null };
          row.reason = (rule.note || 'team ruling') + ' (ruling ' + rule.id + ')';
        }
        push(row);
      });

      var counts = { red: 0, amber: 0, green: 0 };
      rows.forEach(function (r) { counts[r.verdict] = (counts[r.verdict] || 0) + 1; });
      return { rows: rows, counts: counts, prefix: idx ? idx.prefix : null };
    }

    return { index: index, suggest: suggest, audit: audit, tokens: tokens };
  }

  return { create: create, parseSitemap: parseSitemap, tokens: tokens };
}));

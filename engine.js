/* engine.js — WCM Brief Analyser.
 *
 * Four questions, in order, and nothing else:
 *   1. What kind of work is this?
 *   2. Which CMS is the target site on?
 *   3. What does that kind of work need, and what is here?
 *   4. What are the steps in that CMS?
 *
 * Deterministic and dependency-free: the same brief always produces the same
 * object, and every decision carries the signals that produced it so a human
 * can check the working rather than trust it.
 *
 * The playbooks live in config/work-types.json. This file knows how to match,
 * not what to match.
 *
 * Runs in the browser (window.BriefEngine) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── TEXT MATCHING ───────────────────────────────────────────────────────
  // Terms out of config routinely contain regex metacharacters (".aspx",
  // "/content/dam/"), so everything is escaped. Word boundaries are applied
  // only on the sides where the term actually starts or ends with a word
  // character — "\b/content/\b" would never match anything.

  var reCache = {};

  function termRegex(term) {
    if (!reCache[term]) {
      var esc = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var pre = /^[a-z0-9]/i.test(term) ? '\\b' : '';
      var post = /[a-z0-9]$/i.test(term) ? '\\b' : '';
      reCache[term] = new RegExp(pre + esc + post, 'i');
    }
    return reCache[term];
  }

  function hasTerm(text, term) { return termRegex(term).test(text); }

  // ─── URLS ────────────────────────────────────────────────────────────────
  // Every asset now lives in Adobe DAM whichever CMS serves the page, so a DAM
  // link says nothing about the site's platform. Site URLs and DAM URLs are
  // separated here once and kept apart everywhere downstream.

  var URL_RE = /https?:\/\/[^\s<>"')\]]+/gi;

  function splitUrls(text, cmsConfig) {
    var damHosts = cmsConfig.damHosts || [];
    var damMarkers = cmsConfig.damPathMarkers || [];
    var site = [], dam = [], seen = {}, m;

    URL_RE.lastIndex = 0;
    while ((m = URL_RE.exec(text)) !== null) {
      var url = m[0].replace(/[.,;:]+$/, '');
      var low = url.toLowerCase();
      var isDam = damHosts.some(function (h) { return low.indexOf(h.toLowerCase()) !== -1; }) ||
                  damMarkers.some(function (p) { return low.indexOf(p.toLowerCase()) !== -1; });
      if (isDam) { dam.push(url); continue; }
      if (seen[low]) continue;
      seen[low] = true;
      site.push(url);
    }
    return { site: site, dam: dam };
  }

  // Lines carrying two or more distinct site URLs are the giveaway for a
  // redirect list — those briefs are often nothing but source/destination rows
  // and never say the word "redirect".
  function countUrlPairRows(text, cmsConfig) {
    return text.split(/\r?\n/).filter(function (line) {
      return splitUrls(line, cmsConfig).site.length >= 2;
    }).length;
  }

  // ─── SIGNALS ─────────────────────────────────────────────────────────────
  // Structural facts about the brief. Both classification and the per-need
  // checks read from here, so "what decided this" is always one list.

  // Latin-1 Supplement through Latin Extended-B — the accented letters that
  // mark text written in a market's own language. Symbols like ™ sit outside
  // this range, so a trademark in English copy does not read as translation.
  var ACCENTED_RE = /[À-ɏ]/;

  function readSignals(text, cmsConfig) {
    var urls = splitUrls(text, cmsConfig);
    var lines = text.split(/\r?\n/);
    var accented = (text.match(/[À-ɏ]/g) || []).length;
    var sectionMarkers = (text.match(/\[\d+\.\d+\]/g) || []).length;
    var paragraphs = lines.filter(function (l) { return l.trim().length >= 200; }).length;

    // A localization brief is a table: field name, English master, local
    // language. Counting rows that are both tabular AND carry accented text
    // finds that shape without mistaking a tab-separated redirect list (whose
    // cells are all ASCII URLs) for a translation.
    var translatedRows = lines.filter(function (l) {
      return l.indexOf('\t') !== -1 && ACCENTED_RE.test(l);
    }).length;

    // A lone "x" in its own column marks the source page for removal. That is
    // what separates a takedown sheet from a plain redirect sheet: both pair
    // source with destination, but only a removal also retires the old page.
    var removalRows = lines.filter(function (l) {
      return /(^|\t)\s*x\s*(\t|$)/i.test(l) && splitUrls(l, cmsConfig).site.length >= 1;
    }).length;

    return {
      hasSiteUrl: urls.site.length >= 1,
      hasTwoSiteUrls: urls.site.length >= 2,
      hasContentPath: /\/content\/[a-z0-9\-/]+/i.test(text) || /^\s*\/[a-z0-9][a-z0-9\-/]*\/\s*$/im.test(text),
      hasDamAsset: urls.dam.length >= 1 || /aem assets\s*[-–]/i.test(text),
      urlPairRows: countUrlPairRows(text, cmsConfig) >= 1,
      removalMarkers: removalRows >= 1,
      hasSections: sectionMarkers >= 2,
      hasLongBody: paragraphs >= 3,
      translatedColumns: translatedRows >= 3,
      nonEnglishText: accented >= 8,
      _urls: urls
    };
  }

  // ─── CMS ─────────────────────────────────────────────────────────────────

  function hostOf(url) {
    var m = /^https?:\/\/([^/?#]+)/i.exec(url);
    return m ? m[1].toLowerCase().replace(/:\d+$/, '') : '';
  }

  // Most of the estate is still Tridion, so AEM is the exception rather than
  // the default: a market is on AEM only once it appears in aemMarkets. A page
  // ending .aspx is Tridion whatever market it sits on, which is what an
  // un-migrated page on an otherwise-migrated site looks like.
  function detectCms(text, cmsConfig, signals, override) {
    if (override) return { value: override, reason: 'Set by hand.' };

    var urls = signals._urls.site;
    if (!urls.length) {
      return { value: 'Unknown', reason: 'No target site URL in the brief, so the platform cannot be read off it.' };
    }

    var markers = cmsConfig.tridionMarkers || [];
    var aspx = null;
    urls.forEach(function (url) {
      if (aspx) return;
      markers.forEach(function (mk) {
        if (!aspx && url.toLowerCase().indexOf(mk.toLowerCase()) !== -1) aspx = { url: url, marker: mk };
      });
    });
    if (aspx) return { value: 'Tridion', reason: 'The page URL carries ' + aspx.marker + ' — ' + aspx.url };

    var host = hostOf(urls[0]);
    var market = (cmsConfig.aemMarkets || []).filter(function (suffix) {
      return host.slice(-suffix.length) === suffix.toLowerCase();
    })[0];

    if (market) return { value: 'AEM', reason: host + ' is a migrated market (' + market + ').' };

    return {
      value: cmsConfig['default'] || 'Tridion',
      reason: host + ' is not one of the migrated markets (' +
        (cmsConfig.aemMarkets || []).join(', ') + '), so it is still on Tridion.'
    };
  }

  // ─── CLASSIFICATION ──────────────────────────────────────────────────────

  function scoreType(text, signals, type) {
    var matched = [], score = 0;
    (type.signals || []).forEach(function (s) {
      var hit = s.signal ? signals[s.signal] === true : hasTerm(text, s.term);
      if (!hit) return;
      score += s.weight;
      matched.push({ label: s.signal ? s.signal : s.term, weight: s.weight, kind: s.signal ? 'signal' : 'term' });
    });
    return { id: type.id, label: type.label, summary: type.summary, score: score, matched: matched, definition: type };
  }

  function classify(text, signals, types, override) {
    var scores = types.map(function (t) { return scoreType(text, signals, t); })
      .sort(function (a, b) { return b.score - a.score || a.label.localeCompare(b.label); });

    if (override) {
      var picked = scores.filter(function (s) { return s.id === override; })[0];
      if (picked) {
        return { winner: picked, alternatives: scores, overridden: true, confident: true };
      }
    }

    var top = scores[0];
    var runnerUp = scores[1];
    // Two ways to be unsure: nothing matched at all, or the runner-up is level
    // with the winner. Either way say so rather than guess.
    var confident = top.score > 0 && (!runnerUp || top.score > runnerUp.score);

    return { winner: top, alternatives: scores, overridden: false, confident: confident };
  }

  // ─── NEEDS ───────────────────────────────────────────────────────────────

  function checkNeeds(text, signals, type) {
    var have = [], missing = [];
    (type.needs || []).forEach(function (need) {
      var met = (need.detect || []).some(function (rule) {
        if (rule.signal) return signals[rule.signal] === true;
        return new RegExp(rule.regex, 'i').test(text);
      });
      (met ? have : missing).push({ id: need.id, label: need.label, question: need.question });
    });
    return { have: have, missing: missing };
  }

  // ─── PUBLIC ──────────────────────────────────────────────────────────────

  function create(config) {
    var cfg = config['work-types'];
    var cmsConfig = cfg.cms || {};
    var types = cfg.workTypes;

    function analyse(rawText, options) {
      options = options || {};
      var text = String(rawText == null ? '' : rawText);

      var signals = readSignals(text, cmsConfig);
      var cms = detectCms(text, cmsConfig, signals, options.cmsOverride);
      var result = classify(text, signals, types, options.workTypeOverride);
      var type = result.winner;
      var needs = checkNeeds(text, signals, type.definition);

      var steps = (type.definition.steps || {})[cms.value] || [];

      return {
        generatedAt: new Date().toISOString(),
        cms: { value: cms.value, reason: cms.reason },
        workType: {
          id: type.id,
          label: type.label,
          summary: type.summary,
          score: type.score,
          matched: type.matched,
          confident: result.confident,
          overridden: result.overridden,
          alternatives: result.alternatives.map(function (s) {
            return { id: s.id, label: s.label, score: s.score };
          })
        },
        needs: needs,
        steps: steps.map(function (text, i) { return { n: i + 1, text: text }; }),
        questions: needs.missing.map(function (n) { return n.question; }),
        urls: { site: signals._urls.site, dam: signals._urls.dam },
        ready: needs.missing.length === 0 && cms.value !== 'Unknown'
      };
    }

    return {
      analyse: analyse,
      workTypes: types.map(function (t) { return { id: t.id, label: t.label, summary: t.summary }; })
    };
  }

  return { create: create };
}));

/* engine.js — WCM Brief Analyser scoring engine.
 *
 * Deterministic and dependency-free. The same input always produces the same
 * output object, and every classification carries the keywords that produced it
 * so a human can check the tool's working rather than trust it.
 *
 * All dictionaries live in /config/*.json — nothing that a WCM author might
 * need to extend (a new component, a newly-discovered bug, another market) is
 * hardcoded here. This file only knows how to score, not what to score.
 *
 * The engine emits one canonical result object; the UI renders from it and
 * never re-derives analysis of its own. A later agent layer can call analyse()
 * as a tool and read the same object.
 *
 * Runs in the browser (window.BriefEngine) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefEngine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── TEXT MATCHING ───────────────────────────────────────────────────────
  // Terms come from config and contain regex metacharacters as a matter of
  // course ("robots.txt", "?custom-tag=", "/content/", "|"), so everything is
  // escaped. Word boundaries are applied only on the sides where the term
  // actually starts/ends with a word character — "\b/content/\b" would never
  // match anything.

  var reCache = {};

  function termRegex(term) {
    if (reCache[term]) { reCache[term].lastIndex = 0; return reCache[term]; }
    var esc = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pre = /^[a-z0-9]/i.test(term) ? '\\b' : '';
    var post = /[a-z0-9]$/i.test(term) ? '\\b' : '';
    var re = new RegExp(pre + esc + post, 'gi');
    reCache[term] = re;
    return re;
  }

  function hasTerm(text, term) {
    var re = termRegex(term);
    re.lastIndex = 0;
    return re.test(text);
  }

  function matchesOf(text, pattern, flags) {
    var re = new RegExp(pattern, flags || 'gi');
    var out = [], m, guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 500) {
      out.push(m[0]);
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    return out;
  }

  function unique(list) {
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var k = String(list[i]).toLowerCase();
      if (!seen[k]) { seen[k] = 1; out.push(list[i]); }
    }
    return out;
  }

  function includes(list, value) {
    for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
    return false;
  }

  // ─── DETECTORS ───────────────────────────────────────────────────────────
  // A field detector is either a regex against the brief, or a named signal
  // computed once per analysis (component found, market found, URL present…).

  function detectorFires(detector, text, signals) {
    if (detector.signal) return !!signals[detector.signal];
    if (detector.regex) return new RegExp(detector.regex, detector.flags || 'i').test(text);
    return false;
  }

  function fieldPresent(field, text, signals) {
    var detectors = field.detect || [];
    for (var i = 0; i < detectors.length; i++) {
      if (detectorFires(detectors[i], text, signals)) return true;
    }
    return false;
  }

  // ─── LOCATION, MARKET, ENVIRONMENT ───────────────────────────────────────

  function detectPaths(text, locations) {
    var found = [];
    var patterns = locations.pathPatterns || [];
    for (var i = 0; i < patterns.length; i++) {
      var hits = matchesOf(text, patterns[i].regex, 'gi');
      for (var j = 0; j < hits.length; j++) found.push({ type: patterns[i].id, value: hits[j] });
    }
    return found;
  }

  // Environments are matched longest-context-first and each hit is blanked out
  // of the working copy, so "pre-prod" cannot also register as "prod".
  function detectEnvironments(text, locations) {
    var work = text.toLowerCase();
    var order = ['PRE-PROD', 'STAGE', 'DEV', 'QA', 'PROD'];
    var defs = locations.environments || [];
    var found = [];
    for (var o = 0; o < order.length; o++) {
      for (var d = 0; d < defs.length; d++) {
        if (defs[d].code !== order[o]) continue;
        var terms = defs[d].terms || [];
        for (var t = 0; t < terms.length; t++) {
          var re = termRegex(terms[t]);
          re.lastIndex = 0;
          if (re.test(work)) {
            if (!includes(found, defs[d].code)) found.push(defs[d].code);
            work = work.replace(termRegex(terms[t]), function (m) { return new Array(m.length + 1).join(' '); });
          }
        }
      }
    }
    return found;
  }

  // Country codes are the main source of false positives, so they are gated
  // three ways rather than one:
  //
  //   · a full country name is unambiguous — no gate;
  //   · a code inside a path or URL segment (/content/frontlines/uk/en, en_AU)
  //     is a market by construction — lowercase is the convention there;
  //   · a code in prose must be ALL-CAPS *and* sit within `anchorWindow` tokens
  //     of a market anchor ("site", "market", "rollout to").
  //
  // The prose case needs both halves. The anchor window alone lets "It should
  // roll out…" register as Italy, because a pronoun happily sits next to a
  // rollout verb; the caps rule alone would fire on "the IT department". A
  // market code written as a market code is capitalised — a pronoun is not.
  function detectMarkets(text, locations) {
    var countries = locations.countries || [];
    var anchors = locations.marketAnchors || [];
    var window_ = locations.anchorWindow || 4;
    var lower = text.toLowerCase();

    var rawTokens = text.split(/[^A-Za-z0-9]+/).filter(function (t) { return t.length > 0; });
    var lowerTokens = rawTokens.map(function (t) { return t.toLowerCase(); });

    // Segments of every path/URL in the brief, split on the separators that
    // actually appear in AEM paths and locale strings (en_AU, en-GB).
    var pathSegments = {};
    (locations.pathPatterns || []).forEach(function (pattern) {
      matchesOf(text, pattern.regex, 'gi').forEach(function (hit) {
        hit.split(/[\/_\-.:]+/).forEach(function (segment) {
          if (segment) pathSegments[segment.toLowerCase()] = true;
        });
      });
    });

    var found = [], reasons = {};

    for (var c = 0; c < countries.length; c++) {
      var country = countries[c];
      var code = country.code.toLowerCase();
      var reason = null;

      if (hasTerm(lower, country.name.toLowerCase())) reason = 'country name';
      else if (pathSegments[code]) reason = 'path or URL segment';
      else {
        for (var i = 0; i < lowerTokens.length && !reason; i++) {
          if (lowerTokens[i] !== code) continue;
          if (rawTokens[i] !== country.code.toUpperCase()) continue; // prose codes must be capitalised
          var from = Math.max(0, i - window_);
          var to = Math.min(lowerTokens.length, i + window_ + 1);
          var context = lowerTokens.slice(from, to).join(' ');
          for (var a = 0; a < anchors.length; a++) {
            if (context.indexOf(anchors[a].toLowerCase()) !== -1) { reason = 'country code with market context'; break; }
          }
        }
      }

      if (reason) {
        var already = false;
        for (var f = 0; f < found.length; f++) if (found[f].code === country.code) already = true;
        if (!already) { found.push(country); reasons[country.code] = reason; }
      }
    }
    return { markets: found, reasons: reasons };
  }

  function detectRegions(text, locations) {
    var out = [];
    var regions = locations.regions || [];
    for (var i = 0; i < regions.length; i++) {
      var terms = regions[i].terms || [];
      for (var t = 0; t < terms.length; t++) {
        if (hasTerm(text, terms[t])) { out.push(regions[i]); break; }
      }
    }
    return out;
  }

  function detectPageType(text, components) {
    var map = components.pageTypes || {};
    var best = null, bestScore = 0;
    for (var key in map) {
      if (!Object.prototype.hasOwnProperty.call(map, key)) continue;
      var score = 0;
      for (var i = 0; i < map[key].length; i++) if (hasTerm(text, map[key][i])) score++;
      if (score > bestScore) { bestScore = score; best = key; }
    }
    return best;
  }

  // ─── CMS DETECTION ───────────────────────────────────────────────────────
  // Sharper fingerprints (author host, /content/, Structure Group, Publication
  // ID) carry weight 3 in config; generic platform words carry less. Both
  // platforms present is not a tie to break — it is what a migration brief
  // legitimately looks like, so it gets its own state.

  function detectCms(text, locations, override) {
    var signals = locations.cmsSignals || {};
    var result = { aemScore: 0, tridionScore: 0, aemMatched: [], tridionMatched: [] };

    ['AEM', 'Tridion'].forEach(function (platform) {
      var list = signals[platform] || [];
      for (var i = 0; i < list.length; i++) {
        if (hasTerm(text, list[i].term)) {
          if (platform === 'AEM') { result.aemScore += list[i].weight; result.aemMatched.push(list[i]); }
          else { result.tridionScore += list[i].weight; result.tridionMatched.push(list[i]); }
        }
      }
    });

    var value;
    if (result.aemScore > 0 && result.tridionScore > 0) value = 'Mixed';
    else if (result.aemScore > 0) value = 'AEM';
    else if (result.tridionScore > 0) value = 'Tridion';
    else value = 'Unspecified';

    var detected = value;
    if (override === 'AEM' || override === 'Tridion') value = override;

    return {
      value: value,
      label: value === 'Mixed' ? 'Mixed — Migration context' : value,
      detected: detected,
      overridden: !!override && override !== detected,
      // Execution steps are CMS-specific, so an unspecified platform is a stop,
      // not a default. "Mixed" is workable — migration sequences cover both.
      requiresManualSelection: value === 'Unspecified',
      aem: { score: result.aemScore, matched: result.aemMatched },
      tridion: { score: result.tridionScore, matched: result.tridionMatched }
    };
  }

  // ─── WORK TYPE SCORING ───────────────────────────────────────────────────
  // Every type is scored against the whole brief; the highest total wins. A
  // term counts once however often it appears — repetition is emphasis, not
  // evidence, and counting it would let one word outvote a whole type.

  function scoreWorkTypes(text, workTypes) {
    var scores = [];
    for (var i = 0; i < workTypes.length; i++) {
      var type = workTypes[i];
      var total = 0, matched = [];
      for (var k = 0; k < type.keywords.length; k++) {
        var kw = type.keywords[k];
        if (hasTerm(text, kw.term)) { total += kw.weight; matched.push({ term: kw.term, weight: kw.weight }); }
      }
      matched.sort(function (a, b) { return b.weight - a.weight; });
      scores.push({ id: type.id, label: type.label, score: total, matchedKeywords: matched });
    }
    scores.sort(function (a, b) { return b.score - a.score || a.label.localeCompare(b.label); });
    return scores;
  }

  function classify(scores, options, override, workTypes) {
    var margin = options.margin;
    var top = scores[0];
    var runnerUp = scores.length > 1 ? scores[1] : null;
    var confidence = 0;

    if (top && top.score > 0) {
      var denom = top.score + (runnerUp ? runnerUp.score : 0);
      confidence = Math.round((top.score / denom) * 100);
    }

    // Three separate ways a classification fails to be trustworthy, and all of
    // them land in the same "Ambiguous — please confirm" state:
    //   · nothing matched at all;
    //   · the runner-up is within the margin;
    //   · the winner is built only of weak, cross-type words. A brief like
    //     "publish the updated content to the page" beats the margin test on a
    //     33% lead while carrying no actual evidence — a floor on the winning
    //     score, and a requirement for at least one medium/strong signal, is
    //     what stops that from being reported as a confident answer.
    var ambiguous = false;
    var strongest = 0;
    if (top) {
      for (var m = 0; m < top.matchedKeywords.length; m++) {
        strongest = Math.max(strongest, top.matchedKeywords[m].weight);
      }
    }

    if (!top || top.score === 0) ambiguous = true;
    else if (runnerUp && runnerUp.score > 0 && (top.score - runnerUp.score) / top.score < margin) ambiguous = true;
    else if (top.score < options.minConfidentScore) ambiguous = true;
    else if (options.requireNonWeakSignal && strongest < 2) ambiguous = true;

    var chosen = top;
    if (override) {
      for (var i = 0; i < scores.length; i++) if (scores[i].id === override) chosen = scores[i];
    }

    var definition = null;
    for (var w = 0; w < workTypes.length; w++) if (chosen && workTypes[w].id === chosen.id) definition = workTypes[w];

    return {
      id: chosen ? chosen.id : null,
      label: chosen ? chosen.label : 'Unclassified',
      score: chosen ? chosen.score : 0,
      confidence: override ? 100 : confidence,
      matchedKeywords: chosen ? chosen.matchedKeywords : [],
      runnerUp: runnerUp && runnerUp.score > 0
        ? { id: runnerUp.id, label: runnerUp.label, score: runnerUp.score,
            confidence: Math.round((runnerUp.score / (top.score + runnerUp.score)) * 100) }
        : null,
      ambiguous: override ? false : ambiguous,
      overridden: !!override,
      definition: definition
    };
  }

  // ─── COMPONENTS & ASSETS ─────────────────────────────────────────────────

  function detectComponents(text, components) {
    var identified = [];
    var list = components.components || [];
    for (var i = 0; i < list.length; i++) {
      var comp = list[i];
      var hits = [];
      for (var t = 0; t < comp.triggers.length; t++) {
        if (hasTerm(text, comp.triggers[t])) hits.push(comp.triggers[t]);
      }
      if (hits.length) {
        identified.push({
          id: comp.id, name: comp.name, platform: comp.platform, type: comp.type,
          matchedTriggers: hits, note: comp.note || '',
          effortAuthor: comp.effortAuthor, effortQA: comp.effortQA
        });
      }
    }
    return identified;
  }

  // The second pass: components a page of this type would normally carry but
  // which the brief never mentions. Only meaningful when a page is being built
  // or rebuilt — nudging a bug report about its missing Grid Block is noise.
  function recommendComponents(pageType, identifiedIds, components, workTypeDef) {
    if (!pageType || !workTypeDef || !workTypeDef.pageCreation) return [];
    var order = components.recommendOrder || [];
    var list = components.components || [];
    var candidates = [];

    for (var i = 0; i < list.length; i++) {
      var comp = list[i];
      if (includes(identifiedIds, comp.id)) continue;
      if (comp.platform === 'Tridion') continue;
      if (!comp.pageTypes || !includes(comp.pageTypes, pageType)) continue;
      if (comp.id === 'exf') continue; // sitewide by definition, never a page-level omission
      candidates.push(comp);
    }

    candidates.sort(function (a, b) {
      var ai = order.indexOf(a.id), bi = order.indexOf(b.id);
      if (ai === -1) ai = 999;
      if (bi === -1) bi = 999;
      return ai - bi;
    });

    return candidates.slice(0, 6).map(function (c) {
      return { id: c.id, name: c.name, reason: 'Commonly present on a ' + pageType + ' page but not mentioned in the brief' };
    });
  }

  function detectAssets(text, identified, components, signals, workTypeId) {
    // Asset gaps only matter where content is actually being authored.
    var authoringTypes = ['new-page', 'content-update', 'migration', 'exf-update'];
    if (!includes(authoringTypes, workTypeId)) return { required: [], supplied: [], missing: [] };

    var catalogue = components.assets || {};
    var byId = {};
    var list = components.components || [];
    for (var i = 0; i < list.length; i++) byId[list[i].id] = list[i];

    var required = {};
    for (var c = 0; c < identified.length; c++) {
      var def = byId[identified[c].id];
      if (!def) continue;
      var assets = def.requiredAssets || [];
      for (var a = 0; a < assets.length; a++) {
        if (!required[assets[a]]) required[assets[a]] = [];
        required[assets[a]].push(identified[c].name);
      }
    }

    var supplied = [], missing = [];
    for (var key in required) {
      if (!Object.prototype.hasOwnProperty.call(required, key)) continue;
      var asset = catalogue[key];
      if (!asset) continue;
      var present = false;
      for (var d = 0; d < (asset.detect || []).length; d++) {
        if (detectorFires(asset.detect[d], text, signals)) { present = true; break; }
      }
      var entry = { id: key, label: asset.label, forComponents: unique(required[key]), question: asset.question };
      if (present) supplied.push(entry); else missing.push(entry);
    }

    return { required: Object.keys(required), supplied: supplied, missing: missing };
  }

  // ─── COMPLETENESS ────────────────────────────────────────────────────────

  function scoreCompleteness(workTypeDef, fields, text, signals, thresholds) {
    var result = { score: 0, rag: 'red', present: [], missing: [], optional: [] };
    if (!workTypeDef) return result;

    var required = workTypeDef.requiredFields || [];
    for (var i = 0; i < required.length; i++) {
      var field = fields[required[i]];
      if (!field) continue;
      var entry = { id: required[i], label: field.label, question: field.question };
      if (fieldPresent(field, text, signals)) result.present.push(entry);
      else result.missing.push(entry);
    }

    var optional = workTypeDef.optionalFields || [];
    for (var o = 0; o < optional.length; o++) {
      var opt = fields[optional[o]];
      if (!opt) continue;
      result.optional.push({
        id: optional[o], label: opt.label, question: opt.question,
        present: fieldPresent(opt, text, signals)
      });
    }

    var total = result.present.length + result.missing.length;
    result.score = total === 0 ? 100 : Math.round((result.present.length / total) * 100);
    result.rag = result.score >= thresholds.green ? 'green' : (result.score >= thresholds.amber ? 'amber' : 'red');
    return result;
  }

  // ─── HARD BLOCKS & RISK FLAGS ────────────────────────────────────────────

  function evaluateConditions(ctx) {
    return {
      noLocation: ctx.paths.length === 0,
      noComponents: ctx.components.length === 0,
      multiMarket: ctx.markets.length > 1 || ctx.globalScope,
      noApprover: !ctx.approverPresent,
      cmsUnspecified: ctx.cms.value === 'Unspecified',
      s1Declared: /\bs1\b|blocker/i.test(ctx.text),
      prodOnly: ctx.environments.length === 1 && ctx.environments[0] === 'PROD'
    };
  }

  function findHardBlocks(riskFlags, workTypeId, completeness, conditions) {
    var blocks = [];
    var defs = riskFlags.hardBlocks || [];
    var missingIds = completeness.missing.map(function (m) { return m.id; });

    for (var i = 0; i < defs.length; i++) {
      var def = defs[i];
      if (def.workTypes && !includes(def.workTypes, workTypeId)) continue;
      var fires = false;
      if (def.condition && conditions[def.condition]) fires = true;
      if (def.missingField && includes(missingIds, def.missingField)) fires = true;
      if (fires) blocks.push({ id: def.id, label: def.label, detail: def.detail, question: def.question });
    }
    return blocks;
  }

  var SEVERITY_RANK = { S1: 0, S2: 1, S3: 2, S4: 3 };

  function findRiskFlags(riskFlags, text, componentIds, workTypeId, workTypeDef, conditions) {
    var out = [];
    var defs = riskFlags.flags || [];
    var standing = (workTypeDef && workTypeDef.riskFlags) || [];

    for (var i = 0; i < defs.length; i++) {
      var flag = defs[i];
      var triggers = flag.triggers || {};
      var why = [];

      var kws = triggers.keywords || [];
      for (var k = 0; k < kws.length; k++) if (hasTerm(text, kws[k])) { why.push('brief mentions "' + kws[k] + '"'); break; }

      var comps = triggers.components || [];
      for (var c = 0; c < comps.length; c++) if (includes(componentIds, comps[c])) { why.push('component in scope'); break; }

      var types = triggers.workTypes || [];
      if (includes(types, workTypeId)) why.push('inherent to this work type');

      var conds = triggers.conditions || [];
      for (var n = 0; n < conds.length; n++) if (conditions[conds[n]]) { why.push('condition: ' + conds[n]); break; }

      var triggered = why.length > 0;
      var isStanding = includes(standing, flag.id);
      if (!triggered && !isStanding) continue;

      out.push({
        id: flag.id, label: flag.label, severity: flag.severity,
        component: flag.component, environment: flag.environment,
        workaround: flag.workaround,
        source: triggered ? 'triggered' : 'standing',
        why: triggered ? why : ['known risk for ' + (workTypeDef ? workTypeDef.label : 'this work type')]
      });
    }

    out.sort(function (a, b) {
      if (a.source !== b.source) return a.source === 'triggered' ? -1 : 1;
      return (SEVERITY_RANK[a.severity] || 9) - (SEVERITY_RANK[b.severity] || 9);
    });
    return out;
  }

  // ─── EFFORT TIER ─────────────────────────────────────────────────────────

  var TIERS = ['Small', 'Medium', 'Complex'];

  function effortTier(workTypeDef, ctx) {
    var base = (workTypeDef && workTypeDef.baseEffort) || 'Medium';
    var index = TIERS.indexOf(base);
    if (index === -1) index = 1;
    var reasons = ['Base tier for ' + (workTypeDef ? workTypeDef.label : 'this work type') + ': ' + base];

    if (ctx.multiMarket) { index = 2; reasons.push('Multi-market scope escalates to Complex'); }
    if (ctx.urlCount >= 5) { index = Math.max(index, 2); reasons.push(ctx.urlCount + ' URLs in scope'); }
    if (index < 2 && ctx.componentCount >= 3) { index = Math.max(index, 1); reasons.push(ctx.componentCount + ' components involved'); }
    if (index < 2 && ctx.urlCount >= 2) { index = Math.max(index, 1); reasons.push('More than one page in scope'); }

    return { tier: TIERS[index], reasons: reasons };
  }

  // ─── EXECUTION STEPS ─────────────────────────────────────────────────────

  function executionSteps(workTypeDef, cms, executionConfig) {
    if (!workTypeDef || cms.value === 'Unspecified') return [];
    var map = workTypeDef.executionSteps || {};
    var key = map[cms.value] || map[cms.value === 'Mixed' ? 'Mixed' : ''] || map.AEM || null;
    if (!key) return [];
    var seq = (executionConfig.sequences || {})[key] || [];
    return seq.map(function (step, i) {
      return { n: i + 1, action: step.action, instruction: step.instruction };
    });
  }

  // ─── CLARIFYING QUESTIONS ────────────────────────────────────────────────
  // Structured, not strings baked into the UI: each carries the field id it
  // came from so a later agent layer can send it, take the reply, and re-score.

  function buildQuestions(analysis) {
    var questions = [];

    analysis.hardBlocks.forEach(function (block) {
      questions.push({ id: 'block:' + block.id, type: 'block', field: null, question: block.question });
    });

    if (analysis.workType.ambiguous && analysis.workType.runnerUp) {
      questions.push({
        id: 'open:classification', type: 'open', field: null,
        question: 'This reads as either a ' + analysis.workType.label + ' or a ' +
          analysis.workType.runnerUp.label + ' — which is it?'
      });
    }

    if (analysis.cms.requiresManualSelection) {
      questions.push({ id: 'open:cms', type: 'open', field: null, question: 'Is this on AEM or Tridion? Execution steps differ between them.' });
    }

    if (analysis.conditions.multiMarket) {
      questions.push({
        id: 'open:scope', type: 'open', field: null,
        question: 'Is this meant for one market, or should it roll out everywhere? One-Ticket-Per-Market means each country needs its own ticket.'
      });
    }

    analysis.completeness.missing.forEach(function (field) {
      questions.push({ id: 'field:' + field.id, type: 'field', field: field.id, question: field.question });
    });

    analysis.assets.missing.forEach(function (asset) {
      questions.push({ id: 'asset:' + asset.id, type: 'asset', field: null, question: asset.question });
    });

    if (analysis.components.recommended.length) {
      questions.push({
        id: 'open:components', type: 'open', field: null,
        question: 'This looks like a ' + analysis.location.pageType + ' page. Should it also include ' +
          analysis.components.recommended.map(function (c) { return c.name; }).join(', ') + '?'
      });
    }

    var seen = {};
    return questions.filter(function (q) {
      if (seen[q.question]) return false;
      seen[q.question] = 1;
      return true;
    });
  }

  // ─── SYNTHESIS ───────────────────────────────────────────────────────────

  function synthesise(a) {
    var parts = [];
    var article = /^[aeiou]/i.test(a.workType.label) ? 'an' : 'a';
    var platform = a.cms.value === 'Unspecified' ? ', with the CMS platform not yet established' : ' on ' + a.cms.label;
    var what = a.workType.ambiguous
      ? 'This brief does not clearly resolve to one work type'
      : 'This is ' + article + ' ' + a.workType.label + platform;
    parts.push(what + '.');

    if (a.components.identified.length) {
      parts.push('It involves ' + a.components.identified.map(function (c) { return c.name; }).join(', ') + '.');
    } else {
      parts.push('No component is named or implied, so there is nothing concrete to action yet.');
    }

    if (a.location.paths.length) {
      parts.push('Target location: ' + a.location.paths[0].value + '.');
    }
    var globalScope = a.location.regions.some(function (r) { return r.code === 'GLOBAL'; });
    if (a.location.markets.length || globalScope) {
      var scope = a.location.markets.map(function (m) { return m.code; }).join(', ');
      if (globalScope) {
        parts.push('Scope reads as all markets' + (scope ? ' (named: ' + scope + ')' : '') +
          ', so it needs splitting into one ticket per market.');
      } else if (a.location.markets.length > 1) {
        parts.push('Market scope: ' + scope + ' — more than one market, so this needs splitting per market.');
      } else {
        parts.push('Market scope: ' + scope + '.');
      }
    }
    if (a.location.environments.length) {
      parts.push('Environment: ' + a.location.environments.join(', ') + '.');
    }
    if (a.assets.missing.length) {
      parts.push('Missing assets: ' + a.assets.missing.map(function (x) { return x.label; }).join(', ') + '.');
    }

    var blockers = a.riskFlags.filter(function (f) { return f.severity === 'S1' || f.severity === 'S2'; });
    if (a.hardBlocks.length) {
      parts.push(a.hardBlocks.length + ' hard block' + (a.hardBlocks.length > 1 ? 's' : '') +
        ' must be resolved before this can start.');
    } else if (blockers.length) {
      parts.push('Watch: ' + blockers[0].label + '.');
    }

    return parts.join(' ');
  }

  // ─── PUBLIC API ──────────────────────────────────────────────────────────

  function create(config) {
    var workTypesConfig = config['work-types'];
    var componentsConfig = config.components;
    var riskFlagsConfig = config['risk-flags'];
    var locationsConfig = config.locations;
    var executionConfig = config['execution-steps'];

    function analyse(rawText, options) {
      options = options || {};
      var text = String(rawText || '');
      var thresholds = workTypesConfig.ragThresholds || { green: 80, amber: 50 };
      var margin = typeof workTypesConfig.ambiguityMargin === 'number' ? workTypesConfig.ambiguityMargin : 0.15;

      // 1. Nature of work + CMS
      var scores = scoreWorkTypes(text, workTypesConfig.workTypes);
      var workType = classify(scores, {
        margin: margin,
        minConfidentScore: typeof workTypesConfig.minConfidentScore === 'number' ? workTypesConfig.minConfidentScore : 0,
        requireNonWeakSignal: workTypesConfig.requireNonWeakSignal !== false
      }, options.workTypeOverride, workTypesConfig.workTypes);
      var cms = detectCms(text, locationsConfig, options.cmsOverride);

      // 2. Location, market, environment
      var paths = detectPaths(text, locationsConfig);
      var marketResult = detectMarkets(text, locationsConfig);
      var regions = detectRegions(text, locationsConfig);
      var environments = detectEnvironments(text, locationsConfig);
      var pageType = detectPageType(text, componentsConfig);
      var globalScope = regions.some(function (r) { return r.code === 'GLOBAL'; });

      // 3. Components
      var identified = detectComponents(text, componentsConfig);
      var identifiedIds = identified.map(function (c) { return c.id; });
      var recommended = recommendComponents(pageType, identifiedIds, componentsConfig, workType.definition);

      // Signals feed the field detectors, so they are computed before scoring.
      var signals = {
        urlPresent: paths.length > 0,
        contentPathPresent: paths.some(function (p) { return p.type === 'aem-content-path'; }),
        componentsIdentified: identified.length > 0,
        marketDetected: marketResult.markets.length > 0 || regions.length > 0,
        multipleMarkets: marketResult.markets.length > 1,
        environmentDetected: environments.length > 0
      };

      // 4. Assets
      var assets = detectAssets(text, identified, componentsConfig, signals, workType.id);

      // 5. Completeness
      var completeness = scoreCompleteness(workType.definition, workTypesConfig.fields, text, signals, thresholds);

      var approverField = workTypesConfig.fields.named_approver;
      var conditions = evaluateConditions({
        text: text, paths: paths, components: identified,
        markets: marketResult.markets, globalScope: globalScope,
        approverPresent: fieldPresent(approverField, text, signals),
        cms: cms, environments: environments
      });

      var hardBlocks = findHardBlocks(riskFlagsConfig, workType.id, completeness, conditions);
      var flags = findRiskFlags(riskFlagsConfig, text, identifiedIds, workType.id, workType.definition, conditions);
      var tier = effortTier(workType.definition, {
        multiMarket: conditions.multiMarket,
        urlCount: paths.filter(function (p) { return p.type === 'url'; }).length,
        componentCount: identified.length
      });
      var steps = executionSteps(workType.definition, cms, executionConfig);

      var analysis = {
        generatedAt: new Date().toISOString(),
        input: { text: text, length: text.length },
        summary: text.replace(/\s+/g, ' ').trim().substring(0, 300),
        workType: {
          id: workType.id, label: workType.label, score: workType.score,
          confidence: workType.confidence, ambiguous: workType.ambiguous,
          overridden: workType.overridden, matchedKeywords: workType.matchedKeywords,
          runnerUp: workType.runnerUp
        },
        allScores: scores,
        cms: cms,
        location: {
          paths: paths, markets: marketResult.markets, marketReasons: marketResult.reasons,
          regions: regions, environments: environments, pageType: pageType
        },
        components: { identified: identified, recommended: recommended },
        assets: assets,
        completeness: completeness,
        conditions: conditions,
        hardBlocks: hardBlocks,
        riskFlags: flags,
        effort: tier,
        executionSteps: steps
      };

      analysis.questions = buildQuestions(analysis);
      analysis.synthesis = synthesise(analysis);
      return analysis;
    }

    // Interactive refinement: an answer is just more brief text. It goes back
    // through the same scoring path rather than being special-cased, so the
    // result stays as explainable as a first-pass analysis.
    function refine(originalText, answers, options) {
      var appended = String(originalText || '');
      (answers || []).forEach(function (a) {
        if (!a || !a.answer) return;
        appended += '\n' + (a.question ? a.question + ' ' : '') + a.answer;
      });
      return analyse(appended, options);
    }

    return { analyse: analyse, refine: refine, config: config };
  }

  return { create: create, _internals: { hasTerm: hasTerm, detectMarkets: detectMarkets, detectEnvironments: detectEnvironments } };
}));

/* feedback.js — correction capture and the curation queue (plan §10.2).
 *
 * Deliberately NOT learning. Nothing here reweights the classifier. A tool that
 * feeds release gates has to be predictable, and a scorer that quietly drifts
 * from user answers is a worse failure than one that is legibly wrong: you can
 * argue with a wrong answer you can see the working for.
 *
 * So corrections are logged, aggregated, and shown to whoever maintains the
 * config as a proposed dictionary edit. The dictionaries change when a person
 * commits a JSON change — same audit trail as any other config change.
 *
 * Storage is localStorage; no backend, and it survives across sessions.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefFeedback = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var KEY = 'wcm-brief-analyser.corrections.v1';

  // Words too generic to ever be worth proposing as a trigger keyword.
  var STOPWORDS = ('the a an and or but if then this that these those to for of on in at by with from as is are was were be been ' +
    'it its we you they i our your their please can could should would need needs needed want make made new update updates ' +
    'change changes page pages site sites content will have has had do does did not no yes all any some more most').split(' ');

  function create(options) {
    options = options || {};
    var storage = options.storage || (typeof localStorage !== 'undefined' ? localStorage : memoryStorage());
    var config = options.config || {};

    function memoryStorage() {
      var data = {};
      return {
        getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
        setItem: function (k, v) { data[k] = String(v); },
        removeItem: function (k) { delete data[k]; }
      };
    }

    function all() {
      try { return JSON.parse(storage.getItem(KEY) || '[]'); }
      catch (e) { return []; }
    }

    function save(list) {
      try { storage.setItem(KEY, JSON.stringify(list.slice(-500))); }
      catch (e) { /* quota or private mode — the queue is advisory, so losing it is survivable */ }
    }

    function record(correction) {
      var list = all();
      list.push({
        at: new Date().toISOString(),
        kind: correction.kind,
        excerpt: String(correction.excerpt || '').replace(/\s+/g, ' ').trim().substring(0, 240),
        engineGuess: correction.engineGuess || null,
        actual: correction.actual || null,
        confidence: typeof correction.confidence === 'number' ? correction.confidence : null
      });
      save(list);
      return list.length;
    }

    function clear() { storage.removeItem(KEY); }

    // Terms already known to the dictionary for a given work type — a proposal
    // to add a keyword that is already there is noise.
    function knownTerms(workTypeId) {
      var known = {};
      var types = (config['work-types'] && config['work-types'].workTypes) || [];
      for (var i = 0; i < types.length; i++) {
        if (types[i].id !== workTypeId) continue;
        for (var k = 0; k < types[i].keywords.length; k++) known[types[i].keywords[k].term.toLowerCase()] = true;
      }
      return known;
    }

    function tokenise(text) {
      return String(text).toLowerCase().split(/[^a-z0-9-]+/).filter(function (t) {
        return t.length > 3 && STOPWORDS.indexOf(t) === -1;
      });
    }

    // Aggregate the log into proposals a maintainer can act on: which
    // misclassification keeps happening, and which term keeps showing up when
    // it does. Nothing is applied — this is a suggestion to edit a JSON file.
    function queue() {
      var list = all();
      var groups = {};

      list.forEach(function (entry) {
        if (entry.kind !== 'work-type' || !entry.actual) return;
        var key = (entry.engineGuess || 'none') + '→' + entry.actual;
        if (!groups[key]) groups[key] = { engineGuess: entry.engineGuess, actual: entry.actual, count: 0, terms: {} };
        groups[key].count++;
        var seen = {};
        tokenise(entry.excerpt).forEach(function (term) {
          if (seen[term]) return;
          seen[term] = 1;
          groups[key].terms[term] = (groups[key].terms[term] || 0) + 1;
        });
      });

      var proposals = [];
      Object.keys(groups).forEach(function (key) {
        var group = groups[key];
        var known = knownTerms(group.actual);
        var candidates = Object.keys(group.terms)
          .filter(function (t) { return group.terms[t] >= 2 && !known[t]; })
          .sort(function (a, b) { return group.terms[b] - group.terms[a]; })
          .slice(0, 5)
          .map(function (t) { return { term: t, count: group.terms[t] }; });

        proposals.push({
          engineGuess: group.engineGuess,
          actual: group.actual,
          count: group.count,
          candidateTerms: candidates,
          suggestion: candidates.length
            ? 'Seen ' + group.count + ' time(s). "' + candidates[0].term + '" appeared in ' + candidates[0].count +
              ' of them — add it as a trigger keyword for ' + group.actual + ' in work-types.json?'
            : 'Seen ' + group.count + ' time(s), but no repeated distinctive term yet. Needs more examples before a dictionary edit is justified.'
        });
      });

      return proposals.sort(function (a, b) { return b.count - a.count; });
    }

    return { record: record, all: all, queue: queue, clear: clear, _key: KEY };
  }

  return { create: create };
}));

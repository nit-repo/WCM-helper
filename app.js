/* app.js — the whole UI.
 *
 * The engine emits one result object; this file only renders it. No analysis
 * of its own, no second opinion about a brief.
 */
(function () {
  'use strict';

  var state = { engine: null, analysis: null };

  var el = {
    brief: document.getElementById('brief'),
    analyse: document.getElementById('analyse-btn'),
    sample: document.getElementById('sample-btn'),
    clear: document.getElementById('clear-btn'),
    copy: document.getElementById('copy-btn'),
    cms: document.getElementById('cms-select'),
    type: document.getElementById('type-select'),
    output: document.getElementById('output'),
    toast: document.getElementById('toast')
  };

  var SAMPLE = [
    'https://www.kone.dk/dxexperiments.aspx\tx\thttps://www.kone.dk/',
    'https://www.kone.dk/searchresults.aspx\tx\thttps://www.kone.dk/',
    'https://www.kone.dk/campaign/24-7-connect-escalators/\tx\thttps://www.kone.dk/'
  ].join('\n');

  // ─── BOOT ────────────────────────────────────────────────────────────────

  fetch('config/work-types.json')
    .then(function (r) {
      if (!r.ok) throw new Error('config/work-types.json returned ' + r.status);
      return r.json();
    })
    .then(function (workTypes) {
      state.engine = window.BriefEngine.create({ 'work-types': workTypes });
      state.engine.workTypes.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.label;
        el.type.appendChild(o);
      });
      el.analyse.disabled = false;
    })
    .catch(function (e) {
      el.output.innerHTML = '<div class="empty-state"><p><strong>Could not load the playbooks.</strong></p>' +
        '<p>' + esc(e.message) + '</p><p>Run <code>npm start</code> and open the served URL — ' +
        'the config is fetched at runtime, so opening the file from disk will not work.</p></div>';
    });

  // ─── EVENTS ──────────────────────────────────────────────────────────────

  el.analyse.addEventListener('click', run);
  el.cms.addEventListener('change', function () { if (state.analysis) run(); });
  el.type.addEventListener('change', function () { if (state.analysis) run(); });
  el.sample.addEventListener('click', function () { el.brief.value = SAMPLE; run(); });
  el.clear.addEventListener('click', function () {
    el.brief.value = '';
    el.cms.value = '';
    el.type.value = '';
    state.analysis = null;
    el.copy.disabled = true;
    renderEmpty();
  });
  el.copy.addEventListener('click', copyQuestions);

  function run() {
    var text = el.brief.value.trim();
    if (!text) { toast('Paste a brief first.'); return; }

    state.analysis = state.engine.analyse(text, {
      cmsOverride: el.cms.value || null,
      workTypeOverride: el.type.value || null
    });
    el.copy.disabled = state.analysis.questions.length === 0;
    render(state.analysis);
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  function render(a) {
    el.output.innerHTML = [
      renderType(a),
      renderNeeds(a),
      renderSteps(a),
      renderMissing(a)
    ].join('');
  }

  function renderType(a) {
    var signals = a.workType.matched.map(function (m) {
      return '<li><span>' + esc(m.label) + (m.kind === 'signal' ? ' <em>(structure)</em>' : '') +
        '</span><span>+' + m.weight + '</span></li>';
    }).join('');

    var note = '';
    if (a.workType.overridden) {
      note = '<p class="note">Set by hand.</p>';
    } else if (!a.workType.confident) {
      note = '<p class="note warn">Not a confident call — nothing clearly marks this brief as one kind of ' +
        'job. Pick the work type by hand on the left.</p>';
    }

    return section('1 · Type of work',
      '<p class="headline">' + esc(a.workType.label) + '</p>' +
      '<p class="sub">' + esc(a.workType.summary) + '</p>' +
      note +
      '<p class="cms"><strong>' + esc(a.cms.value) + '</strong> — ' + esc(a.cms.reason) + '</p>' +
      (signals ? '<details><summary>Why</summary><ul class="signals">' + signals + '</ul></details>' : '')
    );
  }

  function renderNeeds(a) {
    var rows = a.needs.have.map(function (n) {
      return '<li><span class="tick">✓</span> ' + esc(n.label) + '</li>';
    }).concat(a.needs.missing.map(function (n) {
      return '<li><span class="cross">✗</span> ' + esc(n.label) + '</li>';
    })).join('');

    return section('2 · What this needs', '<ul class="needs">' + rows + '</ul>');
  }

  function renderSteps(a) {
    if (a.cms.value === 'Unknown') {
      return section('3 · How to do it',
        '<p class="note warn">Held back until the CMS is known. Add the target site URL to the brief, ' +
        'or set the platform on the left.</p>');
    }
    var steps = a.steps.map(function (s) { return '<li>' + esc(s.text) + '</li>'; }).join('');
    return section('3 · How to do it in ' + esc(a.cms.value), '<ol class="steps">' + steps + '</ol>');
  }

  function renderMissing(a) {
    if (!a.questions.length) {
      return section('4 · Missing to complete',
        '<p class="ready">Nothing missing. This brief is ready to action.</p>');
    }
    var qs = a.questions.map(function (q) { return '<li>' + esc(q) + '</li>'; }).join('');
    return section('4 · Missing to complete',
      '<p class="sub">Send these back to whoever raised the brief.</p><ul class="questions">' + qs + '</ul>');
  }

  function section(title, body) {
    return '<section class="card"><h3>' + esc(title) + '</h3>' + body + '</section>';
  }

  function renderEmpty() {
    el.output.innerHTML =
      '<div class="empty-state"><p>Paste a brief and hit <strong>Analyse</strong>. You get back four things:</p>' +
      '<ol><li>What kind of job this is, and which CMS the site is on</li>' +
      '<li>What that kind of job needs, and what the brief already has</li>' +
      '<li>The steps to do it in that CMS</li>' +
      '<li>What is still missing, as questions to send back</li></ol>' +
      '<p>Every call shows the signals behind it, so you can check its working rather than trust it.</p></div>';
  }

  // ─── HELPERS ─────────────────────────────────────────────────────────────

  function copyQuestions() {
    if (!state.analysis || !state.analysis.questions.length) return;
    var text = state.analysis.questions.map(function (q, i) { return (i + 1) + '. ' + q; }).join('\n');
    navigator.clipboard.writeText(text)
      .then(function () { toast('Questions copied.'); })
      .catch(function () { toast('Could not copy — select and copy by hand.'); });
  }

  var toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  renderEmpty();
}());

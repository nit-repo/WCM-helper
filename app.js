/* app.js — the whole UI.
 *
 * The engine emits one result object; this file only renders it. No analysis
 * of its own, no second opinion about a brief.
 */
(function () {
  'use strict';

  var state = { engine: null, comparer: null, filler: null, analysis: null, mode: 'analyse', market: null };

  var el = {
    brief: document.getElementById('brief'),
    analyse: document.getElementById('analyse-btn'),
    sample: document.getElementById('sample-btn'),
    clear: document.getElementById('clear-btn'),
    copy: document.getElementById('copy-btn'),
    cms: document.getElementById('cms-select'),
    type: document.getElementById('type-select'),
    output: document.getElementById('output'),
    toast: document.getElementById('toast'),
    tabAnalyse: document.getElementById('tab-analyse'),
    tabCompare: document.getElementById('tab-compare'),
    compareInput: document.getElementById('compare-input'),
    compareBtn: document.getElementById('compare-btn'),
    html: document.getElementById('html'),
    htmlUpload: document.getElementById('html-upload-btn'),
    htmlClear: document.getElementById('html-clear-btn'),
    htmlFile: document.getElementById('html-file'),
    pageUrl: document.getElementById('page-url'),
    launch: document.getElementById('launch-btn'),
    briefUpload: document.getElementById('brief-upload-btn'),
    briefFile: document.getElementById('brief-file'),
    tabFill: document.getElementById('tab-fill'),
    fillInput: document.getElementById('fill-input'),
    fillBtn: document.getElementById('fill-btn'),
    english: document.getElementById('english'),
    marketOverride: document.getElementById('market-override'),
    marketSelect: document.getElementById('market-select'),
    tabIndicator: document.querySelector('.tab-indicator')
  };

  // ─── MOTION ──────────────────────────────────────────────────────────────
  // Results roll into place as they render, and again as they are scrolled
  // to. Driven from a MutationObserver on the output pane rather than a
  // call at each of the eleven render paths, so a render added later can
  // never forget to animate.
  //
  // Nothing is hidden until JS has decided it can un-hide it: the .reveal
  // class is only added when an IntersectionObserver exists to take it
  // back off again. Without one, the output renders plainly.
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var seen = ('IntersectionObserver' in window) && new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in-view');
      seen.unobserve(entry.target);
    });
  }, { root: null, rootMargin: '0px 0px -6% 0px', threshold: 0.03 });

  function armReveal() {
    if (!seen || reduceMotion) return;
    // Only the top-level blocks animate. Animating every nested row would
    // read as noise rather than sequence.
    var blocks = el.output.children;
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.classList.contains('reveal')) continue;
      block.classList.add('reveal');
      // Capped: the twentieth card must not sit waiting well over a second.
      block.style.setProperty('--i', Math.min(i, 12));
      seen.observe(block);
    }
    countUp();
  }

  // The headline figure counts up to itself. Short, eased, and it always
  // lands on the real number — the final frame is assigned from data-to
  // rather than accumulated, so rounding can never leave it a digit out.
  function countUp() {
    var els = el.output.querySelectorAll('.tick-up');
    Array.prototype.forEach.call(els, function (node) {
      var to = parseInt(node.getAttribute('data-to'), 10);
      if (isNaN(to) || reduceMotion) return;
      if (node.getAttribute('data-done')) return;
      node.setAttribute('data-done', '1');

      var DURATION = 620;
      var started = null;
      function frame(now) {
        if (started === null) started = now;
        var t = Math.min((now - started) / DURATION, 1);
        var eased = 1 - Math.pow(1 - t, 3);
        node.textContent = t === 1 ? to : Math.round(to * eased);
        if (t < 1) requestAnimationFrame(frame);
      }
      node.textContent = '0';
      requestAnimationFrame(frame);
    });
  }

  if (window.MutationObserver) {
    new MutationObserver(armReveal).observe(el.output, { childList: true });
  }

  // The blue block behind the active nav item travels to it rather than
  // blinking across. Measured from the button itself, so it stays correct
  // when the rail reflows to a row on a narrow window.
  function moveIndicator() {
    var active = document.querySelector('.tab[aria-selected="true"]');
    if (!el.tabIndicator || !active) return;
    el.tabIndicator.style.height = active.offsetHeight + 'px';
    el.tabIndicator.style.transform = 'translate(' + active.offsetLeft + 'px,' + active.offsetTop + 'px)';
    el.tabIndicator.style.width = active.offsetWidth + 'px';
    el.tabIndicator.style.opacity = '1';
  }
  window.addEventListener('resize', moveIndicator);
  moveIndicator();

  // ─── BOOKMARKLET HANDOFF ─────────────────────────────────────────────────
  // Two ways a page arrives from the bookmarklet, in the order the
  // bookmarklet tries them (see bookmarklet.html):
  //
  //   1. postMessage back into THIS tab, when the page was opened from the
  //      launcher below and so has us as its window.opener. The preferred
  //      path by far: the brief already pasted here stays put, where
  //      landing in a fresh tab would lose it and make you paste it twice.
  //   2. window.name on a newly-opened tab, when there is no opener —
  //      clicking the bookmarklet cold, with no WCM Helper tab waiting.
  //
  // Captured markup is only ever read as data — parsed with string and
  // regex passes, escaped before it reaches the DOM — never executed or
  // assigned to innerHTML, so an unexpected message can't do more than
  // fill a textarea.

  // Path 2. Read once, then cleared immediately either way: window.name
  // persists across any later navigation in this tab, so leaving a
  // captured page's markup sitting in it would be a real leak if the tab
  // is ever reused for something unrelated. On every normal page load the
  // prefix isn't there, so this is a no-op.
  (function bookmarkletHandoff() {
    var PREFIX = 'WCMH1:';
    var name = window.name;
    window.name = '';
    if (typeof name !== 'string' || name.indexOf(PREFIX) !== 0) return;
    el.html.value = name.slice(PREFIX.length);
    setMode('compare');
    toast('Page loaded from bookmarklet — paste your brief and Compare.');
  })();

  // Path 1. Only accepted while a launch from this tab is outstanding, so
  // an unsolicited message from a page we never opened is ignored.
  var awaitingCapture = false;

  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!awaitingCapture) return;
    if (!data || data.type !== 'WCM_PAGE_CAPTURE' || typeof data.html !== 'string') return;

    awaitingCapture = false;
    el.html.value = data.html;
    setMode('compare');
    toast('Captured ' + shortHost(data.url) + ' — brief kept, ready to Compare.');
  });

  function shortHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'the page'; }
  }

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
      state.comparer = window.BriefCompare.create({ 'work-types': workTypes });
      // Unwrapped, unlike engine/compare above — Filler.create passes this
      // straight to Brief.parse, which reads config.markets.list directly.
      state.filler = window.BriefFiller.create(workTypes);
      state.engine.workTypes.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.label;
        el.type.appendChild(o);
      });
      el.analyse.disabled = false;
      el.compareBtn.disabled = false;
      el.fillBtn.disabled = false;
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
    state.market = null;
    el.marketOverride.hidden = true;
    el.copy.disabled = true;
    renderEmpty();
  });
  el.copy.addEventListener('click', copyQuestions);

  el.briefUpload.addEventListener('click', function () { el.briefFile.click(); });
  el.briefFile.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    el.briefFile.value = '';
    if (!file) return;

    var binary = /\.(docx|xlsx)$/i.test(file.name);
    var reader = new FileReader();
    reader.onerror = function () { toast('Could not read that file.'); };
    reader.onload = function () {
      window.BriefReaders.readFile(file.name, binary ? reader.result : null, binary ? null : reader.result)
        .then(function (text) {
          el.brief.value = text;
          toast(file.name + ' loaded.');
          if (state.mode === 'analyse') run(); else renderCompareEmpty();
        })
        .catch(function (err) { toast(err.message); });
    };
    if (binary) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  });

  el.tabAnalyse.addEventListener('click', function () { setMode('analyse'); });
  el.tabCompare.addEventListener('click', function () { setMode('compare'); });
  el.tabFill.addEventListener('click', function () { setMode('fill'); });
  el.fillBtn.addEventListener('click', runFill);
  el.marketSelect.addEventListener('change', function () {
    state.market = el.marketSelect.value;
    if (state.mode === 'analyse' && state.analysis) run();
    else if (state.mode === 'compare') runCompare();
    else if (state.mode === 'fill') runFill();
  });
  el.compareBtn.addEventListener('click', runCompare);
  // Opening the page from here is what makes this tab its window.opener,
  // which is what lets the bookmarklet report back into this tab instead of
  // starting a fresh one and stranding the brief.
  el.launch.addEventListener('click', function () {
    var url = el.pageUrl.value.trim();
    if (!url) { toast('Paste the page URL first.'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    var w = window.open(url, '_blank');
    if (!w) { toast('Pop-up blocked — allow pop-ups for this site.'); return; }
    awaitingCapture = true;
    toast('Opened it. Click the bookmarklet on that tab to send it back.');
  });

  el.htmlUpload.addEventListener('click', function () { el.htmlFile.click(); });
  el.htmlClear.addEventListener('click', function () { el.html.value = ''; });
  el.htmlFile.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { el.html.value = reader.result; toast(file.name + ' loaded.'); };
    reader.onerror = function () { toast('Could not read that file.'); };
    reader.readAsText(file);
    el.htmlFile.value = '';
  });

  // The brief is shared between the tabs, so a brief analysed on one is
  // already loaded on the other.
  function setMode(mode) {
    state.mode = mode;
    el.tabAnalyse.setAttribute('aria-selected', String(mode === 'analyse'));
    el.tabCompare.setAttribute('aria-selected', String(mode === 'compare'));
    el.tabFill.setAttribute('aria-selected', String(mode === 'fill'));

    el.analyse.hidden = mode !== 'analyse';
    el.compareBtn.hidden = mode !== 'compare';
    el.fillBtn.hidden = mode !== 'fill';
    el.compareInput.hidden = mode !== 'compare';
    el.fillInput.hidden = mode !== 'fill';
    el.copy.hidden = mode !== 'analyse';

    moveIndicator();

    el.output.innerHTML = '';
    if (mode === 'compare') renderCompareEmpty();
    else if (mode === 'fill') runFill(true);
    else renderEmpty();
  }

  function run() {
    var text = el.brief.value.trim();
    if (!text) { toast('Paste a brief first.'); return; }

    updateMarketOptions(text);

    state.analysis = state.engine.analyse(text, {
      cmsOverride: el.cms.value || null,
      workTypeOverride: el.type.value || null,
      marketOverride: state.market
    });
    el.copy.disabled = state.analysis.questions.length === 0;
    render(state.analysis);
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  function render(a) {
    el.output.innerHTML = [
      renderType(a),
      renderNeeds(a),
      renderRowQuality(a),
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

  // Not one of the four things Analyse advertises up front — it only ever
  // has something to say on a multi-market brief, so it renders nothing at
  // all (not an empty "checked, all clean" card) on every other one. Reuses
  // the same sev-tag/dev-note/dev-line vocabulary as the Compare tab's
  // deviations, so a break or a check reads the same way in both places.
  function renderRowQuality(a) {
    if (!a.rowQuality || !a.rowQuality.applicable) return '';
    var findings = a.rowQuality.findings;
    if (!findings.length) {
      return section('Row quality', '<p class="clean">No deviations.</p>');
    }
    var items = findings.map(function (f) {
      var check = f.severity === 'check';
      var tag = '<span class="sev-tag ' + (check ? 'check">check' : 'break">break') + '</span>';
      var head = esc(f.market) + ' · row ' + f.row + (f.section ? ' — ' + esc(f.section) : '');
      var lines = '<p class="dev-note">' + tag + head + '</p><p class="dev-where">' + esc(f.note) + '</p>';
      if (f.english) lines += '<p class="dev-line"><b>English</b><span>' + esc(f.english) + '</span></p>';
      if (f.found) lines += '<p class="dev-line"><b>Found</b><span>' + esc(f.found) + '</span></p>';
      return '<li class="' + (check ? 'check' : 'break') + '">' + lines + '</li>';
    }).join('');
    var breaks = a.rowQuality.breaks;
    return '<section class="card' + (breaks ? ' dirty' : '') + '"><h3>Row quality — ' +
      findings.length + '</h3><ul class="devs">' + items + '</ul></section>';
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

  // ─── COMPARE ─────────────────────────────────────────────────────────────

  function runCompare() {
    var brief = el.brief.value.trim();
    var html = el.html.value.trim();
    if (!brief) { toast('Paste the brief first.'); return; }
    if (!html) { toast('Paste or upload the page HTML.'); return; }

    updateMarketOptions(brief);

    // The comparer needs to know which kind of job it is reading, so the
    // analyser classifies first unless the work type has been set by hand.
    var analysis = state.engine.analyse(brief, {
      cmsOverride: el.cms.value || null,
      workTypeOverride: el.type.value || null,
      marketOverride: state.market
    });

    renderCompare(state.comparer.compare(brief, html, { workTypeId: analysis.workType.id }), analysis);
  }

  function renderCompare(result, analysis) {
    var head = section('Comparing against',
      '<p class="headline">' + esc(analysis.workType.label) + '</p>' +
      '<p class="sub">' + esc(analysis.workType.summary) + '</p>' +
      (analysis.workType.confident || analysis.workType.overridden ? '' :
        '<p class="note warn">The brief\'s type was not a confident call, so these expectations may be ' +
        'read from the wrong playbook. Set the work type by hand on the left.</p>'));

    if (!result.supported) {
      el.output.innerHTML = head + section('Nothing to compare', '<p class="note">' + esc(result.note) + '</p>');
      return;
    }

    // Five empty categories would read as a pass. An unreadable brief has to
    // look nothing like one.
    if (result.unreadable) {
      el.output.innerHTML = head + section('Could not read the brief',
        '<p class="note warn">' + esc(result.note) + '</p>') +
        (result.categories.length
          ? '<p class="tally"><b>' + result.breaks + '</b> to fix, <b>' + result.checks +
            '</b> to check by eye — from the page alone.</p>' +
            result.categories.map(renderCategory).join('')
          : '');
      return;
    }

    var region = '<p class="region-note">Read the page content from: ' + esc(result.regionVia || 'the page body') +
      ' · brief read as <b>' + esc(result.mode || 'labelled') + '</b>, ' + result.expectations +
      ' things to check</p>';

    // Coverage is the headline. "Is everything from the brief on the page" is
    // the question the tool exists to answer; the five deviation groups are
    // the detail underneath it.
    var cov = result.coverage || { total: 0, found: 0, missing: 0, complete: false };
    var coverage = cov.complete
      ? '<p class="coverage ok">All ' + cov.total + ' item' + (cov.total === 1 ? '' : 's') +
        ' from the brief are on the page.</p>'
      : '<p class="coverage short"><span class="tick-up" data-to="' + cov.found + '">' + cov.found +
        '</span> of ' + cov.total +
        ' items from the brief are on the page — <b>' + cov.missing + '</b> missing.</p>';

    var suspect = result.suspectParse
      ? '<p class="note warn">' + esc(result.parseNote) + '</p>'
      : '';

    var tally = '<p class="tally"><b>' + result.breaks + '</b> to fix, <b>' + result.checks +
      '</b> to check by eye.</p>';

    // Word does not survive a paste. If the brief itself is damaged, say so
    // here rather than letting it surface as deviations against the page.
    var warnings = window.BriefReaders.briefWarnings(el.brief.value).map(function (w) {
      return '<p class="brief-warning">' + esc(w) + '</p>';
    }).join('');

    el.output.innerHTML = head + warnings + coverage + suspect + tally + region +
      result.categories.map(renderCategory).join('');
  }

  // What the page actually carries, listed whether or not the brief mentions
  // it. An author asked to see the meta title, page name and path on every
  // run — a blank Metadata block tells them nothing about the page.
  function renderRows(rows) {
    if (!rows || !rows.length) return '';
    var STATE = {
      'matches': ['ok', 'matches the brief'],
      'differs': ['bad', 'differs from the brief'],
      'missing': ['bad', 'not on the page'],
      'not-in-brief': ['idle', 'not defined in the brief']
    };
    return '<table class="meta-rows">' + rows.map(function (r) {
      var s = STATE[r.state] || ['idle', r.state];
      return '<tr class="' + s[0] + '"><th>' + esc(r.field) +
        (r.source ? '<span class="src">' + esc(r.source) + '</span>' : '') + '</th>' +
        '<td>' + (r.found ? esc(r.found) : '<i>nothing on the page</i>') + '</td>' +
        '<td class="state">' + esc(s[1]) + '</td></tr>';
    }).join('') + '</table>';
  }

  // Where a missing row belongs, said in the components around it. Both sides
  // known reads as a span; one side, as the last thing that did land.
  function betweenText(between) {
    if (!between) return 'nothing on the page places it';
    var before = between[0], after = between[1];
    if (before && after) return 'sits between ' + before + ' and ' + after;
    if (before) return 'after ' + before;
    return 'before ' + after;
  }

  // The passing side of the comparison. The summary line is unchanged — this
  // opens underneath it, so a clean report still reads clean at a glance but
  // can be opened to see that every row was actually checked, and where it
  // landed. Misses first: they are what a reader came for.
  function renderLedger(c) {
    if (!c.ledger || !c.ledger.length) return '';

    // Misses first, then rows that are only partly on the page, then clean
    // finds — a partial row is worth a glance and must never fold silently
    // into "found", which is what it would have read as under a plain
    // missing/not-missing split.
    var missing = c.ledger.filter(function (e) { return e.status === 'missing'; });
    var partial = c.ledger.filter(function (e) { return e.status === 'partial'; });
    var found = c.ledger.filter(function (e) { return e.status !== 'missing' && e.status !== 'partial'; });

    var items = missing.concat(partial, found).map(function (e) {
      var where, cls;
      if (e.status === 'missing') { where = 'not found — ' + betweenText(e.between); cls = 'break'; }
      else if (e.status === 'partial') {
        where = 'partly found in ' + (e.in || 'the page') + ' — ' +
          (e.partsTotal - e.partsFound) + ' of ' + e.partsTotal + ' sentences missing';
        cls = 'check';
      } else { where = 'found in ' + (e.in || 'the page'); cls = 'found'; }
      return '<li class="' + cls + '">' +
        '<p class="ledger-head"><span class="chip-num">' + e.row + '</span>' +
        (e.section ? '<span class="ledger-section">' + esc(e.section) + '</span>' : '') +
        '<span class="ledger-where">' + esc(where) + '</span></p>' +
        '<p class="ledger-text">' + esc(e.text) + '</p></li>';
    }).join('');

    return '<details class="ledger"><summary>' + c.ledger.length +
      ' item' + (c.ledger.length === 1 ? '' : 's') + ' from the brief, row by row</summary>' +
      '<ul class="ledger-rows">' + items + '</ul></details>';
  }

  function renderCategory(c) {
    var rows = renderRows(c.rows);
    var ledger = renderLedger(c);

    if (!c.deviations.length) {
      // "Nothing was checked" and "everything matched" must never look alike.
      var body = c.note
        ? '<p class="note warn">' + esc(c.note) + '</p>'
        : '<p class="clean">No deviations.</p>';
      return '<section class="card"><h3>' + esc(c.label) + '</h3>' + body + ledger + rows + '</section>';
    }

    var items = c.deviations.map(function (d) {
      var check = d.severity === 'check';
      var tag = '<span class="sev-tag ' + (check ? 'check">check' : 'break">break') + '</span>';
      var head = (d.field ? esc(d.field) + ' — ' : '') + esc(d.note);
      var lines = '<p class="dev-note">' + tag + head + '</p>';
      // Where on the page it lives, taken from the component the CMS named —
      // "FAQ (item-142402) · Accordion/items[2]/title". An author can open
      // that field directly instead of hunting for a brief row.
      if (d.where) lines += '<p class="dev-where">' + esc(d.where) + '</p>';
      // The per-page references: the anchor to jump to it in the browser, the
      // component id to open it in the CME. Both differ on every page, so they
      // sit under the name rather than in it.
      var refs = [];
      if (d.moduleHeading) refs.push(d.moduleHeading);
      if (d.componentId) refs.push(d.componentId);
      if (d.anchor) refs.push(d.anchor);
      if (refs.length) lines += '<p class="dev-ref">' + esc(refs.join('  ·  ')) + '</p>';
      if (d.expected) lines += '<p class="dev-line"><b>Brief</b><span>' + esc(d.expected) + '</span></p>';
      if (d.found) lines += '<p class="dev-line"><b>Page</b><span>' + esc(d.found) + '</span></p>';
      return '<li class="' + (check ? 'check' : 'break') + '">' + lines + '</li>';
    }).join('');

    var breaks = c.deviations.filter(function (d) { return d.severity !== 'check'; }).length;
    return '<section class="card' + (breaks ? ' dirty' : '') + '"><h3>' + esc(c.label) + ' — ' +
      c.deviations.length + '</h3><ul class="devs">' + items + '</ul>' + ledger + rows + '</section>';
  }

  function renderCompareEmpty() {
    el.output.innerHTML =
      '<div class="empty-state"><p>Paste the brief and the built page\'s HTML, then hit <strong>Compare</strong>. ' +
      'You get back only the differences, grouped as:</p>' +
      '<ol><li>Metadata — title, description, keywords, canonical, H1</li>' +
      '<li>Body text — wording that differs, missing or duplicated sections</li>' +
      '<li>Images — assets named in the brief, and alt text</li>' +
      '<li>Hyperlinks / CTAs — anchor text and destinations</li>' +
      '<li>Structure — section order, omissions, duplicates</li></ol>' +
      '<p>A category with nothing wrong says <strong>No deviations</strong>. The tool cannot fetch the page ' +
      'itself, so it cannot tell you an image is broken — only that the brief named one the page does not carry.</p></div>';
  }

  // ─── FILL ────────────────────────────────────────────────────────────────

  function runFill(worklistOnly) {
    var brief = el.brief.value.trim();
    if (!brief) { if (worklistOnly !== true) toast('Load the brief first.'); renderFillEmpty(); return; }

    updateMarketOptions(brief);

    var rows = state.filler.rows(brief, { market: state.market });
    if (!rows.length) {
      el.output.innerHTML = section('Fill',
        '<p class="note warn">No table rows found in this brief. The filler reads tab-separated rows — ' +
        'upload the .docx or .xlsx rather than pasting, so the columns survive.</p>');
      return;
    }

    var english = el.english.value.trim();
    var head = '';

    if (english) {
      var result = state.filler.fill(brief, english, { market: state.market });
      head = renderFillResult(result);
    }

    el.output.innerHTML = head + renderWorklist(rows, brief);
    wireWorklist(brief);
  }

  // A brief naming several markets has no "last column", only a target —
  // taking the last one anyway is a confirmed defect (Fill handing back
  // Portuguese for a Spain job). This is what lets the author see every
  // market the brief declares and switch between them with no re-paste.
  function updateMarketOptions(brief) {
    var found = state.filler.marketsIn(brief);

    if (!found.markets.length) {
      el.marketOverride.hidden = true;
      state.market = null;
      return;
    }

    el.marketOverride.hidden = false;
    var current = el.marketSelect.value;
    el.marketSelect.innerHTML = found.markets.map(function (m) {
      return '<option value="' + esc(m.name) + '">' + esc(m.name) + '</option>';
    }).join('');

    var stillValid = current && found.markets.some(function (m) { return m.name === current; });
    var pick = stillValid ? current : (found.targetMarket || found.markets[0].name);
    el.marketSelect.value = pick;
    state.market = pick;
  }

  function renderFillResult(r) {
    // Several rows can carry identical English master text — the same CTA
    // label reused across components. Picking one silently used to hand back
    // false certainty; every candidate is listed instead, by section and row,
    // so the choice is the author's rather than a coin flip.
    if (r.how === 'ambiguous') {
      var options = r.candidates.map(function (c) {
        var where = c.row.section ? esc(c.row.section) + ', ' : '';
        return '<li><p class="dev-note">' + where + 'row ' + (c.row.index + 1) + '</p>' +
          '<p class="work-local">' + esc(c.row.localized) + '</p>' +
          '<button class="btn-ghost work-copy" type="button" data-copy-row="' + c.row.index + '">Copy</button></li>';
      }).join('');
      return section('More than one row matches',
        '<p class="note warn">' + r.candidates.length + ' rows carry this exact English text — pick the one ' +
        'for the component you are actually in:</p><ul class="devs">' + options + '</ul>');
    }

    if (!r.match) {
      var why = r.how === 'no-english-column'
        ? 'This brief has no English column, so there is nothing to match against. Work down the list below instead.'
        : 'No row in the brief carries that English text. Check you copied the whole field, or find it in the list below.';
      return section('No match', '<p class="note warn">' + esc(why) + '</p>');
    }

    var c = r.carried;
    var confidence = '';
    if (r.how === 'closest') {
      confidence = '<p class="note warn">Closest match only (' + Math.round(r.confidence * 100) +
        '% overlap) — check this is the right row before pasting.</p>';
    } else if (r.how === 'contained') {
      confidence = '<p class="note">Matched on part of the field rather than the whole of it.</p>';
    }

    var unplaced = '';
    if (c.unplaced.length) {
      unplaced = '<p class="note warn">Could not place ' + c.unplaced.length +
        (c.unplaced.length === 1 ? ' piece of formatting' : ' pieces of formatting') +
        ' — the text it wrapped was translated, so re-apply by hand:</p><ul class="questions">' +
        c.unplaced.map(function (m) {
          return '<li>' + (m.tag === 'a'
            ? 'link to <code>' + esc(m.href || '') + '</code> was on “' + esc(m.text) + '”'
            : '&lt;' + esc(m.tag) + '&gt; was on “' + esc(m.text) + '”') + '</li>';
        }).join('') + '</ul>';
    }

    var restored = c.restored.length
      ? '<p class="note">Carried ' + c.restored.length + ' formatting ' +
        (c.restored.length === 1 ? 'run' : 'runs') + ' across automatically.</p>'
      : '';

    return section('Paste this',
      '<p class="row-label">' + esc(r.match.label) + '</p>' +
      '<p class="localized">' + c.html + '</p>' +
      '<button class="btn-primary" type="button" data-copy-html="1">Copy</button>' +
      confidence + restored + unplaced +
      '<p class="english-was"><b>English was:</b> ' + esc(r.match.english || '') + '</p>');
  }

  function renderWorklist(rows, brief) {
    var done = loadProgress(brief);
    var doneCount = rows.filter(function (row) { return done[row.index]; }).length;

    var items = rows.map(function (row) {
      var isDone = !!done[row.index];
      return '<li class="' + (isDone ? 'done' : '') + '" data-index="' + row.index + '">' +
        '<input type="checkbox" ' + (isDone ? 'checked' : '') + ' aria-label="Done">' +
        '<div class="work-body">' +
        '<span class="row-label">' + esc(row.label) + '</span>' +
        (row.untranslated ? '<span class="badge-untranslated">same both sides</span>' : '') +
        (row.english ? '<p class="work-en">' + esc(row.english) + '</p>' : '') +
        '<p class="work-local">' + esc(row.localized) + '</p>' +
        '</div>' +
        '<button class="btn-ghost work-copy" type="button" data-copy-row="' + row.index + '">Copy</button>' +
        '</li>';
    }).join('');

    return '<section class="card"><h3>Worklist — ' + rows.length + ' rows</h3>' +
      '<p class="progress"><b>' + doneCount + '</b> of <b>' + rows.length + '</b> done.</p>' +
      '<ul class="worklist">' + items + '</ul></section>';
  }

  function wireWorklist(brief) {
    var rows = state.filler.rows(brief, { market: state.market });
    var byIndex = {};
    rows.forEach(function (r) { byIndex[r.index] = r; });

    var htmlBtn = el.output.querySelector('[data-copy-html]');
    if (htmlBtn) {
      htmlBtn.addEventListener('click', function () {
        var node = el.output.querySelector('.localized');
        copyRich(node.innerHTML, node.textContent);
      });
    }

    Array.prototype.forEach.call(el.output.querySelectorAll('[data-copy-row]'), function (btn) {
      btn.addEventListener('click', function () {
        var row = byIndex[btn.getAttribute('data-copy-row')];
        if (row) copyRich(null, row.localized);
      });
    });

    Array.prototype.forEach.call(el.output.querySelectorAll('.worklist input[type=checkbox]'), function (box) {
      box.addEventListener('change', function () {
        var li = box.closest('li');
        var done = loadProgress(brief);
        if (box.checked) done[li.getAttribute('data-index')] = 1;
        else delete done[li.getAttribute('data-index')];
        saveProgress(brief, done);
        li.classList.toggle('done', box.checked);
        var total = rows.length;
        var count = Object.keys(done).length;
        var p = el.output.querySelector('.progress');
        if (p) p.innerHTML = '<b>' + count + '</b> of <b>' + total + '</b> done.';
      });
    });
  }

  // Writing text/html as well as plain text is what lets a link survive the
  // paste into a Tridion rich-text field instead of flattening to words.
  function copyRich(html, text) {
    if (html && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' })
      })]).then(function () { toast('Copied with formatting.'); },
               function () { copyPlain(text); });
      return;
    }
    copyPlain(text);
  }

  function copyPlain(text) {
    navigator.clipboard.writeText(text)
      .then(function () { toast('Copied.'); })
      .catch(function () { toast('Could not copy — select and copy by hand.'); });
  }

  // Progress is per brief, so switching between two pages does not mix them up.
  function progressKey(brief) {
    var hash = 0;
    for (var i = 0; i < brief.length; i++) { hash = ((hash << 5) - hash + brief.charCodeAt(i)) | 0; }
    return 'wcm-fill-' + hash;
  }
  function loadProgress(brief) {
    try { return JSON.parse(localStorage.getItem(progressKey(brief)) || '{}'); }
    catch (e) { return {}; }
  }
  function saveProgress(brief, done) {
    try { localStorage.setItem(progressKey(brief), JSON.stringify(done)); } catch (e) { /* private window */ }
  }

  function renderFillEmpty() {
    el.output.innerHTML =
      '<div class="empty-state"><p>Load a localization brief, then paste the English master sitting in the ' +
      'Tridion component field. You get back:</p>' +
      '<ol><li>The localized text for that row, on a Copy button</li>' +
      '<li>Any links or formatting carried across automatically</li>' +
      '<li>Anything that could not be placed, listed so it is not lost</li></ol>' +
      '<p>Below that, the whole brief as a worklist you can tick down. The tool cannot read or write ' +
      'Tridion fields — it finds the text, you paste it.</p></div>';
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

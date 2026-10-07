/* app.js — the whole UI.
 *
 * The engine emits one result object; this file only renders it. No analysis
 * of its own, no second opinion about a brief.
 */
(function () {
  'use strict';

  // Which build is actually running. index.html carries the version on every
  // script URL to bust the cache; reading it back out of this file's own src
  // means there is one string to bump rather than two to keep in step, and
  // what the sidebar shows is necessarily the file the browser executed.
  // Captured now, not later: document.currentScript is only set while the
  // script is running synchronously.
  var BUILD = (function () {
    var tag = document.currentScript || document.querySelector('script[src*="app.js"]');
    var m = tag && /[?&]v=([^&]*)/.exec(tag.src || '');
    return m && m[1] ? decodeURIComponent(m[1]) : 'dev';
  }());
  function buildTag() { return BUILD; }

  var state = {
    engine: null, comparer: null, filler: null, pageModel: null, mockPage: null, qa: null,
    analysis: null, mode: 'analyse', market: null,
    // What Analyse's output pane is showing, so a market change re-renders
    // the right one; and the last mock built, ready to hand to QA.
    analyseView: 'analysis', mockHtml: null,
    // The backend client when one is configured and signed in to, else null.
    // QA reads from a pasted page, a live URL, or a crawl.
    backend: null, sites: null, qaSource: 'page',
    // The fetch behind the HTML in the page box, kept only while that HTML is
    // unchanged — paste over it and the live facts no longer describe it.
    live: null, liveHtml: null, links: null, linksHtml: null,
    crawl: null, crawlSrc: 'sites', crawlPick: {}
  };

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
    compareInput: document.getElementById('compare-input'),
    html: document.getElementById('html'),
    htmlUpload: document.getElementById('html-upload-btn'),
    htmlClear: document.getElementById('html-clear-btn'),
    htmlFile: document.getElementById('html-file'),
    pageUrl: document.getElementById('page-url'),
    launch: document.getElementById('launch-btn'),
    briefUpload: document.getElementById('brief-upload-btn'),
    briefFile: document.getElementById('brief-file'),
    briefgenBtn: document.getElementById('briefgen-btn'),
    mockBtn: document.getElementById('mock-btn'),
    briefHeading: document.getElementById('brief-heading'),
    cmsOverride: document.getElementById('cms-override'),
    marketOverride: document.getElementById('market-override'),
    marketSelect: document.getElementById('market-select'),
    tabIndicator: document.querySelector('.tab-indicator'),
    tabQa: document.getElementById('tab-qa'),
    qaBtn: document.getElementById('qa-btn'),
    briefCard: document.getElementById('brief-card'),
    settingsCard: document.getElementById('settings-card'),
    pageHint: document.getElementById('page-hint'),
    signout: document.getElementById('signout-btn'),
    qaSource: document.getElementById('qa-source'),
    livePanel: document.getElementById('live-panel'),
    liveUrl: document.getElementById('live-url'),
    liveBtn: document.getElementById('live-btn'),
    liveLinks: document.getElementById('live-links'),
    crawlPanel: document.getElementById('crawl-panel'),
    crawlSites: document.getElementById('crawl-sites'),
    crawlSitemap: document.getElementById('crawl-sitemap'),
    crawlSitemapUrl: document.getElementById('crawl-sitemap-url'),
    crawlList: document.getElementById('crawl-list'),
    crawlUrls: document.getElementById('crawl-urls'),
    crawlScope: document.getElementById('crawl-scope'),
    crawlAreas: document.getElementById('crawl-areas'),
    crawlFrontlines: document.getElementById('crawl-frontlines'),
    crawlMarkets: document.getElementById('crawl-markets'),
    crawlPicked: document.getElementById('crawl-picked'),
    crawlLimit: document.getElementById('crawl-limit'),
    crawlPrefix: document.getElementById('crawl-prefix'),
    crawlLinks: document.getElementById('crawl-links'),
    crawlBtn: document.getElementById('crawl-btn'),
    crawlStop: document.getElementById('crawl-stop')
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

  // Both panes roll their blocks in the same way. The output pane is driven
  // by the MutationObserver below, since its content is re-rendered; the
  // input pane is static markup, so it is armed explicitly at boot and
  // again on each mode switch.
  function armReveal(container, replay) {
    if (!seen || reduceMotion) return;
    // Only the top-level blocks animate. Animating every nested row would
    // read as noise rather than sequence.
    var blocks = container.children;
    for (var i = 0; i < blocks.length; i++) {
      var block = blocks[i];
      if (block.classList.contains('reveal')) {
        // Replaying: let a block that has already landed roll in again.
        if (!replay) continue;
        block.classList.remove('in-view');
      } else {
        block.classList.add('reveal');
      }
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
    new MutationObserver(function () { armReveal(el.output); })
      .observe(el.output, { childList: true });
  }

  var paneInput = document.querySelector('.pane-input');
  armReveal(paneInput);

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

  // ─── BOOKMARKLET CAPTURE ─────────────────────────────────────────────────
  // The bookmarklet never opens or navigates anything: it sends the page it
  // is sitting on into THIS tab, so the brief already pasted here stays put.
  // Two channels arrive here, and both land in acceptCapture:
  //
  //   1. postMessage from a page opened by the launcher below, which made
  //      this window its opener. The only channel that can cross origins,
  //      which is why the page has to be opened from QA.
  //   2. BroadcastChannel, origin-scoped, so it only carries anything when
  //      the tool and the page happen to share an origin.
  //
  // The guard is window identity, not a one-shot flag: a WindowProxy stays
  // the same object across navigations in its tab, so you can click around
  // the site and capture whenever, and capture the same tab again after an
  // edit — while a message from a window this tab never opened is ignored.
  //
  // Captured markup is only ever read as data — string and regex passes,
  // escaped before it reaches the DOM — never executed or assigned to
  // innerHTML, so the worst an unexpected message could do is fill a
  // textarea.
  var launched = null;

  function acceptCapture(data) {
    if (!data || data.type !== 'WCM_PAGE_CAPTURE' || typeof data.html !== 'string') return;
    el.html.value = data.html;
    // A captured page is for QA, the one tab that reads pages. Any brief
    // already pasted stays, and is compared against it.
    if (state.mode !== 'qa') setMode('qa');
    runQa();
    toast('Captured ' + shortHost(data.url) + ' — QA run on it.');
  }

  window.addEventListener('message', function (e) {
    if (!launched || e.source !== launched) return;
    acceptCapture(e.data);
  });

  try {
    new BroadcastChannel('wcm_helper').addEventListener('message', function (e) {
      acceptCapture(e.data);
    });
  } catch (e) { /* no BroadcastChannel: the opener channel above still works */ }

  function shortHost(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return 'the page'; }
  }

  var SAMPLE = [
    'https://www.kone.dk/dxexperiments.aspx\tx\thttps://www.kone.dk/',
    'https://www.kone.dk/searchresults.aspx\tx\thttps://www.kone.dk/',
    'https://www.kone.dk/campaign/24-7-connect-escalators/\tx\thttps://www.kone.dk/'
  ].join('\n');

  // ─── BOOT ────────────────────────────────────────────────────────────────

  // Stamped before anything else can fail: a build that cannot load its
  // playbooks is exactly when knowing which build it is matters most.
  var buildEl = document.getElementById('build-tag');
  if (buildEl) buildEl.textContent = 'Build ' + buildTag();

  // ─── SIGN-IN GATE ───────────────────────────────────────────────────────
  // With a backend configured, the whole tool sits behind its password:
  // the page stays hidden (html.gating) until the session is confirmed, and
  // a missing or expired one goes to login.html. With none configured, the
  // tool runs as it always has — paste and bookmarklet, no sign-in.
  function reveal() {
    document.documentElement.classList.remove('gating');
    moveIndicator();
  }
  (window.WcmBackend ? window.WcmBackend.load(buildTag()) : Promise.resolve(null))
    .then(function (client) {
      if (!client || !client.enabled) { reveal(); return; }
      return client.session().then(function (s) {
        if (!s.ok) { client.toLogin(); return; }
        state.backend = client;
        el.signout.hidden = false;
        el.pageHint.innerHTML = 'A pasted page never leaves the browser. <b>Live URL</b> and <b>Crawl sites</b> send only ' +
          'the URLs you give to WCM Helper\'s backend, which fetches them from KONE. For a preview page behind login, open it ' +
          'above and <a href="bookmarklet.html">use the bookmarklet</a>.';
        reveal();
        if (state.mode === 'qa') applySource(state.qaSource);
      });
    })
    .catch(reveal);

  Promise.all([
    fetch('config/work-types.json?v=' + buildTag()).then(function (r) {
      if (!r.ok) throw new Error('config/work-types.json returned ' + r.status);
      return r.json();
    }),
    // The mock-component vocabulary is a nice-to-have, not a dependency:
    // page-model.js carries the same defaults built in, so a missing or
    // broken copy of this file must never stop the tool booting.
    fetch('config/mock-components.json?v=' + buildTag())
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; }),
    // The site registry — market, form id, site names. Same nice-to-have
    // shape: compare.js carries an in-code mirror, so a missing copy only
    // means QA runs on the built-in table, never that it stops working.
    fetch('config/sites.json?v=' + buildTag())
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
  ])
    .then(function (results) {
      var workTypes = results[0], mockComponents = results[1], sites = results[2];
      state.sites = sites;
      state.engine = window.BriefEngine.create({ 'work-types': workTypes });
      var comparerConfig = { 'work-types': workTypes };
      if (sites) comparerConfig['sites'] = sites;
      state.comparer = window.BriefCompare.create(comparerConfig);
      state.qa = window.BriefQA.create(comparerConfig);
      // Unwrapped, unlike engine/compare above — Filler.create passes this
      // straight to Brief.parse, which reads config.markets.list directly.
      state.filler = window.BriefFiller.create(workTypes);
      var pageModelConfig = { 'work-types': workTypes };
      if (mockComponents) pageModelConfig['mock-components'] = mockComponents;
      state.pageModel = window.BriefPageModel.create(pageModelConfig);
      state.mockPage = window.BriefMockPage.create();
      state.engine.workTypes.forEach(function (t) {
        var o = document.createElement('option');
        o.value = t.id;
        o.textContent = t.label;
        el.type.appendChild(o);
      });
      el.analyse.disabled = false;
      el.mockBtn.disabled = false;
      el.qaBtn.disabled = false;
      el.briefgenBtn.disabled = false;
      renderPicker();
    })
    .catch(function (e) {
      el.output.innerHTML = '<div class="empty-state"><p><strong>Could not load the playbooks.</strong></p>' +
        '<p>' + esc(e.message) + '</p><p>Run <code>npm start</code> and open the served URL — ' +
        'the config is fetched at runtime, so opening the file from disk will not work.</p></div>';
    });

  // ─── EVENTS ──────────────────────────────────────────────────────────────

  el.analyse.addEventListener('click', run);
  el.mockBtn.addEventListener('click', runMock);
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
    state.mockHtml = null;
    state.analyseView = 'analysis';
    if (state.mode === 'analyse') renderEmpty();
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
          if (state.mode === 'analyse') run();
        })
        .catch(function (err) { toast(err.message); });
    };
    if (binary) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  });

  el.tabAnalyse.addEventListener('click', function () { setMode('analyse'); });
  el.tabQa.addEventListener('click', function () { setMode('qa'); });
  el.qaBtn.addEventListener('click', runQa);
  el.signout.addEventListener('click', function () { if (state.backend) state.backend.signOut(); });
  el.qaSource.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-source]');
    if (b) applySource(b.getAttribute('data-source'));
    var c = e.target.closest && e.target.closest('[data-crawl-src]');
    if (c) setCrawlSource(c.getAttribute('data-crawl-src'));
  });
  el.liveBtn.addEventListener('click', runLive);
  el.liveUrl.addEventListener('keydown', function (e) { if (e.key === 'Enter') runLive(); });
  el.crawlBtn.addEventListener('click', startCrawl);
  el.crawlStop.addEventListener('click', function () {
    if (!state.crawl || !state.crawl.running) return;
    state.crawl.stopped = true;
    el.crawlStop.disabled = true;
  });
  el.crawlPanel.addEventListener('click', onPickerClick);
  el.crawlMarkets.addEventListener('change', function (e) {
    var name = e.target.getAttribute && e.target.getAttribute('data-market');
    if (!name) return;
    if (e.target.checked) state.crawlPick[name] = true; else delete state.crawlPick[name];
    renderPicker();
  });
  el.briefgenBtn.addEventListener('click', runBriefGen);
  // The market chooses which column of a multi-market brief is read — for
  // the analysis and for the mock page, whichever is on screen.
  el.marketSelect.addEventListener('change', function () {
    state.market = el.marketSelect.value;
    if (state.mode !== 'analyse') return;
    if (state.analyseView === 'mock') runMock();
    else if (state.analysis) run();
  });
  // Opening the page from here is what makes this tab its window.opener,
  // which is what lets the bookmarklet report back into this tab instead of
  // starting a fresh one and stranding the brief.
  el.launch.addEventListener('click', function () {
    var url = el.pageUrl.value.trim();
    if (!url) { toast('Paste the page URL first.'); return; }
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    var w = window.open(url, '_blank');
    if (!w) { toast('Pop-up blocked — allow pop-ups for this site.'); return; }
    launched = w;
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

  // The brief is shared between the two tabs: analysed in one, it is the
  // brief QA compares the page against in the other.
  function setMode(mode) {
    state.mode = mode;
    var qa = mode === 'qa';
    el.tabAnalyse.setAttribute('aria-selected', String(!qa));
    el.tabQa.setAttribute('aria-selected', String(qa));

    el.analyse.hidden = qa;
    el.mockBtn.hidden = qa;
    el.sample.hidden = qa;
    el.copy.hidden = qa;
    el.cmsOverride.hidden = qa;
    el.compareInput.hidden = !qa;
    el.briefHeading.textContent = qa ? 'Brief — optional: adds the comparison' : 'Brief';
    el.qaSource.hidden = true;
    el.briefCard.hidden = false;
    el.settingsCard.hidden = false;

    moveIndicator();

    el.output.innerHTML = '';
    if (qa) applySource(state.qaSource, true);
    else { renderEmpty(); armReveal(paneInput, true); }
  }

  // Which of QA's three sources is in use. Without a backend there is only
  // the pasted page, and the switch is not shown at all.
  function applySource(source, fromMode) {
    if (!state.backend) source = 'page';
    var changed = source !== state.qaSource;
    state.qaSource = source;
    el.qaSource.hidden = !state.backend;
    Array.prototype.forEach.call(el.qaSource.querySelectorAll('[data-source]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-source') === source));
    });
    var crawl = source === 'crawl';
    el.livePanel.hidden = source !== 'live';
    el.crawlPanel.hidden = !crawl;
    el.compareInput.hidden = crawl;
    // A crawl reads no brief: each page is judged on its own.
    el.briefCard.hidden = crawl;
    el.settingsCard.hidden = crawl;
    armReveal(paneInput, true);
    if (crawl) renderCrawl();
    else if (fromMode || changed) {
      if (state.crawl && state.crawl.open !== null && changed) state.crawl.open = null;
      renderQaEmpty();
    }
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
    state.analysis.formIdSuggestion = formIdSuggestionFor(text, state.market);
    state.analyseView = 'analysis';
    el.copy.disabled = state.analysis.questions.length === 0;
    render(state.analysis);
  }

  // There is no page here, only the question "what should this market's
  // pages carry." Fires only when the brief both declares a resolvable
  // Market row and carries a Form component — otherwise there is nothing
  // real to suggest, and it stays silent rather than guessing either half.
  function formIdSuggestionFor(text, marketOverride) {
    var model = state.pageModel.build(text, { market: marketOverride });
    var market = model.page.market;
    if (!market) return null;
    var hasForm = model.components.some(function (c) { return c.type === 'form'; });
    if (!hasForm) return null;
    return state.comparer.suggestFormId(market);
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────

  function render(a) {
    el.output.innerHTML = [
      renderType(a),
      renderNeeds(a),
      renderRowQuality(a),
      renderSteps(a),
      renderMissing(a),
      renderFormIdSuggestion(a)
    ].join('');
  }

  // A suggestion, never a check — Analyse has no real page to compare
  // against, so this only ever names the id that market's pages should
  // carry, for the author to verify once the page exists.
  function renderFormIdSuggestion(a) {
    var s = a.formIdSuggestion;
    if (!s) return '';
    return section('Form Assembly ID',
      '<p class="note">This brief declares a Form component for ' + esc(s.market) +
      ' — pages in that market are expected to carry Form Assembly ID ' + esc(s.formAssemblyId) + '.</p>');
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
      '<p>Every call shows the signals behind it, so you can check its working rather than trust it.</p>' +
      '<p><strong>Build mock page</strong> draws the page the brief describes instead, one component per ' +
      'section, each showing how confidently it was inferred and from which rows — then <strong>Send to QA</strong> ' +
      'hands it across to be checked or turned back into a brief.</p></div>';
  }

  // What the page actually carries, listed whether or not the brief mentions
  // it. An author asked to see the meta title, page name and path on every
  // run — a blank Metadata block tells them nothing about the page. Each row
  // says what it was judged against: the brief, or an expected value (a
  // config table, a naming rule) — never "the brief" when there was none.
  function renderRows(rows) {
    if (!rows || !rows.length) return '';
    return '<table class="meta-rows">' + rows.map(function (r) {
      var expected = r.basis === 'expected';
      var STATE = {
        'matches': ['ok', expected ? 'matches the expected value' : 'matches the brief'],
        'differs': ['bad', expected ? 'differs from the expected value' : 'differs from the brief'],
        'missing': ['bad', 'not on the page'],
        'not-in-brief': ['idle', 'not defined in the brief'],
        'not-checked': ['idle', 'market could not be determined'],
        'present': ['ok', 'on the page'],
        'absent': ['idle', 'not on the page'],
        'green': ['score-green', 'green'],
        'amber': ['score-amber', 'amber'],
        'red': ['score-red', 'red']
      };
      var s = STATE[r.state] || ['idle', r.state];
      var label = r.stateLabel ? s[1] + ' — ' + r.stateLabel : s[1];
      return '<tr class="' + s[0] + '"><th>' + esc(r.field) +
        (r.source ? '<span class="src">' + esc(r.source) + '</span>' : '') + '</th>' +
        '<td>' + (r.found ? esc(r.found) : '<i>nothing on the page</i>') + '</td>' +
        '<td class="state">' + esc(label) + '</td></tr>';
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
      // A link knows better than this function where it landed — "found as
      // 'KONE elevator modernisation'" says more than "found in the page" —
      // so an entry carrying its own line wins.
      if (e.where) where = e.where;
      return '<li class="' + cls + '">' +
        '<p class="ledger-head"><span class="chip-num">' + e.row + '</span>' +
        (e.section ? '<span class="ledger-section">' + esc(e.section) + '</span>' : '') +
        '<span class="ledger-where">' + esc(where) + '</span></p>' +
        '<p class="ledger-text">' + esc(e.text) + '</p></li>';
    }).join('');

    var hit = c.ledger.length - missing.length - partial.length;
    return '<details class="ledger"><summary>' + c.ledger.length +
      ' item' + (c.ledger.length === 1 ? '' : 's') + ' from the brief, row by row — ' +
      hit + ' matched, ' + (missing.length + partial.length) + ' not' +
      '</summary><ul class="ledger-rows">' + items + '</ul></details>';
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
      // Labelled by where the expectation came from, finding by finding: one
      // card can hold both a brief's expectation and a config's.
      if (d.expected) lines += '<p class="dev-line"><b>' + (d.fromBrief ? 'Brief' : 'Expected') + '</b><span>' + esc(d.expected) + '</span></p>';
      if (d.found) lines += '<p class="dev-line"><b>Page</b><span>' + esc(d.found) + '</span></p>';
      return '<li class="' + (check ? 'check' : 'break') + '">' + lines + '</li>';
    }).join('');

    var breaks = c.deviations.filter(function (d) { return d.severity !== 'check'; }).length;
    return '<section class="card' + (breaks ? ' dirty' : '') + '"><h3>' + esc(c.label) + ' — ' +
      c.deviations.length + '</h3><ul class="devs">' + items + '</ul>' + ledger + rows + '</section>';
  }

  // ─── GENERATE A BRIEF (in QA) ────────────────────────────────────────────
  // The other direction: read a built page — or an agency mockup, or the
  // mock page Analyse built — and write the brief that describes it. The
  // draft lands in the Brief box rather than in a read-only panel, so it can
  // be edited on the spot, and Run QA then checks the page against it.

  function runBriefGen() {
    var html = el.html.value.trim();
    if (!html) {
      el.output.innerHTML = section('Nothing to read',
        '<p class="note warn">Paste the built page\'s HTML first.</p>');
      return;
    }

    var drafted = state.comparer.briefFrom(html);
    var n = drafted.notes;
    el.brief.value = drafted.text;

    var counts = [
      ['Metadata fields', n.fields.length],
      ['Section headings', n.sections],
      ['Paragraphs', n.paragraphs],
      ['Assets', n.images],
      ['Internal links', n.links]
    ].map(function (row) {
      return '<p class="dev-line"><b>' + esc(row[0]) + '</b><span class="tick-up" data-to="' +
        row[1] + '">' + row[1] + '</span></p>';
    }).join('');

    // What was read is only half the answer. What the page did not carry, or
    // what could not be named, belongs on screen too — a brief that quietly
    // drops a field reads exactly like a page that never had one.
    var gaps = [];
    if (n.fields.indexOf('Meta Keywords') === -1) {
      gaps.push('This page carries no meta keywords, so the brief has no Keywords row — rather than an empty one.');
    }
    if (!n.links) {
      gaps.push('No internal links: the page links nowhere on its own host, or only into the CMS editor, which is never briefed.');
    }
    if (n.hiddenHeadings) {
      gaps.push(n.hiddenHeadings + ' hidden heading' + (n.hiddenHeadings === 1 ? '' : 's') +
        ' skipped — the template stamps these in with display:none and no reader sees them.');
    }
    if (n.unnamedImages.length) {
      gaps.push(n.unnamedImages.length + ' asset' + (n.unnamedImages.length === 1 ? '' : 's') +
        ' left out: no name could be read from the URL. ' + esc(n.unnamedImages.slice(0, 3).join(', ')));
    }

    // The plain draft above is what actually feeds Compare — untouched, so
    // the round-trip contract it's already tested against never changes.
    // The component-mapped depth below is a second, additive reading of
    // the same page through the shared model, purely for this report.
    var model = state.pageModel.buildFromPage(html);

    el.output.innerHTML =
      section('Drafted from the page',
        '<p class="coverage short">The draft is in the Brief box — edit it, then Run QA to check the page against it.</p>' +
        counts +
        '<p class="region-note">Read the page content from: ' + esc(n.regionVia) + '</p>') +
      (gaps.length
        ? section('Worth knowing',
            '<ul class="devs">' + gaps.map(function (g) {
              return '<li class="check"><p class="dev-note"><span class="sev-tag check">check</span>' + g + '</p></li>';
            }).join('') + '</ul>')
        : '') +
      renderBriefFieldTables(model) +
      renderOpenItems(model);
    toast('Brief drafted from the page — it is in the Brief box.');
  }

  // ─── QA ──────────────────────────────────────────────────────────────────
  // A built page in, a brief optional. On its own, QA asks whether the page
  // is sound by itself; with a brief it is also the comparison — the same
  // five categories, the brief's findings and the page's own together, and
  // "is everything the brief asked for on the page" as the headline. The
  // template's own known defects are kept apart, so a page is never failed
  // for its template.

  function renderQaEmpty() {
    el.output.innerHTML =
      '<div class="empty-state"><p>Paste the built page\'s HTML — or capture it with the bookmarklet — ' +
      'then hit <strong>Run QA</strong>.</p>' +
      '<p>On its own it checks the page under the QA framework\'s five categories: metadata (the title\'s ' +
      'site name, robots against digitalData, hreflang, a single H1), images, hyperlinks (placeholder, ' +
      'CME and staging links, link text a screen reader can use, mixed content) and structure (the Form ' +
      'Assembly ID for the market). The page\'s TCM ID comes back with links to open it in the CME.</p>' +
      '<p><strong>Add a brief</strong> and the same run also checks that everything the brief asked for ' +
      'is on the page, line by line. No brief? <strong>Generate brief</strong> writes one from the page.</p>' +
      '<p>Known template issues — the kind every page on a template shares — are listed apart and never ' +
      'counted against the page.</p></div>';
  }

  function runQa() {
    var html = el.html.value.trim();
    if (!html) {
      el.output.innerHTML = section('Nothing to check',
        '<p class="note warn">Paste the built page\'s HTML first, or capture it with the bookmarklet.</p>');
      return;
    }
    var brief = el.brief.value.trim();
    var analysis = null;
    if (brief) {
      updateMarketOptions(brief);
      // Which playbook the brief is read with: the analyser's call, unless
      // the work type has been set by hand.
      analysis = state.engine.analyse(brief, {
        cmsOverride: el.cms.value || null,
        workTypeOverride: el.type.value || null,
        marketOverride: state.market
      });
    }
    // Live facts and link statuses describe one particular HTML; paste over
    // it and they no longer apply.
    renderQa(state.qa.run(html, {
      brief: brief, workTypeId: analysis && analysis.workType.id,
      live: state.liveHtml === html ? state.live : null,
      links: state.linksHtml === html ? state.links : null
    }), analysis);
  }

  function factLine(label, value) {
    return '<p class="dev-line"><b>' + esc(label) + '</b><span>' + value + '</span></p>';
  }

  // What the brief contributed to this run: the playbook it was read with,
  // and the coverage headline — or why there was nothing to compare.
  function renderComparison(c, analysis) {
    if (!c || !analysis) return '';
    var head = section('Checked against the brief',
      '<p class="headline">' + esc(analysis.workType.label) + '</p>' +
      '<p class="sub">' + esc(analysis.workType.summary) + '</p>' +
      (analysis.workType.confident || analysis.workType.overridden ? '' :
        '<p class="note warn">The brief\'s type was not a confident call, so these expectations may be ' +
        'read from the wrong playbook. Set the work type by hand on the left.</p>'));

    if (!c.supported) {
      return head + '<p class="note warn">' + esc(c.note) + ' The checks below come from the page alone.</p>';
    }
    // An unreadable brief must look nothing like a pass.
    if (c.unreadable) {
      return head + '<p class="note warn">' + esc(c.note) + '</p>';
    }

    // Word does not survive a paste. If the brief itself is damaged, say so
    // here rather than letting it surface as deviations against the page.
    var warnings = window.BriefReaders.briefWarnings(el.brief.value).map(function (w) {
      return '<p class="brief-warning">' + esc(w) + '</p>';
    }).join('');

    var cov = c.coverage || { total: 0, found: 0, missing: 0, complete: false };
    var coverage = cov.complete
      ? '<p class="coverage ok">All ' + cov.total + ' item' + (cov.total === 1 ? '' : 's') +
        ' from the brief are on the page.</p>'
      : '<p class="coverage short"><span class="tick-up" data-to="' + cov.found + '">' + cov.found +
        '</span> of ' + cov.total + ' items from the brief are on the page — <b>' + cov.missing + '</b> missing.</p>';
    var suspect = c.suspectParse ? '<p class="note warn">' + esc(c.parseNote) + '</p>' : '';
    return head + warnings + coverage + suspect;
  }

  function renderQa(r, analysis, opts) {
    opts = opts || {};
    var f = r.facts;
    var tcm = f.tcmId
      ? esc(f.tcmId) +
        ' · <a href="' + esc(f.cmeNewUi) + '" target="_blank" rel="noopener noreferrer">Open in CME</a>' +
        ' · <a href="' + esc(f.cmeOldUi) + '" target="_blank" rel="noopener noreferrer">old UI</a>' +
        ' · <button type="button" class="btn-ghost qa-copy" data-copy="' + esc(f.tcmId) + '">Copy</button>'
      : '<i>' + (f.tcmRaw ? 'not a TCM ID: ' + esc(f.tcmRaw) : 'no pagetcmid on the page') + '</i>';
    var lang = f.lang || f.dataLang
      ? esc(f.lang || '—') + (f.dataLang ? ' (template data-lang ' + esc(f.dataLang) + ')' : '')
      : '<i>not declared</i>';

    var facts = section('Page',
      '<p class="headline">' + esc(f.environment.label) + '</p>' +
      '<p class="sub">' + esc(f.environment.why) + '</p>' +
      factLine('Canonical', f.canonical ? esc(f.canonical) : '<i>none on the page</i>') +
      factLine('TCM ID', tcm) +
      factLine('Market', f.market ? esc(f.market) : '<i>could not be determined</i>') +
      factLine('Language', lang) +
      liveFactLines(f) + linkCheckLine(f, opts));

    var tally = r.breaks + r.checks
      ? '<p class="tally"><b>' + r.breaks + '</b> to fix, <b>' + r.checks + '</b> to check by eye.</p>'
      : '<p class="coverage ok">Nothing to fix on this page from the checks QA runs.</p>';

    var c = r.comparison;
    var region = '<p class="region-note">Read the page content from: ' + esc(r.regionVia || 'the page body') +
      (c && c.supported && !c.unreadable
        ? ' · brief read as <b>' + esc(c.mode || 'labelled') + '</b>, ' + c.expectations + ' things to check'
        : '') + '</p>';

    var known = r.knownIssues.length
      ? renderCategory({ id: 'known', label: 'Known template issues — not counted against the page',
          deviations: r.knownIssues })
      : section('Known template issues', '<p class="clean">None found.</p>');

    var back = opts.back
      ? '<div class="back-row"><button type="button" class="btn-ghost" id="crawl-back">← Back to the crawl results</button></div>'
      : '';
    el.output.removeAttribute('data-view');
    el.output.innerHTML = back + facts + renderComparison(c, analysis) + tally + region +
      r.categories.map(renderCategory).join('') + known;
  }

  // What the backend saw fetching the page: the answer, where it ended up,
  // and the certificate it was served with.
  function liveFactLines(f) {
    var lv = f.live;
    if (!lv) return '';
    var hops = (lv.redirects || []).map(function (h) { return h.status + ' ' + esc(h.url); }).join(' → ');
    var served = esc(lv.finalUrl || lv.url) + (hops ? '<br><small>via ' + hops + '</small>' : '');
    var tls = !lv.tls ? (/^https:/i.test(lv.finalUrl || '') ? '<i>not read</i>' : '<i>none — plain http</i>')
      : lv.tls.valid
        ? 'valid until ' + esc(String(lv.tls.validTo).slice(0, 10)) + ' (' + lv.tls.daysLeft + ' days)' +
          (lv.tls.issuer ? ' · ' + esc(lv.tls.issuer) : '')
        : '<b>not valid</b> — ' + esc(lv.tls.error || 'unknown reason');
    return factLine('HTTP status', '<span class="pill ' + esc(lv.verdict) + '">' + esc(lv.status) + '</span> fetched live in ' +
        (lv.ms / 1000).toFixed(1) + ' s') +
      factLine('Served at', served) +
      factLine('Certificate', tls);
  }

  function linkCheckLine(f, opts) {
    if (f.linkCheck) {
      var lc = f.linkCheck;
      return factLine('Links', lc.checked + ' checked — ' + lc.ok + ' fine, ' +
        (lc.dead ? '<strong>' + lc.dead + ' broken</strong>' : '0 broken') + ', ' + lc.unverified + ' not verified');
    }
    if (!state.backend || opts.back) return '';
    return factLine('Links', '<button type="button" class="btn-ghost" id="qa-check-links">Check this page\'s links</button>');
  }

  el.output.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var btn = e.target.closest('.qa-copy');
    if (btn) copyPlain(btn.getAttribute('data-copy'));
    if (e.target.closest('#qa-check-links')) checkPageLinks();
    if (e.target.closest('#crawl-back') && state.crawl) { state.crawl.open = null; renderCrawl(); }
    if (e.target.closest('#crawl-csv')) exportCrawlCsv();
    var row = e.target.closest('tr[data-row]');
    if (row && state.crawl) openCrawlRow(Number(row.getAttribute('data-row')));
    var filter = e.target.closest('[data-filter]');
    if (filter && state.crawl) { state.crawl.filter = filter.getAttribute('data-filter'); renderCrawl(); }
    var open = e.target.closest('#live-open-page');
    if (open) { el.pageUrl.value = open.getAttribute('data-url'); el.launch.click(); }
    if (e.target.closest('#send-to-qa') && state.mockHtml) {
      el.html.value = state.mockHtml;
      setMode('qa');
      toast('Mock page loaded into QA — Run QA, or Generate brief from it.');
    }
  });

  // ─── BRIEF MODE DEPTH — component-mapped field tables ──────────────────
  // A second reading of the same page, through page-model.js's shared
  // model, laid out the way a manually-written Tridion content brief
  // actually reads: one card per component, its own evidence-bearing
  // label, a Field slot | Content table, an image placeholder, any
  // verbatim-flagged quotes, and — always shown, never blocking, never
  // force-fit — whatever the model could not map to any documented slot.

  function fieldTableRows(fieldTable) {
    if (!fieldTable || !fieldTable.slots.length) return '';
    return '<table class="field-table"><tbody>' + fieldTable.slots.map(function (s) {
      return '<tr><th>' + esc(s.label) + '</th><td>' + esc(s.content) +
        '<span class="field-evidence">' + esc(s.evidence) + '</span></td></tr>';
    }).join('') + '</tbody></table>';
  }

  function fieldUnmapped(fieldTable) {
    if (!fieldTable || !fieldTable.unmapped.length) return '';
    return '<div class="field-unmapped"><p class="field-unmapped-label">Unmapped content — ' +
      fieldTable.unmapped.length + '</p><ul>' +
      fieldTable.unmapped.map(function (u) {
        return '<li>' + esc(u.content || '(empty)') + '<span class="field-why">' + esc(u.why) + '</span></li>';
      }).join('') + '</ul></div>';
  }

  function renderBriefFieldTables(model) {
    if (!model.components.length) return '';
    var cards = model.components.map(function (c) {
      var label = c.componentLabel || (esc(c.type) + ' — no component identified, review before publishing');
      var imageRow = c.image
        ? '<p class="field-image"><span class="sev-tag check">image</span> ' + esc(c.image.asset || 'untitled asset') +
          (c.image.alt ? ' — alt: ' + esc(c.image.alt) : '') + '</p>'
        : '';
      var verbatimRow = (c.verbatim || []).length
        ? '<p class="field-verbatim">' + c.verbatim.map(function (v) {
            return '<span class="verbatim-chip">do not paraphrase</span> “' + esc(v) + '”';
          }).join('<br>') + '</p>'
        : '';
      var noneNote = !c.fieldTable
        ? '<p class="note">No named component identified for this section — nothing to map fields against.</p>'
        : '';
      return '<div class="field-card"><h4>' + esc(label) + '</h4>' +
        fieldTableRows(c.fieldTable) + imageRow + verbatimRow + noneNote + fieldUnmapped(c.fieldTable) +
        '</div>';
    }).join('');
    return section('Component field tables', cards);
  }

  function renderOpenItems(model) {
    var items = (model.unresolved || []).map(function (u) {
      return { text: u.text, why: u.why };
    }).concat((model.openItems || []).map(function (o) {
      return { text: o.text, why: o.why };
    }));
    if (!items.length) return '';
    return section('Open items',
      '<ul class="devs">' + items.map(function (it) {
        return '<li class="check"><p class="dev-note"><span class="sev-tag check">check</span>' +
          esc(it.text || '(no text)') + ' — ' + esc(it.why) + '</p></li>';
      }).join('') + '</ul>');
  }

  // ─── MOCK PAGE (in Analyse) ──────────────────────────────────────────────
  // Builds a small mock of the page this brief describes, for the market
  // chosen in Settings. page-model.js does the reading and inference;
  // mock-page.js only draws what it was handed — this is wiring, nothing more.
  function runMock() {
    var brief = el.brief.value.trim();
    if (!brief) { toast('Paste a brief first.'); return; }

    updateMarketOptions(brief);

    var model = state.pageModel.build(brief, { market: state.market });
    var rendered = state.mockPage.render(model, { labels: true });
    // The copy handed to QA carries no review labels: it is checked as a page.
    state.mockHtml = state.mockPage.render(model, { labels: false }).html;
    state.analyseView = 'mock';

    el.output.innerHTML = renderMockOutline(model) + renderMockPreview(rendered.html);
  }

  function renderMockOutline(model) {
    var tpl = model.page.template;
    var rows = model.components.map(function (c, i) {
      return '<li class="mock-outline-row">' +
        '<span class="chip-num">' + (i + 1) + '</span>' +
        '<span class="mock-outline-type">' + esc(c.type) + '</span>' +
        '<span class="mock-outline-conf mock-outline-' + esc(c.confidence) + '">' + esc(c.confidence) + '</span>' +
        '<span class="mock-outline-why">' + esc(c.why) + '</span></li>';
    }).join('');

    var body = rows ? '<ol class="mock-outline">' + rows + '</ol>' :
      '<p class="note">Nothing in this brief reads as a page component — only metadata and front matter, so nothing is shown. That is correct when the brief is a campaign brief rather than a content brief.</p>';

    if (model.unresolved.length) {
      body += '<p class="note warn">' + model.unresolved.length + ' row' + (model.unresolved.length === 1 ? '' : 's') +
        ' could not be placed: ' + model.unresolved.map(function (u) { return esc(u.why); }).join('; ') + '</p>';
    }

    var title = 'Page: ' + esc(tpl.type) + ' — ' + esc(tpl.confidence) + ' confidence';
    return section(title, body);
  }

  function renderMockPreview(html) {
    return '<section class="card" id="mock-preview-card"><h3>Mock page</h3>' +
      '<div class="input-actions"><button type="button" class="btn-ghost" id="send-to-qa">Send to QA</button></div>' +
      '<iframe id="mock-preview" sandbox="" srcdoc="' + esc(html) + '"></iframe></section>';
  }

  // A brief naming several markets has no "last column", only a target —
  // taking the last one anyway is a confirmed defect (a mock page filled
  // with Portuguese for a Spain job). This is what lets the author see every
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

  // ─── LIVE URL ────────────────────────────────────────────────────────────
  // One page, fetched by the backend. The HTML lands in the page box, so the
  // brief comparison and Generate brief work on it exactly as on a paste;
  // the fetch itself — status, redirects, certificate — joins the report.

  function normaliseUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    return /^https?:\/\//i.test(u) ? u : 'https://' + u;
  }

  function runLive() {
    var url = normaliseUrl(el.liveUrl.value);
    if (!url) { toast('Paste the page URL first.'); return; }
    el.liveBtn.disabled = true;
    el.output.innerHTML = section('Fetching', '<p class="prog-text">Asking the backend for ' + esc(url) + '…</p>');
    state.backend.fetchPage(url).then(function (r) {
      el.liveBtn.disabled = false;
      if (r.verdict !== 'ok' || !r.html) { renderLiveFailure(r); return; }
      var html = r.html.trim();
      el.html.value = html;
      state.live = Object.assign({}, r, { html: undefined });
      state.liveHtml = html;
      state.links = null; state.linksHtml = null;
      runQa();
      if (el.liveLinks.checked) checkPageLinks();
    }, function (err) {
      el.liveBtn.disabled = false;
      el.output.innerHTML = section('Could not fetch', '<p class="note warn">' + esc(capital(err.message)) + '.</p>');
    });
  }

  // A fetch that did not produce a page says exactly why — a dead page, a
  // login wall, a host the backend will not touch — and never looks like a pass.
  function renderLiveFailure(r) {
    var title = { dead: 'The page is broken', unverified: 'Could not verify the page', refused: 'Not fetched' }[r.verdict] || 'No page';
    var hops = (r.redirects || []).map(function (h) { return h.status + ' ' + esc(h.url); }).join(' → ');
    var login = /login|bookmarklet/i.test(r.reason || '');
    el.output.innerHTML = section(title,
      '<p class="headline"><span class="pill ' + esc(r.verdict) + '">' + esc(r.verdict) + '</span> ' + esc(capital(r.reason || '')) + '</p>' +
      factLine('URL', esc(r.url)) +
      (r.status ? factLine('HTTP status', esc(r.status)) : '') +
      (r.finalUrl && r.finalUrl !== r.url ? factLine('Ended at', esc(r.finalUrl)) : '') +
      (hops ? factLine('Redirects', hops) : '') +
      (login ? '<p class="note">Open it in your own signed-in browser and send it back with the bookmarklet: ' +
        '<button type="button" class="btn-ghost" id="live-open-page" data-url="' + esc(r.url) + '">Open page</button></p>' : ''));
  }

  // The links on the page in the box, through the backend's status check —
  // KONE and external alike, 40 at a time, status only.
  function checkPageLinks() {
    var html = el.html.value.trim();
    if (!html || !state.backend) return;
    var base = state.liveHtml === html && state.live ? state.live.finalUrl : null;
    if (!base) {
      var canon = /<link\b[^>]*rel=["']?canonical["']?[^>]*>/i.exec(html);
      var href = canon && /href=["']([^"']+)["']/i.exec(canon[0]);
      base = href ? href[1] : null;
    }
    var urls = state.qa.linksToCheck(html, base);
    if (!urls.length) { toast('No links on this page to check.'); return; }
    var results = [], i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve();
      var slice = urls.slice(i, i + 40);
      i += 40;
      toast('Checking links — ' + Math.min(i, urls.length) + ' of ' + urls.length + '…');
      return state.backend.linkStatus(slice).then(function (r) { results = results.concat(r.results); return next(); });
    }
    next().then(function () {
      if (el.html.value.trim() !== html) return;
      state.links = results;
      state.linksHtml = html;
      runQa();
      toast(urls.length + ' links checked.');
    }, function (err) { toast('Link check failed — ' + err.message); });
  }

  // ─── CRAWL ───────────────────────────────────────────────────────────────
  // The way the sample site auditor works, kept honest: pick sites by area,
  // frontline or market (or a sitemap, or a list); the backend reads each
  // site's sitemap and fetches its pages a few at a time; every page is
  // judged here, by the same checks as a pasted one. Then, if asked, every
  // link found is checked once across the whole run. Dead and unverified
  // are never merged, and a link that could not be verified is listed, not
  // dropped.

  var PAGE_CONCURRENCY = 4, PER_HOST = 2, DISCOVER_CONCURRENCY = 3, LINK_BATCH = 40;

  function markets() {
    var countries = (state.sites && state.sites.countries) || {};
    return Object.keys(countries).map(function (name) {
      return { name: name, domain: countries[name].domain, langPath: countries[name].langPath || null };
    });
  }
  function regions() { return (state.sites && state.sites.regions) || { areas: {}, frontlines: {} }; }
  function frontlineMarkets(fl) { return regions().frontlines[fl] || []; }
  function areaMarkets(area) {
    return (regions().areas[area] || []).reduce(function (all, fl) { return all.concat(frontlineMarkets(fl)); }, []);
  }

  function chip(kind, value, label, list) {
    var picked = list.filter(function (m) { return state.crawlPick[m]; }).length;
    var all = list.length && picked === list.length;
    return '<button type="button" class="chip' + (!all && picked ? ' some' : '') + '" data-pick="' + kind + '" data-value="' +
      esc(value) + '" aria-pressed="' + all + '">' + esc(label) + '<span class="n">' + list.length + '</span></button>';
  }

  function renderPicker() {
    var all = markets().map(function (m) { return m.name; });
    var r = regions();
    el.crawlScope.innerHTML = chip('all', '', 'Every site', all) +
      '<button type="button" class="chip" data-pick="none" data-value="">Clear</button>';
    el.crawlAreas.innerHTML = Object.keys(r.areas).map(function (a) { return chip('area', a, a, areaMarkets(a)); }).join('') ||
      '<span class="hint">No areas in config/sites.json.</span>';
    el.crawlFrontlines.innerHTML = Object.keys(r.frontlines).map(function (f) { return chip('frontline', f, f, frontlineMarkets(f)); }).join('') ||
      '<span class="hint">No frontlines in config/sites.json.</span>';
    el.crawlMarkets.innerHTML = markets().map(function (m) {
      return '<label><input type="checkbox" data-market="' + esc(m.name) + '"' + (state.crawlPick[m.name] ? ' checked' : '') + '>' +
        esc(m.name) + '</label>';
    }).join('');
    var n = all.filter(function (m) { return state.crawlPick[m]; }).length;
    el.crawlPicked.textContent = n ? n + ' of ' + all.length + ' picked' + (r.draft ? ' (areas and frontlines are a draft)' : '') : 'none picked';
  }

  // A chip picks every market under it, or — when all of them already are —
  // unpicks them, so the same click undoes itself.
  function onPickerClick(e) {
    var b = e.target.closest && e.target.closest('[data-pick]');
    if (!b) return;
    var kind = b.getAttribute('data-pick'), value = b.getAttribute('data-value');
    if (kind === 'none') { state.crawlPick = {}; renderPicker(); return; }
    var list = kind === 'all' ? markets().map(function (m) { return m.name; })
      : kind === 'area' ? areaMarkets(value) : frontlineMarkets(value);
    var allOn = list.every(function (m) { return state.crawlPick[m]; });
    list.forEach(function (m) { if (allOn) delete state.crawlPick[m]; else state.crawlPick[m] = true; });
    renderPicker();
  }

  function setCrawlSource(src) {
    state.crawlSrc = src;
    Array.prototype.forEach.call(el.crawlPanel.querySelectorAll('[data-crawl-src]'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-crawl-src') === src));
    });
    el.crawlSites.hidden = src !== 'sites';
    el.crawlSitemap.hidden = src !== 'sitemap';
    el.crawlList.hidden = src !== 'list';
  }

  function hostKey(url) { try { return new URL(url).hostname.toLowerCase(); } catch (e) { return ''; } }

  // Run fn over items with a global and a per-key (per-host) limit,
  // stopping when asked. Resolves when everything started has finished.
  function pool(items, keyOf, fn, limits) {
    limits = limits || {};
    var total = limits.total || PAGE_CONCURRENCY, perHost = limits.perKey || PER_HOST;
    return new Promise(function (resolve) {
      var queue = items.slice(), inFlight = 0, perKey = {};
      function pump() {
        var crawl = state.crawl;
        if ((!queue.length || crawl.stopped) && inFlight === 0) return resolve();
        if (crawl.stopped) return;
        for (var i = 0; i < queue.length && inFlight < total; i++) {
          var k = keyOf(queue[i]);
          if ((perKey[k] || 0) >= perHost) continue;
          var item = queue.splice(i, 1)[0];
          i--;
          inFlight++;
          perKey[k] = (perKey[k] || 0) + 1;
          (function (item, k) {
            Promise.resolve(fn(item)).catch(function () {}).then(function () {
              inFlight--;
              perKey[k]--;
              pump();
            });
          }(item, k));
        }
      }
      pump();
    });
  }

  function crawlLimit() {
    var n = parseInt(el.crawlLimit.value, 10);
    return isNaN(n) || n < 0 ? 50 : n;
  }

  // Step one: what to fetch.
  function buildWork() {
    var crawl = state.crawl;
    if (state.crawlSrc === 'list') {
      var seen = {};
      var urls = el.crawlUrls.value.split(/\n/).map(normaliseUrl).filter(function (u) { return u && !seen[u] && (seen[u] = true); });
      if (!urls.length) throw new Error('Paste at least one URL.');
      return Promise.resolve(urls.map(function (u) { return { url: u, site: hostKey(u).replace(/^www\./, '') }; }));
    }
    if (state.crawlSrc === 'sitemap') {
      var sm = normaliseUrl(el.crawlSitemapUrl.value);
      if (!sm) throw new Error('Paste a sitemap URL.');
      crawl.phase = 'Reading the sitemap…';
      renderCrawlSoon();
      return state.backend.sitemap(sm, { perSiteLimit: crawlLimit() }).then(function (r) {
        if (r.error) throw new Error(capital(r.error));
        if (r.partial) crawl.notes.push('The sitemap was only partly read — it is larger than one request can walk.');
        if (r.available > r.urls.length) crawl.notes.push(r.urls.length + ' of ' + r.available + ' URLs taken (pages per site).');
        return r.urls.map(function (u) { return { url: u, site: hostKey(u).replace(/^www\./, '') }; });
      });
    }
    var picked = markets().filter(function (m) { return state.crawlPick[m.name]; });
    if (!picked.length) throw new Error('Pick at least one site — a market, a frontline, an area, or every site.');
    var work = [], done = 0;
    crawl.phase = 'Reading sitemaps — 0 of ' + picked.length + ' sites';
    renderCrawlSoon();
    return pool(picked, function () { return 'discover'; }, function (m) {
      return state.backend.discover({ domain: m.domain, langPath: m.langPath }, { perSiteLimit: crawlLimit(), pathPrefix: el.crawlPrefix.value.trim() })
        .then(function (r) {
          if (r.error && !r.urls.length) crawl.notes.push(m.name + ' — ' + r.error);
          else {
            if (r.partial) crawl.notes.push(m.name + ' — the sitemaps were only partly read (very large site).');
            if (r.excluded && r.excluded.robots) crawl.notes.push(m.name + ' — ' + r.excluded.robots + ' URL' + (r.excluded.robots === 1 ? '' : 's') + ' skipped: robots.txt disallows them.');
            crawl.available += r.available;
          }
          r.urls.forEach(function (u) { work.push({ url: u, site: r.site, market: m.name }); });
        }, function (err) { crawl.notes.push(m.name + ' — ' + err.message); })
        .then(function () {
          done++;
          crawl.phase = 'Reading sitemaps — ' + done + ' of ' + picked.length + ' sites';
          renderCrawlSoon();
        });
    }, { total: DISCOVER_CONCURRENCY, perKey: DISCOVER_CONCURRENCY }).then(function () { return work; });
  }

  function startCrawl() {
    if (!state.backend || (state.crawl && state.crawl.running)) return;
    state.crawl = { running: true, stopped: false, phase: 'Starting…', notes: [], rows: [], work: [], available: 0,
      started: Date.now(), finished: null, filter: 'all', site: '', open: null, links: null, checkLinks: el.crawlLinks.checked };
    el.crawlBtn.disabled = true;
    el.crawlStop.hidden = false;
    el.crawlStop.disabled = false;
    renderCrawl();
    var crawl = state.crawl;
    var work;
    try { work = buildWork(); } catch (e) { finishCrawl(e.message); return; }
    work.then(function (items) {
      crawl.work = items;
      if (!items.length) { finishCrawl(crawl.notes.length ? 'Nothing to crawl.' : 'The sitemaps listed no pages.'); return; }
      crawl.phase = 'Fetching pages';
      renderCrawlSoon();
      return pool(items, function (w) { return hostKey(w.url); }, crawlPage)
        .then(function () { return crawl.checkLinks && !crawl.stopped ? linkPass() : null; })
        .then(function () { finishCrawl(); });
    }).catch(function (err) { finishCrawl(err.message); });
  }

  function crawlPage(w) {
    var crawl = state.crawl;
    return state.backend.fetchPage(w.url).then(function (r) {
      var row;
      if (r.verdict === 'ok' && r.html) {
        var live = Object.assign({}, r, { html: undefined });
        var result = state.qa.run(r.html, { live: live });
        row = state.qa.crawlRow(result, live);
        row.result = result;
        if (crawl.checkLinks) row.links = state.qa.linksToCheck(r.html, r.finalUrl);
      } else {
        row = { url: r.url, finalUrl: r.finalUrl, status: r.status, verdict: r.verdict, reason: r.reason,
          breaks: 0, checks: 0, known: 0 };
      }
      row.site = w.site;
      row.market = row.market || w.market || null;
      crawl.rows.push(row);
      renderCrawlSoon();
    }, function (err) {
      crawl.rows.push({ url: w.url, site: w.site, market: w.market || null, status: null, verdict: 'unverified',
        reason: err.message, breaks: 0, checks: 0, known: 0 });
      if (err.status === 401) crawl.stopped = true;
      renderCrawlSoon();
    });
  }

  // Every link found on every page, checked once.
  function linkPass() {
    var crawl = state.crawl;
    var sources = {};
    crawl.rows.forEach(function (row) {
      (row.links || []).forEach(function (u) { (sources[u] = sources[u] || []).push(row.url); });
    });
    var targets = Object.keys(sources);
    crawl.links = { total: targets.length, done: 0, statuses: {}, sources: sources };
    crawl.phase = 'Checking links';
    renderCrawlSoon();
    var batches = [];
    for (var i = 0; i < targets.length; i += LINK_BATCH) batches.push(targets.slice(i, i + LINK_BATCH));
    return pool(batches, function () { return 'links'; }, function (batch) {
      return state.backend.linkStatus(batch).then(function (r) {
        r.results.forEach(function (s) { crawl.links.statuses[s.url] = s; });
      }, function (err) {
        batch.forEach(function (u) { crawl.links.statuses[u] = { url: u, verdict: 'unverified', reason: 'the check did not run — ' + err.message }; });
      }).then(function () {
        crawl.links.done += batch.length;
        renderCrawlSoon();
      });
    }, { total: 2, perKey: 2 }).then(function () {
      crawl.rows.forEach(function (row) {
        if (!row.result || !row.links) return;
        var statuses = row.links.map(function (u) { return crawl.links.statuses[u]; }).filter(Boolean);
        row.result = state.qa.withLinkStatuses(row.result, statuses);
        row.breaks = row.result.breaks;
        row.checks = row.result.checks;
        row.brokenLinks = statuses.filter(function (s) { return s.verdict === 'dead'; }).length;
      });
    });
  }

  function finishCrawl(message) {
    var crawl = state.crawl;
    crawl.running = false;
    crawl.finished = Date.now();
    if (message) crawl.notes.unshift(message);
    crawl.phase = crawl.stopped ? 'Stopped after ' + crawl.rows.length + ' of ' + crawl.work.length + ' pages'
      : message && !crawl.rows.length ? 'Did not run' : 'Done';
    el.crawlBtn.disabled = false;
    el.crawlStop.hidden = true;
    renderCrawl();
  }

  var crawlTimer = null;
  function renderCrawlSoon() {
    if (crawlTimer) return;
    crawlTimer = setTimeout(function () { crawlTimer = null; renderCrawl(); }, 250);
  }

  var FILTERS = [
    ['all', 'All', function () { return true; }],
    ['dead', 'Dead', function (r) { return r.verdict === 'dead'; }],
    ['unverified', 'Unverified', function (r) { return r.verdict === 'unverified' || r.verdict === 'refused'; }],
    ['breaks', 'To fix', function (r) { return r.breaks > 0; }],
    ['title', 'Title format', function (r) { return r.titleFormat === 'red' || r.titleFormat === 'amber'; }],
    ['form', 'Form ID wrong', function (r) { return r.formId === 'differs' || r.formId === 'missing'; }],
    ['links', 'Broken links', function (r) { return r.brokenLinks > 0; }]
  ];

  function renderCrawl() {
    if (state.mode !== 'qa' || state.qaSource !== 'crawl') return;
    var crawl = state.crawl;
    if (!crawl) {
      el.output.innerHTML = '<div class="empty-state"><p>Pick the sites to crawl — every site, an area, a frontline, ' +
        'or single markets — or give one sitemap or a list of URLs, then <strong>Run crawl</strong>.</p>' +
        '<p>Each site\'s pages come from its sitemap, capped by <strong>Pages per site</strong>. Every page gets the same ' +
        'checks as a pasted one, plus what the live fetch shows: the HTTP status, redirects and the certificate. ' +
        'Results stream in; <strong>Stop</strong> works at any point.</p>' +
        '<p>Click any row for that page\'s full QA report. <strong>Check links</strong> adds a second pass that checks every ' +
        'link found once across the whole run — KONE and external — and lists broken and unverifiable links apart.</p></div>';
      return;
    }
    if (crawl.open !== null) return; // a page's report is on screen; leave it be

    var rows = crawl.rows;
    var count = function (fn) { return rows.filter(fn).length; };
    var total = crawl.work.length;
    var pct = crawl.links && crawl.phase === 'Checking links'
      ? (crawl.links.total ? crawl.links.done / crawl.links.total : 1)
      : (total ? rows.length / total : 0);
    var phase = crawl.phase === 'Fetching pages' ? rows.length + ' of ' + total + ' pages fetched'
      : crawl.phase === 'Checking links' ? crawl.links.done + ' of ' + crawl.links.total + ' links checked'
      : crawl.phase === 'Done' ? 'Done — ' + rows.length + ' page' + (rows.length === 1 ? '' : 's') + ' in ' + elapsed(crawl)
      : crawl.phase;
    var head = section('Crawl',
      '<div class="prog"><span style="width:' + Math.round(Math.min(1, crawl.running ? pct : 1) * 100) + '%"></span></div>' +
      '<p class="prog-text">' + esc(phase) + '</p>' +
      (crawl.notes.length ? '<ul class="crawl-notes">' + crawl.notes.map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('') + '</ul>' : ''));
    if (!rows.length) { paintCrawl(head); return; }

    var broken = 0, unverifiedLinks = 0;
    if (crawl.links) {
      Object.keys(crawl.links.statuses).forEach(function (u) {
        var v = crawl.links.statuses[u].verdict;
        if (v === 'dead') broken++; else if (v !== 'ok') unverifiedLinks++;
      });
    }
    var tally = '<p class="tally"><b>' + rows.length + '</b> pages · <b>' + count(function (r) { return r.verdict === 'ok'; }) + '</b> ok · <b>' +
      count(function (r) { return r.verdict === 'dead'; }) + '</b> dead · <b>' +
      count(function (r) { return r.verdict === 'unverified' || r.verdict === 'refused'; }) + '</b> unverified · <b>' +
      count(function (r) { return r.breaks > 0; }) + '</b> with something to fix' +
      (crawl.links ? ' · <b>' + broken + '</b> broken link' + (broken === 1 ? '' : 's') : '') + '</p>';

    paintCrawl(head + tally + renderRollup(rows) + renderCrawlTable(rows) + renderLinkTables(crawl));
  }

  // Updates in place: once the results are on screen, a refresh replaces
  // them without replaying the roll-in, and keeps the reader's scroll.
  function paintCrawl(html) {
    var settled = el.output.getAttribute('data-view') === 'crawl';
    var top = el.output.scrollTop;
    el.output.innerHTML = html;
    el.output.setAttribute('data-view', 'crawl');
    if (!settled) return;
    Array.prototype.forEach.call(el.output.children, function (c) { c.classList.add('reveal', 'in-view', 'settled'); });
    el.output.scrollTop = top;
  }

  function elapsed(crawl) {
    var s = Math.round(((crawl.finished || Date.now()) - crawl.started) / 1000);
    return s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + (s % 60) + ' s';
  }

  // Only when there is more than one site to compare — a one-row rollup
  // says nothing the tally above does not.
  function renderRollup(rows) {
    var sites = {};
    rows.forEach(function (r) {
      var g = sites[r.site] = sites[r.site] || { site: r.site, market: r.market, pages: 0, ok: 0, dead: 0, unverified: 0, breaks: 0, checks: 0, title: 0, form: 0 };
      g.pages++;
      if (r.verdict === 'ok') g.ok++; else if (r.verdict === 'dead') g.dead++; else g.unverified++;
      g.breaks += r.breaks; g.checks += r.checks;
      if (r.titleFormat === 'red' || r.titleFormat === 'amber') g.title++;
      if (r.formId === 'differs' || r.formId === 'missing') g.form++;
    });
    var list = Object.keys(sites).sort().map(function (k) { return sites[k]; });
    if (list.length < 2) return '';
    return section('By site', '<div class="table-wrap"><table class="crawl"><thead><tr><th>Site</th><th>Pages</th><th>OK</th>' +
      '<th>Dead</th><th>Unverified</th><th>To fix</th><th>To check</th><th>Title format</th><th>Form ID wrong</th></tr></thead><tbody>' +
      list.map(function (g) {
        return '<tr><td>' + esc(g.site) + (g.market ? '<br><small>' + esc(g.market) + '</small>' : '') + '</td><td class="num">' + g.pages +
          '</td><td class="num">' + g.ok + '</td><td class="num">' + g.dead + '</td><td class="num">' + g.unverified +
          '</td><td class="num">' + g.breaks + '</td><td class="num">' + g.checks + '</td><td class="num">' + g.title +
          '</td><td class="num">' + g.form + '</td></tr>';
      }).join('') + '</tbody></table></div>');
  }

  var FORM_LABEL = { matches: 'right', differs: 'wrong', missing: 'missing', 'not-checked': 'not checked' };

  function renderCrawlTable(rows) {
    var crawl = state.crawl;
    var f = FILTERS.filter(function (x) { return x[0] === crawl.filter; })[0] || FILTERS[0];
    var shown = [];
    rows.forEach(function (r, i) { if (f[2](r)) shown.push(i); });
    var chips = FILTERS.filter(function (x) { return x[0] !== 'links' || crawl.links; }).map(function (x) {
      var n = rows.filter(x[2]).length;
      return '<button type="button" class="chip" data-filter="' + x[0] + '" aria-pressed="' + (x[0] === crawl.filter) + '">' +
        esc(x[1]) + '<span class="n">' + n + '</span></button>';
    }).join('');
    var body = shown.map(function (i) {
      var r = rows[i];
      var status = '<span class="pill ' + esc(r.verdict) + '">' + esc(r.status || r.verdict) + '</span>';
      var title = r.titleFormat ? '<span class="pill ' + esc(r.titleFormat) + '">' + esc(r.titleFormat) + '</span>' : '';
      var form = r.formId ? '<span class="pill ' + esc(r.formId) + '">' + esc(FORM_LABEL[r.formId] || r.formId) + '</span>' : '';
      var detail = r.result ? '' : '<br><small>' + esc(capital(r.reason || '')) + '</small>';
      return '<tr class="' + (r.result ? 'open-row' : '') + '"' + (r.result ? ' data-row="' + i + '"' : '') + '>' +
        '<td class="url">' + esc(r.url) + detail + '</td><td>' + status + '</td><td>' + title + '</td><td>' + form + '</td>' +
        '<td class="num">' + (r.result ? r.breaks : '') + '</td><td class="num">' + (r.result ? r.checks : '') + '</td>' +
        (crawl.links ? '<td class="num">' + (r.brokenLinks || '') + '</td>' : '') +
        '<td>' + (r.tcmId ? esc(r.tcmId) : '') + '</td></tr>';
    }).join('');
    return '<section class="card"><h3>Pages — ' + shown.length + '</h3><div class="filters">' + chips + '</div>' +
      '<div class="table-wrap"><table class="crawl"><thead><tr><th>Page</th><th>Status</th><th>Title</th><th>Form ID</th>' +
      '<th>To fix</th><th>To check</th>' + (crawl.links ? '<th>Broken links</th>' : '') + '<th>TCM ID</th></tr></thead><tbody>' +
      (body || '<tr><td colspan="8"><i>No pages match this filter.</i></td></tr>') + '</tbody></table></div>' +
      '<div class="input-actions"><button type="button" class="btn-ghost" id="crawl-csv">Export CSV</button></div>' +
      '<p class="caution">Click a page for its full report. The export carries CME edit links — keep it within the team.</p></section>';
  }

  function renderLinkTables(crawl) {
    if (!crawl.links) return '';
    var broken = [], unverified = [];
    Object.keys(crawl.links.statuses).forEach(function (u) {
      var s = crawl.links.statuses[u];
      var item = { s: s, pages: crawl.links.sources[u] || [] };
      if (s.verdict === 'dead') broken.push(item); else if (s.verdict !== 'ok') unverified.push(item);
    });
    function table(list) {
      return '<div class="table-wrap"><table class="crawl"><thead><tr><th>Link</th><th>Answer</th><th>Linked from</th></tr></thead><tbody>' +
        list.map(function (it) {
          var pages = it.pages.slice(0, 3).map(esc).join('<br>') + (it.pages.length > 3 ? '<br><small>and ' + (it.pages.length - 3) + ' more</small>' : '');
          return '<tr><td class="url">' + esc(it.s.url) + '</td><td>' + esc(capital(it.s.reason || String(it.s.status))) + '</td><td class="url">' + pages + '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    return section('Broken links — ' + broken.length, broken.length ? table(broken) : '<p class="clean">None of the ' + crawl.links.done + ' links checked is broken.</p>') +
      (unverified.length ? section('Links not verified — ' + unverified.length,
        '<p class="note">No usable answer — blocked, rate-limited, timed out or behind a login. Not counted as broken; open them by hand.</p>' +
        table(unverified)) : '');
  }

  function openCrawlRow(i) {
    var row = state.crawl.rows[i];
    if (!row || !row.result) return;
    state.crawl.open = i;
    renderQa(row.result, null, { back: true });
    el.output.scrollTop = 0;
  }

  // Excel opens a UTF-8 CSV correctly only with a byte-order mark. A cell
  // that starts like a formula is quoted out of being one.
  function csvCell(v) {
    var s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function exportCrawlCsv() {
    var crawl = state.crawl;
    if (!crawl || !crawl.rows.length) return;
    var cols = [['URL', 'url'], ['Final URL', 'finalUrl'], ['HTTP status', 'status'], ['Verdict', 'verdict'], ['Reason', 'reason'],
      ['Site', 'site'], ['Market', 'market'], ['Title', 'title'], ['Title format', 'titleFormat'], ['Form ID', 'formId'],
      ['Form ID found', 'formIdFound'], ['To fix', 'breaks'], ['To check', 'checks'], ['Known template issues', 'known'],
      ['Broken links', 'brokenLinks'], ['TCM ID', 'tcmId'], ['Open in CME', 'cme']];
    var lines = [cols.map(function (c) { return csvCell(c[0]); }).join(',')].concat(crawl.rows.map(function (r) {
      return cols.map(function (c) { return csvCell(r[c[1]]); }).join(',');
    }));
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'wcm-crawl-' + new Date(crawl.started).toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  function capital(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }

  function copyPlain(text) {
    navigator.clipboard.writeText(text)
      .then(function () { toast('Copied.'); })
      .catch(function () { toast('Could not copy — select and copy by hand.'); });
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

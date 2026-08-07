/* app.js — UI layer.
 *
 * This file renders; it does not analyse. Every fact on screen comes from the
 * single result object the engine returns, which is also what the Excel export
 * and (later) any agent layer would consume. Keeping that boundary means the
 * display can be rewritten without touching a scoring rule.
 */
(function () {
  'use strict';

  var CONFIG_FILES = ['work-types', 'components', 'risk-flags', 'locations', 'execution-steps'];

  var state = {
    config: null,
    engine: null,
    feedback: null,
    analysis: null,
    baseText: '',
    answers: []
  };

  var el = {
    brief: document.getElementById('brief'),
    output: document.getElementById('output'),
    analyseBtn: document.getElementById('analyse-btn'),
    uploadBtn: document.getElementById('upload-btn'),
    sampleBtn: document.getElementById('sample-btn'),
    clearBtn: document.getElementById('clear-btn'),
    fileInput: document.getElementById('file-input'),
    cmsSelect: document.getElementById('cms-select'),
    typeSelect: document.getElementById('type-select'),
    exportBtn: document.getElementById('export-btn'),
    queueBtn: document.getElementById('queue-btn'),
    queueCount: document.getElementById('queue-count'),
    queueDialog: document.getElementById('queue-dialog'),
    queueBody: document.getElementById('queue-body'),
    queueClear: document.getElementById('queue-clear'),
    toast: document.getElementById('toast')
  };

  var SAMPLE = 'Hi team — we need the Header EXF updated in AEM. Please add a new Level 1 nav item labelled ' +
    '"Modernisation" to the mega menu, pointing at /content/frontlines/uk/en/modernisation. It should roll out from ' +
    'Master EN down to Region Master AME and then to all country sites. This is for PROD. The market lead has approved.';

  // ─── BOOT ────────────────────────────────────────────────────────────────

  function boot() {
    Promise.all(CONFIG_FILES.map(function (name) {
      return fetch('config/' + name + '.json').then(function (r) {
        if (!r.ok) throw new Error(name + '.json returned ' + r.status);
        return r.json();
      }).then(function (json) { return [name, json]; });
    })).then(function (pairs) {
      var config = {};
      pairs.forEach(function (pair) { config[pair[0]] = pair[1]; });
      state.config = config;
      state.engine = BriefEngine.create(config);
      state.feedback = BriefFeedback.create({ config: config });
      populateTypeSelect();
      refreshQueueCount();
      wire();
    }).catch(function (err) {
      el.output.innerHTML = '<section class="card blocks"><h3>Configuration failed to load</h3>' +
        '<p>' + escapeHtml(err.message) + '</p>' +
        '<p class="sub">The config JSONs are fetched at runtime, so the page has to be served over HTTP — ' +
        'opening index.html directly from disk will not work. Run <code>npm start</code> and use the URL it prints.</p>' +
        '</section>';
    });
  }

  function populateTypeSelect() {
    state.config['work-types'].workTypes.forEach(function (type) {
      var option = document.createElement('option');
      option.value = type.id;
      option.textContent = type.label;
      el.typeSelect.appendChild(option);
    });
  }

  function wire() {
    el.analyseBtn.addEventListener('click', function () { analyse(el.brief.value, true); });
    el.sampleBtn.addEventListener('click', function () { el.brief.value = SAMPLE; analyse(SAMPLE, true); });
    el.clearBtn.addEventListener('click', function () {
      el.brief.value = '';
      state.analysis = null;
      state.answers = [];
      el.cmsSelect.value = '';
      el.typeSelect.value = '';
      el.exportBtn.disabled = true;
      el.output.innerHTML = '<h2 class="pane-title">Analysis</h2><div class="empty-state"><p>Cleared. Paste another brief.</p></div>';
    });

    el.uploadBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      if (file) readFile(file);
      el.fileInput.value = '';
    });

    el.cmsSelect.addEventListener('change', function () { rerun(); });

    el.typeSelect.addEventListener('change', function () {
      // A manual override is a correction: log it for the curation queue before
      // re-running, while the engine's original guess is still on screen.
      if (el.typeSelect.value && state.analysis && state.analysis.workType.id !== el.typeSelect.value) {
        state.feedback.record({
          kind: 'work-type',
          excerpt: state.baseText,
          engineGuess: state.analysis.workType.id,
          actual: el.typeSelect.value,
          confidence: state.analysis.workType.confidence
        });
        refreshQueueCount();
        toast('Correction logged for review');
      }
      rerun();
    });

    el.exportBtn.addEventListener('click', function () {
      if (!state.analysis) return;
      var name = BriefExport.download([state.analysis]);
      toast('Exported ' + name);
    });

    el.queueBtn.addEventListener('click', showQueue);
    el.queueClear.addEventListener('click', function () {
      state.feedback.clear();
      refreshQueueCount();
      showQueue();
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-close-dialog]'), function (btn) {
      btn.addEventListener('click', function () { el.queueDialog.close(); });
    });
  }

  // ─── FILE INTAKE ─────────────────────────────────────────────────────────

  function readFile(file) {
    var isDocx = /\.docx$/i.test(file.name);
    if (!isDocx) {
      file.text().then(function (text) { el.brief.value = text; analyse(text, true); });
      return;
    }
    file.arrayBuffer()
      .then(extractDocxText)
      .then(function (text) { el.brief.value = text; analyse(text, true); })
      .catch(function (err) {
        toast('Could not read that .docx — paste the text instead');
        console.error(err);
      });
  }

  // A .docx is a ZIP holding word/document.xml. Rather than pull in a zip
  // library (and with it a CDN request), the central directory is walked by
  // hand and the entry inflated with the platform's own DecompressionStream.
  function extractDocxText(buffer) {
    var view = new DataView(buffer);
    var bytes = new Uint8Array(buffer);

    var eocd = -1;
    for (var i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) return Promise.reject(new Error('Not a ZIP container'));

    var entries = view.getUint16(eocd + 10, true);
    var offset = view.getUint32(eocd + 16, true);
    var target = null;

    for (var e = 0; e < entries; e++) {
      if (view.getUint32(offset, true) !== 0x02014b50) break;
      var method = view.getUint16(offset + 10, true);
      var compSize = view.getUint32(offset + 20, true);
      var nameLen = view.getUint16(offset + 28, true);
      var extraLen = view.getUint16(offset + 30, true);
      var commentLen = view.getUint16(offset + 32, true);
      var localOffset = view.getUint32(offset + 42, true);
      var name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
      if (name === 'word/document.xml') { target = { method: method, compSize: compSize, localOffset: localOffset }; break; }
      offset += 46 + nameLen + extraLen + commentLen;
    }
    if (!target) return Promise.reject(new Error('word/document.xml not found'));

    var localNameLen = view.getUint16(target.localOffset + 26, true);
    var localExtraLen = view.getUint16(target.localOffset + 28, true);
    var dataStart = target.localOffset + 30 + localNameLen + localExtraLen;
    var data = bytes.subarray(dataStart, dataStart + target.compSize);

    var xml;
    if (target.method === 0) {
      xml = Promise.resolve(new TextDecoder().decode(data));
    } else if (typeof DecompressionStream === 'function') {
      var stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      xml = new Response(stream).text();
    } else {
      return Promise.reject(new Error('This browser cannot inflate the document'));
    }

    return xml.then(function (markup) {
      return markup
        .replace(/<w:tab\b[^>]*\/>/g, '\t')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'").replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    });
  }

  // ─── ANALYSIS ────────────────────────────────────────────────────────────

  function analyse(text, resetAnswers) {
    if (!text || !text.trim()) { toast('Paste a brief first'); return; }
    if (resetAnswers) { state.answers = []; state.baseText = text; }
    rerun();
  }

  function rerun() {
    if (!state.baseText) return;
    var options = {};
    if (el.cmsSelect.value) options.cmsOverride = el.cmsSelect.value;
    if (el.typeSelect.value) options.workTypeOverride = el.typeSelect.value;

    state.analysis = state.answers.length
      ? state.engine.refine(state.baseText, state.answers, options)
      : state.engine.analyse(state.baseText, options);

    el.exportBtn.disabled = false;
    render(state.analysis);
  }

  function answerQuestion(question, answer) {
    state.answers.push({ question: question, answer: answer });
    state.feedback.record({ kind: 'open-answer', excerpt: question + ' → ' + answer, engineGuess: state.analysis.workType.id, actual: null });
    rerun();
    toast('Re-scored with your answer');
  }

  // ─── RENDER ──────────────────────────────────────────────────────────────
  // Priority order is deliberate (§2.1): a hard block or a scope problem means
  // the brief needs restructuring before a completeness percentage means
  // anything, so those come first and the score comes after.

  function render(a) {
    var html = ['<h2 class="pane-title">Analysis</h2>'];

    html.push(renderVerdict(a));
    if (a.hardBlocks.length) html.push(renderBlocks(a));
    if (a.riskFlags.length) html.push(renderRisks(a));
    html.push(renderCompleteness(a));
    html.push(renderEffort(a));
    html.push(renderComponents(a));
    if (a.assets.supplied.length || a.assets.missing.length) html.push(renderAssets(a));
    html.push(renderSteps(a));
    if (a.questions.length) html.push(renderQuestions(a));

    el.output.innerHTML = html.join('');

    Array.prototype.forEach.call(el.output.querySelectorAll('[data-question]'), function (row) {
      var input = row.querySelector('input');
      var button = row.querySelector('button');
      function submit() {
        if (!input.value.trim()) return;
        answerQuestion(row.getAttribute('data-question'), input.value.trim());
      }
      button.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    });

    var copyBtn = el.output.querySelector('#copy-questions');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var text = a.questions.map(function (q, i) { return (i + 1) + '. ' + q.question; }).join('\n');
        navigator.clipboard.writeText(text).then(function () { toast('Questions copied'); });
      });
    }
  }

  function renderVerdict(a) {
    var out = ['<div class="verdict">'];
    out.push('<p class="verdict-type">' + escapeHtml(a.workType.label) + '</p>');

    var meta = 'Confidence ' + a.workType.confidence + '%';
    if (a.workType.overridden) meta += ' — manually set';
    if (a.workType.runnerUp) meta += ' &middot; runner-up: ' + escapeHtml(a.workType.runnerUp.label) + ' ' + a.workType.runnerUp.confidence + '%';
    out.push('<p class="verdict-meta">' + meta + '</p>');

    var ragClass = a.completeness.rag;
    out.push('<div class="badges">');
    out.push('<span class="badge blue">' + escapeHtml(a.cms.label) + '</span>');
    out.push('<span class="badge ' + ragClass + '">Completeness ' + a.completeness.score + '%</span>');
    out.push('<span class="badge">Effort: ' + escapeHtml(a.effort.tier) + '</span>');
    if (a.location.environments.length) out.push('<span class="badge">' + escapeHtml(a.location.environments.join(', ')) + '</span>');
    if (a.location.markets.length) out.push('<span class="badge">' + escapeHtml(a.location.markets.map(function (m) { return m.code; }).join(', ')) + '</span>');
    if (a.hardBlocks.length) out.push('<span class="badge red">' + a.hardBlocks.length + ' hard block' + (a.hardBlocks.length > 1 ? 's' : '') + '</span>');
    out.push('</div>');

    if (a.workType.ambiguous) {
      out.push('<div class="ambiguous-note"><strong>Ambiguous — please confirm.</strong> ' +
        'The signals in this brief do not separate the top work types cleanly enough to pick one. ' +
        'Answer the open question below, or set the work type manually on the left.</div>');
    }
    if (a.cms.requiresManualSelection) {
      out.push('<div class="ambiguous-note"><strong>CMS platform unspecified.</strong> ' +
        'Execution steps are CMS-specific, so they are withheld until you choose AEM or Tridion on the left.</div>');
    }

    out.push('<details class="why"><summary>Why this classification?</summary><table>');
    a.workType.matchedKeywords.forEach(function (k) {
      var tier = k.weight === 3 ? 'strong' : (k.weight === 2 ? 'medium' : 'weak');
      out.push('<tr><td>' + escapeHtml(k.term) + '</td><td>' + tier + ' (' + k.weight + ')</td></tr>');
    });
    if (!a.workType.matchedKeywords.length) out.push('<tr><td>No keywords matched</td><td>—</td></tr>');
    out.push('</table>');
    out.push('<p class="sub">Scored against all ' + a.allScores.length + ' work types: ' +
      a.allScores.slice(0, 4).map(function (s) { return escapeHtml(s.label + ' ' + s.score); }).join(' &middot; ') + '</p>');
    out.push('</details>');

    out.push('<p class="sub" style="margin-top:12px">' + escapeHtml(a.synthesis) + '</p>');
    out.push('</div>');
    return out.join('');
  }

  function renderBlocks(a) {
    var out = ['<section class="card blocks"><h3>P1 hard blocks — resolve before starting</h3><ul class="plain">'];
    a.hardBlocks.forEach(function (block) {
      out.push('<li><strong>' + escapeHtml(block.label) + '</strong>' +
        '<div class="sub">' + escapeHtml(block.detail) + '</div>' +
        '<div class="field-row"><div class="q">Ask: ' + escapeHtml(block.question) + '</div></div></li>');
    });
    out.push('</ul></section>');
    return out.join('');
  }

  function renderRisks(a) {
    var triggered = a.riskFlags.filter(function (f) { return f.source === 'triggered'; });
    var standing = a.riskFlags.filter(function (f) { return f.source === 'standing'; });
    var out = ['<section class="card risks"><h3>Risk flags</h3><ul class="plain">'];

    triggered.forEach(function (f) { out.push(riskItem(f, false)); });
    standing.forEach(function (f) { out.push(riskItem(f, true)); });

    out.push('</ul>');
    if (standing.length) out.push('<p class="sub">Standing risks are known issues for this work type rather than something detected in the brief.</p>');
    out.push('</section>');
    return out.join('');
  }

  function riskItem(f, isStanding) {
    return '<li class="' + (isStanding ? 'standing' : '') + '">' +
      '<span class="sev ' + f.severity + '">' + f.severity + '</span>' +
      '<strong>' + escapeHtml(f.label) + '</strong>' +
      '<div class="sub">' + escapeHtml(f.workaround) + '</div>' +
      '<div class="sub">' + escapeHtml(f.component || '') + (f.environment ? ' &middot; ' + escapeHtml(f.environment) : '') +
      ' &middot; ' + escapeHtml(f.why.join('; ')) + '</div></li>';
  }

  function renderCompleteness(a) {
    var out = ['<section class="card"><h3>Completeness — ' + a.completeness.score + '% (' + a.completeness.rag.toUpperCase() + ')</h3>'];
    out.push('<div class="meter ' + a.completeness.rag + '"><span style="width:' + a.completeness.score + '%"></span></div>');
    out.push('<ul class="plain">');

    a.completeness.missing.forEach(function (field) {
      out.push('<li><div class="field-row"><div><span class="cross">Missing</span> ' + escapeHtml(field.label) +
        '<div class="q">Ask: ' + escapeHtml(field.question) + '</div></div></div></li>');
    });
    a.completeness.present.forEach(function (field) {
      out.push('<li><span class="tick">Present</span> ' + escapeHtml(field.label) + '</li>');
    });
    a.completeness.optional.forEach(function (field) {
      out.push('<li class="standing">' + (field.present ? '<span class="tick">Present</span>' : 'Optional') +
        ' ' + escapeHtml(field.label) + '</li>');
    });

    out.push('</ul></section>');
    return out.join('');
  }

  function renderEffort(a) {
    return '<section class="card"><h3>Effort tier — ' + escapeHtml(a.effort.tier) + '</h3>' +
      '<ul class="plain">' + a.effort.reasons.map(function (r) { return '<li>' + escapeHtml(r) + '</li>'; }).join('') +
      '</ul></section>';
  }

  function renderComponents(a) {
    var out = ['<section class="card"><h3>Components</h3><ul class="plain">'];
    if (!a.components.identified.length) {
      out.push('<li class="sub">No component named or implied in the brief.</li>');
    }
    a.components.identified.forEach(function (c) {
      out.push('<li><strong>' + escapeHtml(c.name) + '</strong> <span class="badge">' + escapeHtml(c.platform) + '</span>' +
        '<div class="sub">Matched: ' + escapeHtml(c.matchedTriggers.join(', ')) +
        ' &middot; author effort ' + escapeHtml(c.effortAuthor) + ', QA effort ' + escapeHtml(c.effortQA) + '</div>' +
        (c.note ? '<div class="sub">' + escapeHtml(c.note) + '</div>' : '') + '</li>');
    });
    a.components.recommended.forEach(function (c) {
      out.push('<li class="standing"><strong>' + escapeHtml(c.name) + '</strong> — not mentioned' +
        '<div class="sub">' + escapeHtml(c.reason) + '</div></li>');
    });
    out.push('</ul></section>');
    return out.join('');
  }

  function renderAssets(a) {
    var out = ['<section class="card"><h3>Assets</h3><ul class="plain">'];
    a.assets.missing.forEach(function (asset) {
      out.push('<li><span class="cross">Missing</span> ' + escapeHtml(asset.label) +
        '<div class="sub">Needed by: ' + escapeHtml(asset.forComponents.join(', ')) + '</div>' +
        '<div class="q">Ask: ' + escapeHtml(asset.question) + '</div></li>');
    });
    a.assets.supplied.forEach(function (asset) {
      out.push('<li><span class="tick">Supplied</span> ' + escapeHtml(asset.label) +
        '<div class="sub">For: ' + escapeHtml(asset.forComponents.join(', ')) + '</div></li>');
    });
    out.push('</ul></section>');
    return out.join('');
  }

  function renderSteps(a) {
    if (!a.executionSteps.length) {
      return '<section class="card"><h3>Execution steps</h3>' +
        '<p class="sub">Withheld — steps differ between AEM and Tridion, so the platform has to be known first.</p></section>';
    }
    var out = ['<section class="card"><h3>Execution steps — ' + escapeHtml(a.cms.label) + '</h3><ol class="steps">'];
    a.executionSteps.forEach(function (step) {
      out.push('<li>' + escapeHtml(step.instruction) + '<code>' + escapeHtml(step.action) + '</code></li>');
    });
    out.push('</ol></section>');
    return out.join('');
  }

  function renderQuestions(a) {
    var out = ['<section class="card"><h3>Questions to send back <button id="copy-questions" class="btn-ghost btn-small" type="button">Copy all</button></h3><ul class="plain">'];
    a.questions.forEach(function (q) {
      out.push('<li>' + escapeHtml(q.question));
      if (q.type === 'open') {
        out.push('<div class="answer-box" data-question="' + escapeHtml(q.question) + '">' +
          '<input type="text" placeholder="Answer here to re-score…" aria-label="Answer">' +
          '<button class="btn-primary btn-small" type="button">Re-score</button></div>');
      }
      out.push('</li>');
    });
    out.push('</ul><p class="sub">Answers are appended to the brief and re-scored through the same engine — ' +
      'there is no separate path for them.</p></section>');
    return out.join('');
  }

  // ─── REVIEW QUEUE ────────────────────────────────────────────────────────

  function refreshQueueCount() {
    el.queueCount.textContent = state.feedback.all().length;
  }

  function showQueue() {
    var proposals = state.feedback.queue();
    var log = state.feedback.all();
    var out = [];

    if (!log.length) {
      out.push('<p class="sub">Nothing logged yet. Override a work type when the engine gets one wrong and the ' +
        'correction is recorded here.</p>');
    } else {
      out.push('<p class="sub">' + log.length + ' correction(s) logged. Nothing below has been applied — the ' +
        'dictionaries only change when someone edits the JSON and commits it.</p>');
      proposals.forEach(function (p) {
        out.push('<div class="queue-item"><strong>' + escapeHtml(p.engineGuess || 'unclassified') + ' → ' +
          escapeHtml(p.actual) + '</strong> &times;' + p.count +
          '<div class="sub">' + escapeHtml(p.suggestion) + '</div></div>');
      });
      if (!proposals.length) {
        out.push('<p class="sub">Only non-classification corrections so far — no dictionary proposals yet.</p>');
      }
    }
    el.queueBody.innerHTML = out.join('');
    el.queueDialog.showModal();
  }

  // ─── UTIL ────────────────────────────────────────────────────────────────

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var toastTimer = null;
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.classList.remove('show'); }, 2200);
  }

  boot();
}());

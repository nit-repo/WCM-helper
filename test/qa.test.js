// test/qa.test.js — QA a built page on its own, no brief.
// Run: npm test
//
// Real fixtures first, where they carry the thing under test; synthetic pages
// for each check's break case and its clean case, because a QA check that
// cries wolf on a sound page is as useless as one that stays quiet.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var BriefQA = require('../qa.js');

function load(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }

var config = {
  'work-types': JSON.parse(load('../config/work-types.json')),
  'form-ids': JSON.parse(load('../config/form-ids.json'))
};
var qa = BriefQA.create(config);

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

function cat(result, id) { return result.categories.filter(function (c) { return c.id === id; })[0]; }
function notes(list) { return list.map(function (d) { return (d.field || '') + ' ' + d.note + ' ' + (d.found || ''); }).join('\n'); }

// A sound production page: one H1, a self-referencing hreflang set, matching
// robots and digitalData, the right form for Spain, descriptive links.
function page(opts) {
  opts = opts || {};
  var canonical = opts.canonical === undefined ? 'https://www.kone.es/contacto/' : opts.canonical;
  var head = [
    '<title>' + (opts.title === undefined ? 'Contacto | KONE España' : opts.title) + '</title>',
    canonical ? '<link rel="canonical" href="' + canonical + '">' : '',
    opts.robots ? '<meta name="robots" content="' + opts.robots + '">' : '',
    opts.keywords !== undefined ? '<meta name="keywords" content="' + opts.keywords + '">' : '',
    opts.tcm ? '<meta name="pagetcmid" content="' + opts.tcm + '">' : '',
    opts.hreflang !== undefined ? opts.hreflang
      : '<link rel="alternate" hreflang="es-ES" href="https://www.kone.es/contacto/">' +
        '<link rel="alternate" hreflang="x-default" href="https://www.kone.com/contact/">',
    opts.digitalData !== undefined ? opts.digitalData
      : '<script>var digitalData = { page: { pageInfo: { "FormAssemblyId": "758", ' +
        '"indexOptions": "INDEX", "followLinksOptions": "FOLLOW" } } };</script>',
    opts.head || ''
  ].join('');
  var main = opts.main !== undefined ? opts.main
    : '<h1>Contacte con nosotros</h1><p>Estamos aquí para ayudarle.</p>' +
      '<p><a href="https://www.kone.es/mantenimiento/">Servicios de mantenimiento</a></p>';
  return '<!DOCTYPE html><html lang="es"><head>' + head + '</head><body><main>' + main + '</main></body></html>';
}

// ─── Real material ────────────────────────────────────────────────────────

var SI = load('fixtures/kone-si-monospace-100dx.html');
var IT = load('fixtures/kone-it-healthcare-landing.html');

test('1. the real Slovenia preview page is read as a Tridion preview build', function () {
  var r = qa.run(SI);
  assert.strictEqual(r.facts.environment.id, 'tridion-preview');
});

test('2. noindex on a preview page is expected and stays silent', function () {
  var r = qa.run(SI);
  assert.strictEqual(r.facts.robots, 'noindex, nofollow');
  assert.ok(!/not to index/.test(notes(cat(r, 'metadata').deviations)), notes(cat(r, 'metadata').deviations));
});

test('3. the real Slovenia title "| KONE - KONE Slovenija" is a partial duplicate, logged as a known template issue', function () {
  var r = qa.run(SI);
  assert.ok(/partial duplicate/.test(notes(r.knownIssues)), notes(r.knownIssues));
  assert.ok(!/partial duplicate/.test(notes(cat(r, 'metadata').deviations)), 'never counted against the page');
});

test('4. the page\'s own canonical is not reported as an internal-host link', function () {
  var r = qa.run(SI);
  assert.ok(!/Internal hosts/.test(notes(cat(r, 'links').deviations)), notes(cat(r, 'links').deviations));
});

test('5. the real CME editor link on the Slovenia page is reported once, not twice', function () {
  var r = qa.run(SI);
  var hits = cat(r, 'links').deviations.filter(function (d) { return /tcm:151-146823/.test(d.found || ''); });
  assert.strictEqual(hits.length, 1, notes(hits));
});

test('6. the real Italian landing page is production, with exactly one visible H1', function () {
  var r = qa.run(IT);
  assert.strictEqual(r.facts.environment.id, 'production');
  assert.ok(!/H1/.test(notes(cat(r, 'metadata').deviations)), notes(cat(r, 'metadata').deviations));
});

test('7. a sound page reports nothing to fix in any category', function () {
  var r = qa.run(page());
  r.categories.forEach(function (c) {
    assert.strictEqual(c.deviations.length, 0, c.label + ': ' + notes(c.deviations));
  });
  assert.strictEqual(r.knownIssues.length, 0, notes(r.knownIssues));
  assert.strictEqual(r.breaks + r.checks, 0);
});

test('8. all five framework categories are always reported, in order', function () {
  var r = qa.run(page());
  assert.deepStrictEqual(r.categories.map(function (c) { return c.id; }),
    ['metadata', 'body', 'images', 'links', 'structure']);
});

test('9. body text with nothing checkable from the page alone says so rather than reading as a pass', function () {
  var b = cat(qa.run(page()), 'body');
  assert.strictEqual(b.deviations.length, 0);
  assert.ok(/nothing here was checked/.test(b.note || ''), b.note);
});

// ─── Page facts ───────────────────────────────────────────────────────────

test('10. the TCM ID is read and both CME links are built exactly to the real patterns', function () {
  var r = qa.run(page({ tcm: 'tcm:117-17589-64' }));
  assert.strictEqual(r.facts.tcmId, 'tcm:117-17589-64');
  assert.strictEqual(r.facts.cmeNewUi,
    'https://web-cms.kone.com/ui/editor/page?activeItem=tcm:117-17589-64&item=tcm:117-17589-64&tab=general.constraints');
  assert.strictEqual(r.facts.cmeOldUi, 'https://web-cms.kone.com/WebUI/item.aspx?tcm=64#id=tcm:117-17589-64');
});

test('11. no pagetcmid means no TCM ID and no CME links — never a guessed one', function () {
  var r = qa.run(page());
  assert.strictEqual(r.facts.tcmId, null);
  assert.strictEqual(r.facts.cmeNewUi, null);
  assert.strictEqual(r.facts.cmeOldUi, null);
});

test('12. a page with no canonical has an unknown environment, said so', function () {
  var r = qa.run(page({ canonical: '' }));
  assert.strictEqual(r.facts.environment.id, 'unknown');
  assert.ok(r.facts.environment.why);
});

test('13. the market is resolved and the metadata rows show what the page carries', function () {
  var r = qa.run(page());
  assert.strictEqual(r.facts.market, 'Spain');
  var rows = cat(r, 'metadata').rows;
  var indexing = rows.filter(function (x) { return x.field === 'Indexing'; })[0];
  assert.strictEqual(indexing.found, 'INDEX, FOLLOW');
});

// ─── Robots against digitalData ───────────────────────────────────────────

test('14. robots noindex against digitalData INDEX is a known template issue', function () {
  var r = qa.run(page({ robots: 'noindex, nofollow' }));
  assert.ok(/disagree about indexing/.test(notes(r.knownIssues)), notes(r.knownIssues));
});

test('15. the reverse — digitalData NOINDEX with no robots tag — is caught too', function () {
  var r = qa.run(page({ digitalData: '<script>var digitalData = { page: { pageInfo: { "FormAssemblyId": "758", ' +
    '"indexOptions": "NOINDEX", "followLinksOptions": "NOFOLLOW" } } };</script>' }));
  assert.ok(/disagree about indexing/.test(notes(r.knownIssues)), notes(r.knownIssues));
});

test('16. noindex on a production page is a check to confirm intent', function () {
  var r = qa.run(page({ robots: 'noindex' }));
  assert.ok(/not to index/.test(notes(cat(r, 'metadata').deviations)));
});

// ─── Titles ───────────────────────────────────────────────────────────────

test('17. a doubled site name is a double title', function () {
  var r = qa.run(page({ title: 'Ascensores | KONE India - KONE India' }));
  assert.ok(/double title/.test(notes(r.knownIssues)), notes(r.knownIssues));
});

test('18. the brand inside the page\'s own subject is not a duplicate', function () {
  var r = qa.run(page({ title: 'KONE MonoSpace DX | KONE España' }));
  assert.strictEqual(r.knownIssues.length, 0, notes(r.knownIssues));
});

test('19. a missing title is a break, not a template issue', function () {
  var r = qa.run(page({ title: '' }));
  assert.ok(/no <title>/.test(notes(cat(r, 'metadata').deviations)));
});

// ─── Leakage and mixed content ────────────────────────────────────────────

test('20. a production page linking to a preview host is a break', function () {
  var r = qa.run(page({ main: '<h1>X</h1><p><a href="https://preview.kone.es/x/">Ver producto</a></p>' }));
  assert.ok(/internal or staging host/.test(notes(cat(r, 'links').deviations)));
});

test('21. a preview image on a production page lands under Images', function () {
  var r = qa.run(page({ main: '<h1>X</h1><img src="https://preview.kone.es/img/a.jpg" alt="a">' }));
  assert.ok(/internal or staging host/.test(notes(cat(r, 'images').deviations)));
});

test('22. an http script on an https page is a break, an http image a check', function () {
  var r = qa.run(page({ main: '<h1>X</h1><img src="http://cdn.kone.com/a.jpg" alt="a">',
    head: '<script src="http://cdn.kone.com/a.js"></script>' }));
  var s = cat(r, 'structure').deviations.filter(function (d) { return d.field === 'Mixed content'; })[0];
  var i = cat(r, 'images').deviations.filter(function (d) { return d.field === 'Mixed content'; })[0];
  assert.strictEqual(s.severity, 'break');
  assert.strictEqual(i.severity, 'check');
});

test('23. an http link out is navigation, not mixed content', function () {
  var r = qa.run(page({ main: '<h1>X</h1><p><a href="http://example.org/">Example organisation</a></p>' }));
  assert.ok(!/Mixed content/.test(notes(cat(r, 'links').deviations)));
});

// ─── hreflang ─────────────────────────────────────────────────────────────

test('24. no hreflang at all is a check, not a break', function () {
  var d = cat(qa.run(page({ hreflang: '' })), 'metadata').deviations.filter(function (x) { return x.field === 'hreflang'; });
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].severity, 'check');
});

test('25. an invalid hreflang code and a repeated one are both breaks', function () {
  var r = qa.run(page({ hreflang:
    '<link rel="alternate" hreflang="es-ES" href="https://www.kone.es/contacto/">' +
    '<link rel="alternate" hreflang="spanish" href="https://www.kone.es/contacto/">' +
    '<link rel="alternate" hreflang="es-ES" href="https://www.kone.es/otro/">' }));
  var d = notes(cat(r, 'metadata').deviations);
  assert.ok(/not a valid hreflang/.test(d), d);
  assert.ok(/declared more than once/.test(d), d);
});

test('26. a set of alternates that never points back at this page is a check', function () {
  var r = qa.run(page({ hreflang: '<link rel="alternate" hreflang="pt-PT" href="https://www.kone.pt/contacto/">' }));
  assert.ok(/points back at this page/.test(notes(cat(r, 'metadata').deviations)));
});

// ─── Canonical, keywords, H1, link text ───────────────────────────────────

test('27. an .aspx canonical is a known template issue', function () {
  var r = qa.run(page({ canonical: 'https://www.kone.es/contacto.aspx',
    hreflang: '<link rel="alternate" hreflang="es-ES" href="https://www.kone.es/contacto.aspx">' }));
  assert.ok(/\.aspx/.test(notes(r.knownIssues)));
});

test('28. an empty keywords tag is a known issue; no keywords tag at all is not', function () {
  assert.ok(/keywords tag is present but empty/.test(notes(qa.run(page({ keywords: '' })).knownIssues)));
  assert.strictEqual(qa.run(page()).knownIssues.length, 0);
});

test('29. two visible H1s are a break; a hidden one is not counted', function () {
  var two = qa.run(page({ main: '<h1>A</h1><h1>B</h1>' }));
  assert.ok(/2 visible H1/.test(notes(cat(two, 'metadata').deviations)));
  var hidden = qa.run(page({ main: '<h1>A</h1><h1 style="display:none">B</h1>' }));
  assert.ok(!/H1/.test(notes(cat(hidden, 'metadata').deviations)));
});

test('30. an H1 outside the main region still counts', function () {
  var html = page({ main: '<p>Copy only.</p>' }).replace('<main>', '<div class="hero"><h1>Hero heading</h1></div><main>');
  assert.ok(!/H1/.test(notes(cat(qa.run(html), 'metadata').deviations)));
});

test('31. "Leer más" as link text is a check, in Spanish as in English', function () {
  var r = qa.run(page({ main: '<h1>X</h1><p><a href="/mantenimiento/">Leer más →</a></p>' }));
  assert.ok(/says nothing about where it goes/.test(notes(cat(r, 'links').deviations)));
});

test('32. an icon link with no text, label or alt is a break; one with an alt is fine', function () {
  var bad = qa.run(page({ main: '<h1>X</h1><a href="/x/"><img src="/i.svg"></a>' }));
  assert.ok(/no text, label or image alt/.test(notes(cat(bad, 'links').deviations)));
  var ok = qa.run(page({ main: '<h1>X</h1><a href="/x/"><img src="/i.svg" alt="Download the brochure"></a>' }));
  assert.ok(!/no text, label/.test(notes(cat(ok, 'links').deviations)));
});

// ─── Form Assembly ID and the tally ───────────────────────────────────────

test('33. the wrong country\'s form is a Structure break, with its row always shown', function () {
  var r = qa.run(page({ digitalData: '<script>var digitalData = { page: { pageInfo: { "FormAssemblyId": "924", ' +
    '"indexOptions": "INDEX", "followLinksOptions": "FOLLOW" } } };</script>' }));
  var s = cat(r, 'structure');
  assert.ok(/924/.test(notes(s.deviations)));
  assert.strictEqual(s.rows[0].state, 'differs');
});

test('34. known template issues never count toward the page\'s tally', function () {
  var r = qa.run(page({ keywords: '', title: 'X | KONE India - KONE India' }));
  assert.strictEqual(r.knownIssues.length, 2);
  assert.strictEqual(r.breaks + r.checks, 0);
});

test('35. the in-code QA defaults mirror config/work-types.json, so a missing config changes nothing', function () {
  assert.deepStrictEqual(config['work-types'].qa.internalHosts, BriefQA.DEFAULT_QA.internalHosts);
  assert.deepStrictEqual(config['work-types'].qa.genericLinkText, BriefQA.DEFAULT_QA.genericLinkText);
  assert.deepStrictEqual(config['work-types'].qa.cme, BriefQA.DEFAULT_QA.cme);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

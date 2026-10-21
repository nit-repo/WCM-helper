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
  'sites': JSON.parse(load('../config/sites.json'))
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

// ─── Title format: "Page Name | KONE Corporation" or "| KONE <country>" ───

function formatRow(r, source) {
  return cat(r, 'metadata').rows.filter(function (x) {
    return x.field === 'Title format' && x.source === (source || 'page title');
  })[0];
}
function titleFindingsOf(r) {
  return cat(r, 'metadata').deviations.filter(function (d) { return d.field === 'Title format'; });
}

test('36. "| KONE Corporation" is green, and nothing to fix', function () {
  var r = qa.run(page({ title: 'Contacto | KONE Corporation' }));
  assert.strictEqual(formatRow(r).state, 'green');
  assert.strictEqual(titleFindingsOf(r).length, 0);
});

test('37. the page\'s own market, in its confirmed spelling, is green — the real kone.es "KONE España"', function () {
  var r = qa.run(page({ title: 'Contacto | KONE España' }));
  assert.strictEqual(formatRow(r).state, 'green', formatRow(r).stateLabel);
});

test('38. another market\'s confirmed name is red and a break — "KONE India" on a kone.es page', function () {
  var r = qa.run(page({ title: 'Contacto | KONE India' }));
  assert.strictEqual(formatRow(r).state, 'red');
  assert.ok(/India site's name, on a Spain page/.test(formatRow(r).stateLabel), formatRow(r).stateLabel);
  assert.strictEqual(titleFindingsOf(r)[0].severity, 'break');
});

test('39. "| KONE" with no country is amber and a check', function () {
  var r = qa.run(page({ title: 'Contacto | KONE' }));
  assert.strictEqual(formatRow(r).state, 'amber');
  assert.ok(/no country/.test(formatRow(r).stateLabel));
  assert.strictEqual(titleFindingsOf(r)[0].severity, 'check');
});

test('40. a bare page name with no site name is amber', function () {
  var r = qa.run(page({ title: 'Contacto' }));
  assert.strictEqual(formatRow(r).state, 'amber');
  assert.ok(/no site name/.test(formatRow(r).stateLabel));
});

test('41. a drafted, unconfirmed spelling is amber, never red', function () {
  var r = qa.run(page({ title: 'Contatti | KONE Italia', canonical: 'https://www.kone.it/contatti/',
    hreflang: '<link rel="alternate" hreflang="it-IT" href="https://www.kone.it/contatti/">' }));
  assert.strictEqual(formatRow(r).state, 'amber');
  assert.ok(/draft spelling for Italy/.test(formatRow(r).stateLabel), formatRow(r).stateLabel);
});

test('42. with no market to check against, a country name is amber, not verified', function () {
  var r = qa.run(page({ title: 'Contact | KONE España', canonical: 'https://www.example.com/contact/', hreflang: '' }));
  assert.strictEqual(formatRow(r).state, 'amber');
  assert.ok(/not verified/.test(formatRow(r).stateLabel));
});

test('43. " - KONE <country>" is green like " | " — and a long dash is amber', function () {
  var r = qa.run(page({ title: 'Contacto - KONE España' }));
  assert.strictEqual(formatRow(r).state, 'green', formatRow(r).stateLabel);
  assert.strictEqual(titleFindingsOf(r).length, 0);
  var dash = qa.run(page({ title: 'Contacto \u2013 KONE España' }));
  assert.strictEqual(formatRow(dash).state, 'amber');
  assert.ok(/long dash/.test(formatRow(dash).stateLabel), formatRow(dash).stateLabel);
});

test('44. no title at all is a red row', function () {
  var r = qa.run(page({ title: '' }));
  assert.strictEqual(formatRow(r).state, 'red');
});

test('45. a doubled site name is red, and only a known issue — not a second finding', function () {
  var r = qa.run(page({ title: 'Contacto | KONE España - KONE España' }));
  assert.strictEqual(formatRow(r).state, 'red');
  assert.strictEqual(titleFindingsOf(r).length, 0);
  assert.ok(/double title/.test(notes(r.knownIssues)));
});

test('46. og:title is scored on its own when it says something different', function () {
  var r = qa.run(page({ title: 'Contacto | KONE España', head: '<meta property="og:title" content="Contacto | KONE">' }));
  assert.strictEqual(formatRow(r).state, 'green');
  assert.strictEqual(formatRow(r, 'og:title').state, 'amber');
});

test('47. the real Slovenia preview page resolves to its market through the preview host', function () {
  var r = qa.run(SI);
  assert.strictEqual(r.facts.market, 'Slovenia');
  assert.strictEqual(formatRow(r).state, 'red', 'its title doubles the site name');
  assert.strictEqual(formatRow(r, 'og:title').state, 'amber', 'its og:title ends in a bare "| KONE"');
});

test('48. a brief\'s Market row decides the market over the page\'s domain', function () {
  var r = qa.run(page({ title: 'Contact | KONE España', canonical: 'https://www.example.com/contact/', hreflang: '' }),
    { brief: 'Market: Spain\nMeta Title: Contact | KONE España\n', workTypeId: 'new-page' });
  assert.strictEqual(r.facts.market, 'Spain');
  assert.strictEqual(formatRow(r).state, 'green');
});

// ─── QA with a brief: one report ──────────────────────────────────────────

var SI_BRIEF = require('../compare.js').create(config).briefFrom(SI).text;

test('49. a page against the brief generated from it lands with complete coverage — the round trip, inside QA', function () {
  var r = qa.run(SI, { brief: SI_BRIEF, workTypeId: 'new-page' });
  assert.ok(r.comparison.supported && !r.comparison.unreadable);
  assert.strictEqual(r.comparison.coverage.complete, true, JSON.stringify(r.comparison.coverage));
});

test('50. with a brief, the brief\'s findings land in the same five categories, labelled as the brief\'s', function () {
  var brief = SI_BRIEF + '\nA paragraph the brief asks for that this page has never carried, long enough to count.';
  var r = qa.run(SI, { brief: brief, workTypeId: 'new-page' });
  assert.deepStrictEqual(r.categories.map(function (c) { return c.id; }), ['metadata', 'body', 'images', 'links', 'structure']);
  var fromBrief = cat(r, 'body').deviations.filter(function (d) { return d.fromBrief; });
  assert.ok(fromBrief.length >= 1, notes(cat(r, 'body').deviations));
  assert.strictEqual(r.comparison.coverage.complete, false);
  assert.ok(cat(r, 'body').ledger, 'the row-by-row ledger comes across too');
});

test('51. merging never reports a page-only finding twice', function () {
  var r = qa.run(SI, { brief: SI_BRIEF, workTypeId: 'new-page' });
  var cme = cat(r, 'links').deviations.filter(function (d) { return /tcm:151-146823/.test(d.found || ''); });
  assert.strictEqual(cme.length, 1, notes(cme));
  var h1 = cat(r, 'metadata').deviations.filter(function (d) { return d.field === 'H1'; });
  assert.ok(h1.length <= 1);
  var formRows = cat(r, 'structure').rows.filter(function (x) { return x.field === 'Form Assembly ID'; });
  assert.strictEqual(formRows.length, 1);
  assert.ok(!r.categories.some(function (c) { return c.id === 'formId'; }), 'Compare\'s own Form ID category is folded in, not repeated');
});

test('52. with a brief, Compare\'s brief-aware rows lead the Metadata table, QA\'s own rows follow', function () {
  var rows = cat(qa.run(SI, { brief: SI_BRIEF, workTypeId: 'new-page' }), 'metadata').rows;
  assert.strictEqual(rows[0].basis, 'brief');
  assert.ok(rows.some(function (x) { return x.field === 'Robots'; }));
  assert.ok(rows.some(function (x) { return x.field === 'Title format'; }));
});

test('53. an unreadable brief says so, and QA still runs on the page alone', function () {
  var r = qa.run(page(), { brief: '???', workTypeId: 'new-page' });
  assert.strictEqual(r.comparison.unreadable, true);
  assert.ok(/nothing here was checked/.test(cat(r, 'body').note || ''));
});

test('54. a brief for a job with no page to read says so, and QA still runs on the page', function () {
  var r = qa.run(page(), { brief: 'https://www.kone.es/a\thttps://www.kone.es/b', workTypeId: 'redirect' });
  assert.strictEqual(r.comparison.supported, false);
  assert.strictEqual(r.categories.length, 5);
});

test('55. without a brief there is no comparison at all', function () {
  assert.strictEqual(qa.run(page()).comparison, null);
});

// ─── The site registry ────────────────────────────────────────────────────

test('56. config/sites.json and the in-code mirror are the same table', function () {
  assert.deepStrictEqual(config.sites.countries, require('../compare.js').DEFAULT_SITES.countries);
});

test('57. every market carries confirmed and draft site names, and no name is both', function () {
  Object.keys(config.sites.countries).forEach(function (name) {
    var c = config.sites.countries[name];
    assert.ok(Array.isArray(c.siteNames) && Array.isArray(c.siteNamesDraft), name);
    c.siteNames.forEach(function (n) { assert.ok(c.siteNamesDraft.indexOf(n) === -1, name + ': ' + n); });
  });
});

// ─── LIVE FETCH, LINK STATUSES, CRAWL ROWS ─────────────────────────────────
// The backend's fetch result is data to these checks, nothing more — so
// they are tested with plain objects, no network.

var LIVE_PAGE = '<!DOCTYPE html><html lang="es"><head><title>Contacto | KONE España</title>' +
  '<link rel="canonical" href="https://www.kone.es/contacto/"></head><body><main><h1>Contacto</h1>' +
  '<a href="/productos/">Ver productos</a> <a href="https://www.youtube.com/kone">YouTube</a> ' +
  '<a href="mailto:x@kone.com">Correo</a> <a href="#top">Arriba</a> <a href="/productos/#a">Productos</a></main></body></html>';
function live(extra) {
  return Object.assign({ url: 'https://www.kone.es/contacto/', finalUrl: 'https://www.kone.es/contacto/', status: 200,
    verdict: 'ok', redirects: [], tls: { valid: true, validTo: '2027-06-01T00:00:00.000Z', daysLeft: 240, issuer: 'DigiCert Inc', error: null },
    ms: 420, bytes: 9000 }, extra || {});
}
function fieldsOf(r) {
  var out = [];
  r.categories.forEach(function (c) { c.deviations.forEach(function (d) { out.push(c.id + ':' + d.severity + ':' + d.field); }); });
  return out;
}

test('58. live: a sound fetch adds its facts and no findings of its own', function () {
  var r = qa.run(LIVE_PAGE, { live: live() });
  assert.strictEqual(r.facts.live.status, 200);
  assert.strictEqual(r.facts.live.tls.issuer, 'DigiCert Inc');
  ['Certificate', 'HTTPS', 'Redirect chain', 'Canonical'].forEach(function (f) {
    assert.ok(!fieldsOf(r).some(function (x) { return x.split(':')[2] === f; }), f + ' should be silent');
  });
});

test('59. live: an invalid certificate breaks; one expiring within 30 days is a check', function () {
  var bad = qa.run(LIVE_PAGE, { live: live({ tls: { valid: false, error: 'CERT_HAS_EXPIRED', daysLeft: -3 } }) });
  assert.ok(fieldsOf(bad).indexOf('structure:break:Certificate') !== -1, fieldsOf(bad).join(', '));
  var soon = qa.run(LIVE_PAGE, { live: live({ tls: { valid: true, validTo: '2026-10-20T00:00:00Z', daysLeft: 12, error: null } }) });
  assert.ok(fieldsOf(soon).indexOf('structure:check:Certificate') !== -1);
});

test('60. live: plain http breaks; two redirects is a check; one is fine', function () {
  var http = qa.run(LIVE_PAGE, { live: live({ finalUrl: 'http://www.kone.es/contacto/', tls: null }) });
  assert.ok(fieldsOf(http).indexOf('structure:break:HTTPS') !== -1);
  var two = qa.run(LIVE_PAGE, { live: live({ redirects: [{}, {}] }) });
  assert.ok(fieldsOf(two).indexOf('links:check:Redirect chain') !== -1);
  var one = qa.run(LIVE_PAGE, { live: live({ redirects: [{}] }) });
  assert.ok(fieldsOf(one).indexOf('links:check:Redirect chain') === -1);
});

test('61. live: served at one URL, canonical naming another, is a check — but not on a preview build', function () {
  var other = qa.run(LIVE_PAGE, { live: live({ finalUrl: 'https://www.kone.es/contact-us/' }) });
  assert.ok(fieldsOf(other).indexOf('metadata:check:Canonical') !== -1);
  var www = qa.run(LIVE_PAGE, { live: live({ finalUrl: 'https://kone.es/contacto' }) });
  assert.ok(fieldsOf(www).indexOf('metadata:check:Canonical') === -1, 'www and a trailing slash are the same page');
  var preview = qa.run(LIVE_PAGE, { live: live({ finalUrl: 'https://preview.kone.es/contacto/' }) });
  assert.ok(fieldsOf(preview).indexOf('metadata:check:Canonical') === -1);
});

test('62. live: a page with no canonical is placed in its market by the URL it was served at', function () {
  var r = qa.run(LIVE_PAGE.replace(/<link rel="canonical"[^>]*>/, ''), { live: live() });
  assert.strictEqual(r.facts.market, 'Spain');
  assert.strictEqual(r.facts.environment.id, 'production');
  assert.ok(/served from/.test(r.facts.environment.why));
});

test('63. linksToCheck: absolute, resolved, deduped; no mailto, no fragments', function () {
  assert.deepStrictEqual(BriefQA.linksToCheck(LIVE_PAGE, 'https://www.kone.es/contacto/'),
    ['https://www.kone.es/productos/', 'https://www.youtube.com/kone']);
});

test('64. link statuses: broken breaks, unverified checks, each labelled KONE or external', function () {
  var r = qa.run(LIVE_PAGE, { links: [
    { url: 'https://www.kone.es/productos/', verdict: 'dead', status: 404, reason: 'answered 404' },
    { url: 'https://www.youtube.com/kone', verdict: 'unverified', status: 429, reason: 'rate-limited (429)' },
    { url: 'https://www.kone.es/ok/', verdict: 'ok', status: 200 }
  ] });
  var f = fieldsOf(r);
  assert.ok(f.indexOf('links:break:Broken link (KONE)') !== -1, f.join(', '));
  assert.ok(f.indexOf('links:check:Link not verified (external)') !== -1);
  assert.deepStrictEqual(r.facts.linkCheck, { checked: 3, ok: 1, dead: 1, unverified: 1 });
});

test('65. crawlRow: one scannable line per page', function () {
  var r = qa.run(LIVE_PAGE, { live: live() });
  var row = qa.crawlRow(r, live());
  assert.strictEqual(row.url, 'https://www.kone.es/contacto/');
  assert.strictEqual(row.status, 200);
  assert.strictEqual(row.title, 'Contacto | KONE España');
  assert.strictEqual(row.titleFormat, 'green');
  assert.strictEqual(row.formId, 'no-form', 'LIVE_PAGE carries no form at all');
  assert.strictEqual(row.market, 'Spain');
  assert.strictEqual(row.breaks, r.breaks);
});

test('66. regions: every market sits in exactly one frontline, every frontline in one area', function () {
  var regions = config.sites.regions;
  var markets = Object.keys(config.sites.countries);
  var placed = {};
  Object.keys(regions.frontlines).forEach(function (fl) {
    regions.frontlines[fl].forEach(function (m) {
      assert.ok(markets.indexOf(m) !== -1, m + ' is not a market');
      assert.ok(!placed[m], m + ' is in two frontlines');
      placed[m] = fl;
    });
  });
  markets.forEach(function (m) { assert.ok(placed[m], m + ' is in no frontline'); });
  var inArea = {};
  Object.keys(regions.areas).forEach(function (a) {
    regions.areas[a].forEach(function (fl) {
      assert.ok(regions.frontlines[fl], fl + ' is not a frontline');
      assert.ok(!inArea[fl], fl + ' is in two areas');
      inArea[fl] = a;
    });
  });
  Object.keys(regions.frontlines).forEach(function (fl) { assert.ok(inArea[fl], fl + ' is in no area'); });
});

test('67. withLinkStatuses: a crawl\'s link statuses fold into a page\'s report and its tally', function () {
  var r = qa.run(LIVE_PAGE, { live: live() });
  var statuses = [{ url: 'https://www.kone.es/productos/', verdict: 'dead', status: 404, reason: 'answered 404' }];
  var folded = qa.withLinkStatuses(r, statuses);
  assert.strictEqual(folded.breaks, r.breaks + 1);
  assert.ok(fieldsOf(folded).indexOf('links:break:Broken link (KONE)') !== -1);
  assert.strictEqual(fieldsOf(r).indexOf('links:break:Broken link (KONE)'), -1, 'the original report is untouched');
  var direct = qa.run(LIVE_PAGE, { live: live(), links: statuses });
  assert.strictEqual(folded.breaks, direct.breaks, 'the same as checking the links up front');
  assert.strictEqual(folded.checks, direct.checks);
});

// ─── THE SUMMARY: sitemap-aware links and proofreading ─────────────────────
var BH = load('fixtures/kone-bh-builders.html');
var BH_SITEMAP = load('fixtures/kone-bh-sitemap.txt');
var qaFull = BriefQA.create({ 'work-types': config['work-types'], sites: config.sites,
  'link-rulings': JSON.parse(load('../config/link-rulings.json')), proofreading: JSON.parse(load('../config/proofreading.json')) });

test('68. the Summary is additive: the tally is the same with and without a sitemap', function () {
  var without = qaFull.run(BH), withMap = qaFull.run(BH, { sitemap: { text: BH_SITEMAP, source: 'pasted' } });
  assert.strictEqual(withMap.breaks, without.breaks);
  assert.strictEqual(withMap.checks, without.checks);
  assert.strictEqual(without.audit.sitemap, null);
  assert.deepStrictEqual(withMap.audit.sitemap, { count: 204, source: 'pasted', host: 'kone.bh', prefix: 'en' });
});

test('69. the real Bahrain page\'s Summary: links, spelling, lists and metadata', function () {
  var a = qaFull.run(BH, { sitemap: { text: BH_SITEMAP, source: 'pasted' } }).audit;
  assert.deepStrictEqual(a.counts, { spelling: { red: 2, amber: 0 }, links: { red: 1, amber: 3 },
    lists: { red: 0, amber: 6 }, metadata: { red: 0, amber: 7 } });
  assert.ok(a.english);
});

test('70. without a sitemap, links are judged only where no sitemap is needed', function () {
  var a = qaFull.run(BH).audit;
  assert.deepStrictEqual(a.counts.links, { red: 0, amber: 0 });
});

test('71. a dead CTA in the Hyperlinks card gains the suggested page', function () {
  var html = BH.replace('<a href="/en/new-buildings/elevators/builders/kone-jumplift.aspx">Learn more about KONE JumpLift</a>', 'Learn more about KONE JumpLift');
  var r = qaFull.run(html, { sitemap: { text: BH_SITEMAP, source: 'pasted' } });
  var dead = cat(r, 'links').deviations.filter(function (d) { return d.found === 'Learn more about KONE JumpLift'; })[0];
  assert.ok(dead, 'the dead CTA is reported');
  assert.strictEqual(dead.suggest, 'https://www.kone.bh/en/new-buildings/elevators/builders/kone-jumplift.aspx');
  var plain = qaFull.run(html);
  assert.strictEqual(cat(plain, 'links').deviations.filter(function (d) { return d.found === 'Learn more about KONE JumpLift'; })[0].suggest, undefined);
});

test('72. the CTA module with its link inside is no longer reported as bare text', function () {
  var r = qaFull.run(BH);
  assert.ok(!cat(r, 'links').deviations.some(function (d) { return /Get in touch early/.test(d.found || ''); }));
});

// ─── The model title: the real kone.in "… - KONE India" ─────────────────────

var IN = load('fixtures/kone-in-one-week-modernization.html');

test('73. the real kone.in title "Introducing One Week Modernization - KONE India" scores green, with nothing to fix', function () {
  var r = qa.run(IN);
  assert.strictEqual(r.facts.market, 'India');
  assert.strictEqual(formatRow(r).state, 'green', formatRow(r).stateLabel);
  assert.ok(/confirmed name for India/.test(formatRow(r).stateLabel));
  assert.strictEqual(titleFindingsOf(r).length, 0, notes(titleFindingsOf(r)));
});

test('74. a share title that is the page name alone is fine — the page title carries the site name', function () {
  var r = qa.run(IN);
  assert.strictEqual(formatRow(r, 'og:title').state, 'green', formatRow(r, 'og:title').stateLabel);
  var bare = qa.run(page({ title: 'Contacto' }));
  assert.strictEqual(formatRow(bare).state, 'amber', 'the page title itself still needs the site name');
});

test('75. two site names — "X - KONE Corporation - KONE Bahrain" — are amber, keep the last', function () {
  var r = qa.run(BH);
  assert.strictEqual(formatRow(r).state, 'amber');
  assert.ok(/two site names/.test(formatRow(r).stateLabel) && /KONE Corporation/.test(formatRow(r).stateLabel), formatRow(r).stateLabel);
  var product = qa.run(page({ title: 'Ascensores | KONE MonoSpace - KONE España' }));
  assert.strictEqual(formatRow(product).state, 'green', 'a product name before the site name is not a second site name');
});

// ─── Where a broken link sits ──────────────────────────────────────────────

test('76. every link is placed: component, block and the block\'s title — the real kone.bh page', function () {
  var places = qa.run(BH).linkPlaces;
  var at = function (u) { return (places['https://preview.kone.bh' + u] || []).map(function (p) { return p.where; }); };
  assert.deepStrictEqual(at('/en/new-buildings/elevators/'), [
    'Content blocks #3 › block 1 — "Quiet comfort for everyday living"',
    'Content blocks #3 › block 4 — "Built for heavy loads and tough conditions"']);
  assert.deepStrictEqual(at('/en/studio/'), ['Content blocks #1 › block 1 — "KONE Studio"']);
  assert.deepStrictEqual(at('/en/'), ['Breadcrumbs']);
});

test('77. a broken link\'s finding says where it is, every place it appears, instead of only its address', function () {
  var url = 'https://preview.kone.bh/en/new-buildings/elevators/';
  var r = qa.withLinkStatuses(qa.run(BH), [{ url: url, verdict: 'dead', status: 500 }]);
  var d = cat(r, 'links').deviations.filter(function (x) { return x.field === 'Broken link (KONE)'; })[0];
  assert.strictEqual(d.found, url);
  assert.strictEqual(d.where, 'Content blocks #3 › block 1 — "Quiet comfort for everyday living"  ·  Content blocks #3 › block 4 — "Built for heavy loads and tough conditions"');
  assert.ok(/^#item-\d+$/.test(d.anchor), d.anchor);
  var live = qa.run(BH, { links: [{ url: url, verdict: 'dead', status: 500 }] });
  assert.strictEqual(cat(live, 'links').deviations.filter(function (x) { return x.field === 'Broken link (KONE)'; })[0].where, d.where);
});

test('78. outside any component a link is placed in the header, navigation or footer — the real Slovenia page', function () {
  var places = qa.run(SI).linkPlaces;
  var where = function (re) { var k = Object.keys(places).filter(function (u) { return re.test(u); })[0]; return places[k][0].where; };
  assert.strictEqual(where(/legal-notice/), 'Footer');
  assert.strictEqual(where(/\/existing-buildings\/$/), 'Header', 'its menu is a <nav> inside the header');
  assert.strictEqual(where(/studio\/tool/), 'Content river #1 › item 1 — "Nacrtujete novo dvigalo?"');
  assert.ok(!JSON.stringify(places).includes('&reg;'), 'titles are decoded');
});

test('79. a link in a hidden component says so — the kone.eg header case (synthetic shape: the page was not supplied)', function () {
  var link = 'https://www.kone.eg/en/new-buildings/advanced-people-flow-solutions/kone-e-link/';
  var html = page({ canonical: 'https://www.kone.eg/en/new-buildings/', title: 'New buildings - KONE Egypt',
    main: '<header class="site-header" style="display:none"><nav><a href="' + link + '">KONE E-Link</a></nav></header>' +
      '<h1>New buildings</h1><div hidden><a href="/en/contact/">Contact</a></div>' });
  var r = qa.withLinkStatuses(qa.run(html), [{ url: link, verdict: 'dead', status: 500 }]);
  var d = cat(r, 'links').deviations.filter(function (x) { return /Broken link/.test(x.field); })[0];
  assert.strictEqual(d.where, 'Header (hidden)');
  assert.strictEqual(d.severity, 'break', 'still flagged — hidden is a fact about where it is, not an excuse');
  assert.strictEqual(r.linkPlaces['https://www.kone.eg/en/contact/'][0].where, 'Page body — "New buildings" (hidden)');
});

test('80. redirects: more than 3 is a fix with the chain spelled out; 2–3 a check; 1 nothing', function () {
  function hops(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push({ url: 'https://kone.es/r' + i, status: i % 2 ? 302 : 301, to: 'x', ms: 50 });
    return out;
  }
  var four = qa.run(LIVE_PAGE, { live: live({ redirects: hops(4), redirectMs: 200 }) });
  assert.ok(fieldsOf(four).indexOf('links:break:Redirect chain') !== -1, fieldsOf(four).join(', '));
  var d = cat(four, 'links').deviations.filter(function (x) { return x.field === 'Redirect chain'; })[0];
  assert.strictEqual(d.found, 'https://kone.es/r0 (301) → https://kone.es/r1 (302) → https://kone.es/r2 (301) → ' +
    'https://kone.es/r3 (302) → https://www.kone.es/contacto/');
  assert.ok(/4 redirects — more than 3/.test(d.note), d.note);
  var three = qa.run(LIVE_PAGE, { live: live({ redirects: hops(3) }) });
  assert.ok(fieldsOf(three).indexOf('links:check:Redirect chain') !== -1);
  assert.ok(fieldsOf(three).indexOf('links:break:Redirect chain') === -1);
  assert.ok(fieldsOf(qa.run(LIVE_PAGE, { live: live({ redirects: hops(1) }) })).every(function (f) { return !/Redirect chain/.test(f); }));
});

test('81. a final page that answers anything but 200 is a fix', function () {
  var r = qa.run(LIVE_PAGE, { live: live({ status: 203 }) });
  assert.ok(fieldsOf(r).indexOf('structure:break:Final status') !== -1);
  assert.ok(fieldsOf(qa.run(LIVE_PAGE, { live: live() })).indexOf('structure:break:Final status') === -1);
});

test('82. load time over 3 s and TTFB over 0.8 s are checks, said to be the backend\'s HTML timings', function () {
  var slow = qa.run(LIVE_PAGE, { live: live({ ms: 3500, ttfbMs: 900, redirectMs: 400, runs: 3 }) });
  var f = fieldsOf(slow);
  assert.ok(f.indexOf('structure:check:Load time') !== -1, f.join(', '));
  assert.ok(f.indexOf('structure:check:Server response (TTFB)') !== -1);
  var d = cat(slow, 'structure').deviations.filter(function (x) { return x.field === 'Load time'; })[0];
  assert.ok(/3\.5 s \(average of 3 fetches\), 0\.40 s of it redirects/.test(d.note) && /HTML only/.test(d.note), d.note);
  var fast = fieldsOf(qa.run(LIVE_PAGE, { live: live({ ms: 2900, ttfbMs: 790 }) }));
  assert.ok(fast.indexOf('structure:check:Load time') === -1 && fast.indexOf('structure:check:Server response (TTFB)') === -1);
  assert.strictEqual(slow.facts.live.ttfbMs, 900);
  assert.strictEqual(slow.facts.live.runs, 3);
});

test('83. crawlRow carries redirects and timings for the table and the CSV', function () {
  var lv = live({ redirects: [{ url: 'https://kone.es/contacto', status: 301, to: 'https://www.kone.es/contacto/', ms: 80 }],
    redirectMs: 80, ttfbMs: 300, ms: 900, bytes: 9000 });
  var row = qa.crawlRow(qa.run(LIVE_PAGE, { live: lv }), lv);
  assert.strictEqual(row.redirects, 1);
  assert.strictEqual(row.redirectChain, 'https://kone.es/contacto (301) → https://www.kone.es/contacto/');
  assert.deepStrictEqual([row.redirectMs, row.ttfbMs, row.loadMs, row.bytes], [80, 300, 900, 9000]);
});

// ─── FormAssembly forms ───────────────────────────────────────────────────
// The real kone.ae AEM page carries its form as AEM's integration component:
// data-target-id="1491" and <script src="https://kone.tfaforms.net/publish/1491">,
// no form markup and no digitalData. The rendered-markup shapes below are
// synthetic — built from the team's three-line 752 example — because no page
// with FormAssembly's markup served in its HTML has been supplied.

var KONE_AE = load('fixtures/kone-ae-elevator-modernization.html');
var TFA_752 = '<div class="wFormContainer"><div class="wForm" id="752-WRPR" data-language="en_GB">' +
  '<h3 class="wFormTitle" id="752-T">Contact us &amp; get a quote</h3>' +
  '<form method="post" action="https://kone.tfaforms.net/api_v2/rest/workflow/processor" class="hintsBelow labelsAbove" id="752">' +
  '<input type="text" id="tfa_1" name="tfa_1">' +
  '<div id="g-recaptcha-render-div"></div>' +
  '<input type="submit" id="submit_button" class="primaryAction" value="Submit">' +
  '<input type="hidden" value="752" name="tfa_dbFormId" id="tfa_dbFormId">' +
  '<input type="hidden" value="" name="tfa_dbResponseId" id="tfa_dbResponseId">' +
  '<input type="hidden" value="9f3a" name="tfa_dbControl" id="tfa_dbControl">' +
  '<input type="hidden" value="27" name="tfa_dbVersionId" id="tfa_dbVersionId">' +
  '</form></div></div><script src="https://kone.tfaforms.net/js/localization-en_GB.js"></script>';
function aePage(body, extra) {
  return '<!DOCTYPE html><html lang="en"><head><title>Contact us | KONE</title>' +
    '<link rel="canonical" href="https://www.kone.ae/about-kone/contact.html">' + (extra || '') + '</head>' +
    '<body><main><h1>Contact us</h1><h3>Find the right solution for you</h3>' + body + '</main></body></html>';
}
function formRow(r) { return cat(r, 'structure').rows.filter(function (x) { return x.field === 'Form Assembly ID'; })[0]; }

test('84. the real kone.ae page: form 1491 is read from the AEM component, and is a mismatch against UAE\'s 752', function () {
  var r = qa.run(KONE_AE);
  assert.strictEqual(r.facts.digitalData, null, 'the AEM page carries no digitalData at all');
  assert.strictEqual(r.facts.forms.length, 1);
  var f = r.facts.forms[0];
  assert.strictEqual(f.formId, '1491');
  assert.strictEqual(f.embed, 'aem-component');
  assert.deepStrictEqual(f.ids, { targetId: '1491', publish: '1491' });
  assert.strictEqual(f.scriptUrl, 'https://kone.tfaforms.net/publish/1491');
  assert.strictEqual(f.anchor, 'form-assembly', 'the anchor the page\'s own FAQ links to');
  assert.strictEqual(f.where, 'Page body — "Find the right solution for you"');
  assert.strictEqual(f.rendered, false);
  assert.strictEqual(f.submit, null, 'not read — the form is injected by script, not "no submit button"');
  var row = formRow(r);
  assert.deepStrictEqual([row.state, row.expected, row.found], ['differs', '752', '1491']);
  var d = cat(r, 'structure').deviations.filter(function (x) { return x.field === 'Form Assembly ID'; });
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].severity, 'break');
  assert.ok(/embeds FormAssembly form 1491 \(kone\.tfaforms\.net\/publish\/1491\), but UAE pages are expected to use 752/.test(d[0].note), d[0].note);
  assert.ok(!/digitalData/.test(d[0].note), 'no longer "carries no digitalData" on an AEM page');
  assert.ok(!cat(r, 'structure').deviations.some(function (x) { return x.field === 'Form wiring'; }), 'component and script agree');
});

test('85. the same page named on a crawl list with 1491 matches; with 752 it is a fix naming the URL list', function () {
  assert.strictEqual(formRow(qa.run(KONE_AE, { expectedFormId: '1491' })).state, 'matches');
  var r = qa.run(KONE_AE, { expectedFormId: '752' });
  var d = cat(r, 'structure').deviations.filter(function (x) { return x.field === 'Form Assembly ID'; })[0];
  assert.ok(/form 752 was expected on this URL/.test(d.note) && !/pageOverrides/.test(d.note), d.note);
});

test('86. rendered FormAssembly markup (synthetic, from the team\'s 752 example): every field read, and it passes', function () {
  var r = qa.run(aePage(TFA_752));
  var f = r.facts.forms[0];
  assert.strictEqual(r.facts.forms.length, 1);
  assert.deepStrictEqual([f.formId, f.idSource, f.embed], ['752', 'tfa_dbFormId', 'markup']);
  assert.deepStrictEqual(f.ids, { dbFormId: '752', formElement: '752', wrapper: '752' });
  assert.deepStrictEqual([f.formElementId, f.wrapperId, f.postHost, f.version], ['752', '752-WRPR', 'kone.tfaforms.net', '27']);
  assert.strictEqual(f.title, 'Contact us & get a quote');
  assert.deepStrictEqual([f.language, f.localization, f.submit, f.captcha], ['en_GB', 'en_GB', true, true]);
  assert.strictEqual(formRow(r).state, 'matches');
  assert.ok(!cat(r, 'structure').deviations.some(function (x) { return /Form/.test(x.field); }));
});

test('87. a form whose parts name different forms is a wiring fix, each part named', function () {
  var r = qa.run(aePage(TFA_752.replace('id="752-WRPR"', 'id="753-WRPR"')));
  var d = cat(r, 'structure').deviations.filter(function (x) { return x.field === 'Form wiring'; })[0];
  assert.strictEqual(d.severity, 'break');
  assert.strictEqual(d.found, 'form id 752 · tfa_dbFormId 752 · wrapper 753-WRPR');
  var aem = qa.run(KONE_AE.replace('data-target-id="1491"', 'data-target-id="1490"'));
  var w = cat(aem, 'structure').deviations.filter(function (x) { return x.field === 'Form wiring'; })[0];
  assert.strictEqual(w.found, 'embed URL 1491 · data-target-id 1490');
});

test('88. with no form markup, the id is still read: form id, wrapper, embed script, iframe', function () {
  var noDb = qa.run(aePage(TFA_752.replace(/<input type="hidden" value="752" name="tfa_dbFormId" id="tfa_dbFormId">/, '')));
  assert.deepStrictEqual([noDb.facts.forms[0].formId, noDb.facts.forms[0].idSource], ['752', 'form id']);
  var script = qa.run(aePage('<div id="c"></div><script src="https://kone.tfaforms.net/publish/752" defer></script>'));
  assert.deepStrictEqual([script.facts.forms[0].formId, script.facts.forms[0].embed, script.facts.forms[0].idSource], ['752', 'script', 'embed script URL']);
  var iframe = qa.run(aePage('<iframe src="https://kone.tfaforms.net/752" height="900"></iframe>'));
  assert.deepStrictEqual([iframe.facts.forms[0].formId, iframe.facts.forms[0].embed], ['752', 'iframe']);
  var support = qa.run(aePage('<script src="https://kone.tfaforms.net/js/FA__DOMContentLoadedEventDispatcher.js"></script>'));
  assert.strictEqual(support.facts.forms.length, 0, 'FormAssembly\'s support scripts carry no form id and are not a form');
});

test('89. no form at all says "No forms found" — not a failure; a commented-out form is not a form', function () {
  var r = qa.run(aePage('<p>Call us.</p><!-- <script src="https://kone.tfaforms.net/publish/752"></script> -->'));
  assert.strictEqual(r.facts.forms.length, 0);
  assert.strictEqual(formRow(r).state, 'no-form');
  assert.ok(!cat(r, 'structure').deviations.some(function (x) { return /Form/.test(x.field); }));
});

test('90. two forms are two entries; a form in a hidden modal says so', function () {
  var r = qa.run(aePage(TFA_752 + '<div class="modal" style="display:none"><script src="https://kone.tfaforms.net/publish/1491"></script></div>'));
  assert.deepStrictEqual(r.facts.forms.map(function (f) { return f.formId; }), ['752', '1491']);
  assert.strictEqual(r.facts.forms[1].hidden, true);
  assert.ok(/\(hidden\)$/.test(r.facts.forms[1].where), r.facts.forms[1].where);
  assert.strictEqual(formRow(r).state, 'differs', '1491 is not UAE\'s 752');
  assert.strictEqual(formRow(r).found, '752, 1491');
});

test('91. digitalData naming one form and the page embedding another is a check', function () {
  var dd = '<script>var digitalData = { page: { pageInfo: { "FormAssemblyId": "752" } } };</script>';
  var r = qa.run(aePage('<script src="https://kone.tfaforms.net/publish/1491"></script>', dd));
  var d = cat(r, 'structure').deviations.filter(function (x) { return x.field === 'Form Assembly ID' && x.severity === 'check'; })[0];
  assert.ok(d && /digitalData names form 752, but the form embedded on it is 1491/.test(d.note), notes(cat(r, 'structure').deviations));
});

test('92. crawlRow carries each form, and the crawl URL list reads an optional expected form id', function () {
  var row = qa.crawlRow(qa.run(KONE_AE, { expectedFormId: '1491' }), null);
  assert.strictEqual(row.formId, 'matches');
  assert.strictEqual(row.formIdFound, '1491');
  assert.strictEqual(row.expectedFormId, '1491');
  assert.deepStrictEqual(row.forms, [{ formId: '1491', idSource: 'embed script URL', embed: 'aem-component', postHost: null,
    version: null, title: null, language: null, localization: null, submit: null, captcha: null }]);
  assert.deepStrictEqual(BriefQA.parseUrlList('url,expected_form_id\nhttps://www.kone.ae/a/, 752\nwww.kone.ae/b/\t1491\n\nhttps://www.kone.ae/c/\nhttps://www.kone.ae/a/ 9'), [
    { url: 'https://www.kone.ae/a/', expectedFormId: '752' },
    { url: 'https://www.kone.ae/b/', expectedFormId: '1491' },
    { url: 'https://www.kone.ae/c/', expectedFormId: null }
  ]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

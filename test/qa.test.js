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

test('43. a site name after " - " instead of " | " is amber', function () {
  var r = qa.run(page({ title: 'Contacto - KONE España' }));
  assert.strictEqual(formatRow(r).state, 'amber');
  assert.ok(/not after " \| "/.test(formatRow(r).stateLabel));
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
  assert.strictEqual(row.formId, 'missing');
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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

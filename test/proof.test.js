// test/proof.test.js — spelling, lists and metadata, each rule caught and each rule quiet.
// Run: npm test
//
// The real Bahrain builders page carries most of these faults as shipped
// (Commerical, TransSys, typed FAQ numbers, lists written as paragraphs, a
// flattened FAQ list, a doubled site name in the title). Every other existing
// fixture — Slovenian, Italian, an Indian FAQ page, an agency mockup — must
// come back clean: a proofreader that cries wolf is worse than none.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Compare = require('../compare.js');
var Proof = require('../proof.js');

function load(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
var comparer = Compare.create({ 'work-types': JSON.parse(load('../config/work-types.json')), sites: JSON.parse(load('../config/sites.json')) });
var BH = load('fixtures/kone-bh-builders.html');
var BH_REGION = comparer.mainRegion(BH).html;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function fields(list) { return list.map(function (f) { return f.field + ':' + f.text; }); }
function spell(body, english) { return Proof.spelling('<main>' + body + '</main>', {}, { region: '<main>' + body + '</main>', english: english !== false }); }
function lists(body) { return Proof.lists('<main>' + body + '</main>'); }

// ─── spelling ──────────────────────────────────────────────────────────────

test('1. the real page: Commerical and TransSys, with where they are and the fix', function () {
  var s = Proof.spelling(BH, {}, { region: BH_REGION, english: true });
  var mis = s.filter(function (f) { return f.text === 'Commerical'; })[0];
  assert.ok(mis && mis.verdict === 'red' && mis.suggestion === 'Commercial', JSON.stringify(mis));
  assert.ok(/Flexible flow for busy buildings/.test(mis.where), mis.where);
  var brand = s.filter(function (f) { return f.text === 'TransSys'; })[0];
  assert.ok(brand && brand.field === 'Product name' && brand.suggestion === 'TranSys', JSON.stringify(brand));
  assert.strictEqual(s.length, 2, fields(s).join(' | '));
});

test('2. misspelling list: caught, and quiet on the right spelling', function () {
  assert.deepStrictEqual(fields(spell('<p>Our maintainance team.</p>')), ['Misspelling:maintainance']);
  assert.deepStrictEqual(spell('<p>Our maintenance team for commercial buildings.</p>'), []);
});

test('3. KONE names: a wrong spelling is red, wrong casing amber; the right forms are quiet', function () {
  assert.deepStrictEqual(fields(spell('<p>The KONE Minispace and the KONE JumLift.</p>')), ['Product name:Minispace', 'Product name:JumLift']);
  assert.deepStrictEqual(spell('<p>KONE MonoSpace® DX, KONE MiniSpace™ DX, KONE TranSys™ DX, KONE EcoDisc® and myKONE.</p>'), []);
});

test('4. a word spelled two ways: swapped or doubled letters only, never two real words', function () {
  var s = spell('<p>elevator elevator elevaotr</p><p>commitment commitment comitment</p>');
  assert.deepStrictEqual(fields(s).sort(), ['Possible typo:comitment', 'Possible typo:elevaotr']);
  assert.deepStrictEqual(spell('<p>projects projects protects online online inline</p>'), []);
  assert.deepStrictEqual(spell('<p>impianti impianti impianto stavbe stavbe stavbi</p>', false), []);
  assert.deepStrictEqual(spell('<p>elevators elevators elevator finished finished finishes</p>'), []);
});

test('5. UK and US spellings mixed on an English page; quiet when consistent or not English', function () {
  var s = spell('<p>Elevator modernization in a city centre.</p>');
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].field, 'Mixed spelling');
  assert.deepStrictEqual(spell('<p>Elevator modernization in a city center.</p>'), []);
  assert.deepStrictEqual(spell('<p>Elevator modernization in a city centre.</p>', false), []);
});

test('6. every other real fixture comes back with no spelling findings', function () {
  ['kone-si-monospace-100dx.html', 'kone-in-elevator-types-faq.html', 'kone-it-healthcare-landing.html', 'kone-landing-pages-mockup.html']
    .forEach(function (f) {
      var html = load('fixtures/' + f);
      var s = Proof.spelling(html, {}, { region: comparer.mainRegion(html).html, english: /<html[^>]*lang="en/i.test(html) });
      assert.deepStrictEqual(fields(s), [], f);
    });
});

// ─── lists ─────────────────────────────────────────────────────────────────

test('7. the real page: typed FAQ numbers, four lists as paragraphs, the flattened FAQ 7 list', function () {
  var l = Proof.lists(BH_REGION);
  var by = {};
  l.forEach(function (f) { by[f.field] = (by[f.field] || 0) + 1; });
  assert.deepStrictEqual(by, { 'Typed numbering': 1, 'List as paragraphs': 4, 'Flattened list': 1 }, JSON.stringify(by));
  var faq7 = l.filter(function (f) { return f.field === 'Flattened list'; })[0];
  assert.ok(/7\. What types of elevators/.test(faq7.where), faq7.where);
  assert.ok(/3 items end with ":"/.test(faq7.note));
});

test('8. typed numbering: caught in FAQ questions, red when it skips; quiet without numbers', function () {
  var faq = function (qs) {
    return '<ul class="accordion">' + qs.map(function (q) { return '<li><button class="accordion-trigger">' + q + '</button></li>'; }).join('') + '</ul>';
  };
  assert.strictEqual(lists(faq(['1. One?', '2. Two?'])) [0].verdict, 'amber');
  assert.strictEqual(lists(faq(['1. One?', '3. Three?']))[0].verdict, 'red');
  assert.deepStrictEqual(lists(faq(['One?', 'Two?'])), []);
});

test('9. a list as paragraphs; a real list is quiet; a sentence after a colon is not a list', function () {
  assert.strictEqual(lists('<p>Types include:</p><p>Alpha</p><p>Beta</p>')[0].field, 'List as paragraphs');
  assert.deepStrictEqual(lists('<p>Types include:</p><ul><li>Alpha</li><li>Beta</li></ul>'), []);
  assert.deepStrictEqual(lists('<p>Note:</p><p>This is a full sentence.</p><p>So is this one.</p>'), []);
});

test('10. typed bullets, mixed punctuation, double numbering, empty and single items', function () {
  assert.strictEqual(lists('<p>• Alpha</p>')[0].field, 'Typed bullets');
  assert.strictEqual(lists('<ul><li>One.</li><li>Two.</li><li>Three</li></ul>')[0].field, 'Mixed punctuation');
  assert.strictEqual(lists('<ol><li>1. One</li><li>2. Two</li></ol>')[0].field, 'Double numbering');
  assert.deepStrictEqual(fields(lists('<ul><li>One</li><li></li></ul>')), ['Empty list item:(empty)']);
  assert.deepStrictEqual(fields(lists('<ul><li>Only one</li></ul>')), ['Single-item list:Only one']);
  assert.deepStrictEqual(lists('<ul><li>One.</li><li>Two.</li><li>Three.</li></ul>'), []);
});

test('11. every other real fixture comes back with no list findings', function () {
  ['kone-si-monospace-100dx.html', 'kone-in-elevator-types-faq.html', 'kone-it-healthcare-landing.html', 'kone-landing-pages-mockup.html']
    .forEach(function (f) { assert.deepStrictEqual(fields(Proof.lists(comparer.mainRegion(load('fixtures/' + f)).html)), [], f); });
});

// ─── metadata ──────────────────────────────────────────────────────────────

test('12. the real page: one title row with one proposed title, and the rest', function () {
  var m = Proof.metadata(BH, { canonical: 'https://preview.kone.bh/en/new-buildings/builders/', region: BH_REGION });
  var title = m.filter(function (f) { return f.field === 'Title'; });
  assert.strictEqual(title.length, 1);
  assert.strictEqual(title[0].suggestion, 'Construction Elevators for Builders - KONE Bahrain');
  assert.ok(/appears twice/.test(title[0].note) && /69 characters/.test(title[0].note) && /trailing spaces/.test(title[0].note), title[0].note);
  assert.deepStrictEqual(m.map(function (f) { return f.field; }).sort(),
    ['H1', 'H1 and title', 'Meta keywords', 'Search title', 'Title', 'twitter:card', 'twitter:image']);
  var kw = m.filter(function (f) { return f.field === 'Meta keywords'; })[0];
  assert.ok(/^construction elevator, commercial elevator installation,/.test(kw.suggestion) && !/\s$/.test(kw.suggestion));
});

test('13. a clean head comes back with nothing to say', function () {
  var head = '<head><title>Construction elevators for builders - KONE Bahrain</title>' +
    '<meta name="description" content="KONE supports builders from planning to final handover with digital site tools and construction-phase elevators.">' +
    '<meta name="keywords" content="construction elevator, elevator installation">' +
    '<meta property="og:url" content="https://www.kone.bh/en/builders/"><meta property="og:image" content="https://x/a.png">' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="https://x/a.png"></head>';
  var m = Proof.metadata('<html>' + head + '<body><main><h1>Construction elevators for builders</h1></main></body></html>',
    { canonical: 'https://www.kone.bh/en/builders/' });
  assert.deepStrictEqual(m, []);
});

test('14. a missing description is red; one too short is amber', function () {
  assert.strictEqual(Proof.metadata('<head><title>A - KONE Bahrain</title></head>')[0].verdict, 'red');
  assert.strictEqual(Proof.metadata('<head><title>A - KONE Bahrain</title><meta name="description" content="Too short."></head>')[0].verdict, 'amber');
});

test('15. distance counts a swap as one edit', function () {
  assert.strictEqual(Proof.distance('commercial', 'commerical'), 1);
  assert.strictEqual(Proof.distance('transys', 'transsys'), 1);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

// test/brief.test.js — one parse of the brief, shared by all three features.
// Run: npm test
//
// The fixture is a four-column localization brief — English master plus
// Spain, Italy and Portugal — because that shape is what exposed three
// separate bugs in three separate files: Fill took the last column
// regardless of target, Compare found no sections because it only knew
// tab-separated three-column rows, and Analyse asked for a market the brief
// already declared. This suite is about brief.js alone; the other three
// modules' own suites cover their side of consuming it.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Brief = require('../brief.js');

var config = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'work-types.json'), 'utf8')
);

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

console.log('WCM Brief Analyser — shared brief parse verification\n');

var MULTI_MARKET = [
  'Level 2\tSPAIN',
  'Web content starts here',
  'H1 header\tEnglish\tSPAIN\tITALY\tPORTUGAL',
  'Hero section',
  'H1\tSmart modernisations\tModernizaciones inteligentes\tModernizzazioni intelligenti\tModernizações inteligentes',
  'Proof point',
  'Body\tUp to 70% energy savings\tHasta un 74% de ahorro energético\tFino al 74% di risparmio energetico\tAté 74% de poupança energética'
].join('\n');

// ─── ROWS AND QUOTING ────────────────────────────────────────────────────

test('1. a quoted cell containing a newline stays one row', function () {
  var rows = Brief.splitRows('a\tb\nc\t"d\ne"\tf\n');

  assert.strictEqual(rows.length, 2, 'the quoted newline must not end the row');
  assert.deepStrictEqual(rows[0], ['a', 'b']);
  assert.strictEqual(rows[1][1], 'd\ne', 'and the value keeps its newline without the wrapping quotes');
});

test('2. "" inside a quoted cell is an escaped quote, not the end of it', function () {
  var rows = Brief.splitRows('label\t"he said ""hi"" today"\n');

  assert.strictEqual(rows[0][1], 'he said "hi" today');
});

test('3. a quote inside a cell is punctuation and does not open a quoted cell', function () {
  var rows = Brief.splitRows('label\tsize is 6" wide\tvalue\n');

  assert.strictEqual(rows.length, 1, 'the row must not swallow the rest of the brief');
  assert.strictEqual(rows[0][1], 'size is 6" wide');
});

test('4. a blank line is dropped, not returned as an empty row', function () {
  var rows = Brief.splitRows('a\tb\n\n\nc\td\n');

  assert.strictEqual(rows.length, 2);
});

// ─── SECTIONS ────────────────────────────────────────────────────────────

test('5. a row with exactly one cell is a section header for what follows', function () {
  var rows = Brief.splitRows(MULTI_MARKET);
  var sections = Brief.sectionsByRow(rows);

  // Row indices are 0-based here; row 5 (0-based 4) is the H1 line under
  // "Hero section", row 7 (0-based 6) is the Body line under "Proof point".
  assert.strictEqual(sections[4], 'Hero section');
  assert.strictEqual(sections[6], 'Proof point');
});

test('6. a section carries forward until the next one-cell row', function () {
  var rows = ['Intro', 'a\tb\tc', 'a\tb\tc', 'Outro', 'x\ty\tz'].map(function (l) { return l.split('\t'); });
  var sections = Brief.sectionsByRow(rows);

  assert.deepStrictEqual(sections, ['Intro', 'Intro', 'Intro', 'Outro', 'Outro']);
});

// ─── MARKETS ─────────────────────────────────────────────────────────────

test('7. three market columns are found from the header row', function () {
  var m = Brief.parse(MULTI_MARKET, config);

  assert.strictEqual(m.markets.length, 3, JSON.stringify(m.markets));
  assert.deepStrictEqual(m.markets.map(function (x) { return x.name; }), ['SPAIN', 'ITALY', 'PORTUGAL']);
});

test('8. the English master column is found and is not one of the market columns', function () {
  var m = Brief.parse(MULTI_MARKET, config);

  assert.strictEqual(m.masterColumn, 1);
  assert.ok(!m.markets.some(function (x) { return x.column === m.masterColumn; }));
});

test('9. the target market is read from the brief\'s front matter', function () {
  var m = Brief.parse(MULTI_MARKET, config);

  assert.strictEqual(m.targetMarket, 'SPAIN');
});

test('10. a market name inside the table is a column header, not a target declaration', function () {
  // No front-matter declaration at all — the header row's market names must
  // not be mistaken for a target.
  var noFrontMatter = MULTI_MARKET.split('\n').slice(1).join('\n');
  var m = Brief.parse(noFrontMatter, config);

  assert.strictEqual(m.targetMarket, null);
});

test('11. marketColumn resolves a market name to its column index', function () {
  var m = Brief.parse(MULTI_MARKET, config);

  assert.strictEqual(Brief.marketColumn(m, 'SPAIN'), 2);
  assert.strictEqual(Brief.marketColumn(m, 'ITALY'), 3);
  assert.strictEqual(Brief.marketColumn(m, 'PORTUGAL'), 4);
  assert.strictEqual(Brief.marketColumn(m, 'GERMANY'), -1, 'a market not in the brief resolves to nothing');
});

test('12. a classic three-column brief has no market columns and no target', function () {
  var classic = 'Body\tLearn more about our elevators\tPoznajte naše dvigala';
  var m = Brief.parse(classic, config);

  assert.deepStrictEqual(m.markets, []);
  assert.strictEqual(m.targetMarket, null, 'a single-locale brief declares no target — there is only one column to use');
});

// ─── PROVENANCE ──────────────────────────────────────────────────────────

test('13. every row carries its own 1-based line number and its section', function () {
  var m = Brief.parse(MULTI_MARKET, config);
  var proofRow = m.rows.filter(function (r) { return r.section === 'Proof point' && r.cells[0] === 'Body'; })[0];

  assert.strictEqual(proofRow.row, 7);
});

// ─── LINES ───────────────────────────────────────────────────────────────

test('14. linesOf reconstitutes tab-joined lines from quote-aware rows', function () {
  var quoted = 'Body\t"Line one.\nLine two."\tRow B';
  var m = Brief.parse(quoted, config);
  var lines = Brief.linesOf(m);

  assert.strictEqual(lines.length, 1, 'the quoted newline must not have produced a second line');
  assert.strictEqual(lines[0], 'Body\tLine one.\nLine two.\tRow B');
});

// ─── DETERMINISM ─────────────────────────────────────────────────────────

test('15. the same brief parses identically twice', function () {
  var a = Brief.parse(MULTI_MARKET, config);
  var b = Brief.parse(MULTI_MARKET, config);

  assert.deepStrictEqual(a, b);
});

// ─── marketOf ────────────────────────────────────────────────────────────

test('16. marketOf returns the market object, domain included, by name', function () {
  var m = Brief.parse(MULTI_MARKET, config);
  var spain = Brief.marketOf(m, 'SPAIN');

  assert.ok(spain, 'expected a match for SPAIN');
  assert.strictEqual(spain.domain, 'kone.es');
});

test('17. marketOf is case-insensitive, same as marketColumn already was', function () {
  var m = Brief.parse(MULTI_MARKET, config);

  assert.strictEqual(Brief.marketOf(m, 'spain').domain, 'kone.es');
});

test('18. marketOf returns null for a name the brief never declared', function () {
  var m = Brief.parse(MULTI_MARKET, config);

  assert.strictEqual(Brief.marketOf(m, 'DENMARK'), null);
  assert.strictEqual(Brief.marketOf(m, ''), null);
});

// ─── Table shape ─────────────────────────────────────────────────────────
// Every localization brief handled so far is "rows = fields, columns =
// markets". A real KONE sheet is the transpose: "rows = markets, columns =
// fields" — country name in column 1, translated header and body text
// alongside it. None of its markets (Bulgaria, Croatia, Germany) are in
// config's markets.list, so this must be read from the table's shape, not
// a name lookup.

var TRANSLATIONS = [
  'Country\tLanguages\tkone.com section header translated\tOption 1 text translated\tOption 2 text translated',
  'Bulgaria\tBulgarian\tДостъп до данни съгласно EU Data Act\tАко желаете да поискате достъп до данните си съгласно Регламента на ЕС за данните, можете да го направите.\tМоже да подадете искане чрез нашия портал за контакт.',
  'Croatia\tCroatian\tPristup podacima prema EU Data Actu\tAko želite zatražiti pristup svojim podacima, možete to učiniti.\tZahtjev možete podnijeti putem našeg kontakt portala.',
  'Germany\tGerman\tDatenzugriff gemäß EU-Datengesetz\tWenn Sie Zugang zu Ihren Daten beantragen möchten, können Sie dies tun.\tSie können eine Anfrage über unser Kontaktportal stellen.'
].join('\n');

test('19. a Translations-shaped sheet is read as markets-by-field, with no configured market names', function () {
  var shape = Brief.detectOrientation(Brief.splitRows(TRANSLATIONS), config);

  assert.strictEqual(shape.orientation, 'markets-by-field', shape.reason);
  assert.strictEqual(shape.evidence.namedMarketRows, 0, 'none of these markets are configured: ' + JSON.stringify(shape.evidence));
  assert.deepStrictEqual(shape.dataRows, [1, 2, 3]);
});

test('20. the classic fields-by-market shape still wins when it applies', function () {
  var text = 'Meta title\tKONE\tKONE Portugal\nHeadline\tUpgrades\tModernizações\nBody\tFast\tRápida';
  var shape = Brief.detectOrientation(Brief.splitRows(text), config);

  assert.strictEqual(shape.orientation, 'fields-by-market', shape.reason);
});

test('21. a shape that fits neither is reported unknown, with a reason, never guessed', function () {
  var redirects = 'https://www.kone.dk/old/\thttps://www.kone.dk/new/\nhttps://www.kone.dk/old2/\thttps://www.kone.dk/new2/';
  var shape = Brief.detectOrientation(Brief.splitRows(redirects), config);

  assert.strictEqual(shape.orientation, 'unknown');
  assert.ok(shape.reason);
});

test('22. a rollout-tracking sheet (short identifiers, no prose column) is unknown, not misread as a market table', function () {
  var rollout = [
    'Frontline\tCountry\tComms representative\tContent to be published\tkone.com update status',
    'John Smith\tFinland\tJane Doe\tSee attached\tIn progress',
    'John Smith\tSweden\tJane Doe\tSee attached\tDone'
  ].join('\n');
  var shape = Brief.detectOrientation(Brief.splitRows(rollout), config);

  assert.strictEqual(shape.orientation, 'unknown', shape.reason);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

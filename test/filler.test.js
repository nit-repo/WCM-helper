// test/filler.test.js — finding the localized text for an English master.
// Run: npm test
//
// The failure that matters here is not "no match found" — it is a confident
// wrong match, or markup silently dropped on the way across. A dropped link
// is invisible until the Comparer reports it as missing two steps later, so
// several cases assert on what must NOT happen.

var assert = require('assert');
var Filler = require('../filler.js');

var filler = Filler.create();

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// ─── FIXTURES ────────────────────────────────────────────────────────────

var SLOVENIA = [
  'Meta title\tKONE MonoSpace 100 DX Residential Elevator\tKONE MonoSpace 100 DX dvigalo za stanovanjske stavbe',
  'Headline\tKONE MonoSpace 100 DX\tKONE MonoSpace 100 DX',
  'Subheading\tSave valuable space and gain greater design freedom with our machine-roomless elevator.\tPrihranite dragocen prostor in si zagotovite večjo oblikovalsko svobodo z našim dvigalom brez strojnice.',
  'Title\tReduce energy costs\tZmanjšajte stroške energije',
  'Body\tWith a compact KONE EcoDisc hoisting motor, energy use is reduced.\tS kompaktnim dvižnim motorjem KONE EcoDisc se poraba energije zmanjša.',
  'CTA\tLearn more\tVeč o tem'
].join('\n');

var LOCAL_ONLY = [
  'Headline\tKONE MonoSpace 100 DX',
  'Subheading\tPrihranite dragocen prostor v stavbi.'
].join('\n');

console.log('WCM Helper — component filler verification\n');

// ─── Rows ────────────────────────────────────────────────────────────────

test('1. a three-column row gives label, English master and localized text', function () {
  var r = filler.rows(SLOVENIA);
  var body = r.filter(function (x) { return x.label === 'Body'; })[0];

  assert.ok(body, 'the Body row should be found');
  assert.ok(/KONE EcoDisc hoisting motor/.test(body.english), 'English is the middle column');
  assert.ok(/dvižnim motorjem/.test(body.localized), 'localized is the last column');
});

test('2. a two-column brief still lists its rows, with no English to match on', function () {
  var r = filler.rows(LOCAL_ONLY);

  assert.strictEqual(r.length, 2, 'both rows should be listed');
  assert.strictEqual(r[0].english, null, 'there is no English column');
  assert.ok(/MonoSpace/.test(r[0].localized), 'the value is still the localized text');
});

test('3. a row whose columns are identical is flagged as untranslated', function () {
  var headline = filler.rows(SLOVENIA).filter(function (x) { return x.label === 'Headline'; })[0];
  var body = filler.rows(SLOVENIA).filter(function (x) { return x.label === 'Body'; })[0];

  assert.strictEqual(headline.untranslated, true, 'a repeated product name carries no translation');
  assert.strictEqual(body.untranslated, false);
});

// ─── Lookup ──────────────────────────────────────────────────────────────

test('4. pasting the exact English finds the row', function () {
  var r = filler.fill(SLOVENIA, 'Reduce energy costs');

  assert.strictEqual(r.how, 'exact');
  assert.strictEqual(r.match.label, 'Title');
  assert.strictEqual(r.match.localized, 'Zmanjšajte stroške energije');
});

test('5. surrounding markup and stray whitespace do not stop a match', function () {
  var r = filler.fill(SLOVENIA, '<p>  Reduce   energy&nbsp;costs </p>');

  assert.strictEqual(r.how, 'exact', 'got ' + r.how);
  assert.strictEqual(r.match.label, 'Title');
});

test('6. a fragment of a longer field matches by containment', function () {
  var r = filler.fill(SLOVENIA, 'gain greater design freedom with our machine-roomless elevator.');

  assert.strictEqual(r.how, 'contained', 'got ' + r.how);
  assert.strictEqual(r.match.label, 'Subheading');
});

test('7. English that is in no row returns no match, not the nearest thing', function () {
  var r = filler.fill(SLOVENIA, 'Our lifts are inspected annually by qualified engineers.');

  assert.strictEqual(r.match, null, 'matched ' + (r.match && r.match.label) + ' — must not guess');
  assert.strictEqual(r.how, 'none');
});

test('8. a near match is offered as closest, with its score, not as certainty', function () {
  var r = filler.fill(SLOVENIA, 'Reduce the energy costs of the building');

  assert.strictEqual(r.how, 'closest', 'got ' + r.how);
  assert.ok(r.confidence > 0 && r.confidence < 1, 'confidence should be partial: ' + r.confidence);
});

test('9. a local-only brief says so rather than failing silently', function () {
  var r = filler.fill(LOCAL_ONLY, 'Save valuable space');

  assert.strictEqual(r.how, 'no-english-column');
  assert.strictEqual(r.match, null);
  assert.strictEqual(r.rowCount, 2, 'the rows are still there for the worklist');
});

// ─── Markup ──────────────────────────────────────────────────────────────

test('10. a link on a product name survives into the localized text', function () {
  var brief = 'Body\tLearn more about KONE Predictive Maintenance today.\tPreberite več o storitvi KONE Predictive Maintenance danes.';
  var r = filler.fill(brief, 'Learn more about <a href="/maintenance/">KONE Predictive Maintenance</a> today.');

  assert.strictEqual(r.carried.unplaced.length, 0, 'nothing should be left over: ' + JSON.stringify(r.carried.unplaced));
  assert.strictEqual(r.carried.restored.length, 1);
  assert.strictEqual(r.carried.html,
    'Preberite več o storitvi <a href="/maintenance/">KONE Predictive Maintenance</a> danes.');
});

test('11. a link whose anchor text was translated is listed, never guessed into place', function () {
  var brief = 'Body\tRead more about our maintenance service.\tPreberite več o naši storitvi vzdrževanja.';
  var r = filler.fill(brief, 'Read more about our <a href="/maintenance/">maintenance service</a>.');

  assert.strictEqual(r.carried.restored.length, 0, 'it cannot be placed with certainty');
  assert.strictEqual(r.carried.unplaced.length, 1, 'so it must be reported');
  assert.strictEqual(r.carried.unplaced[0].href, '/maintenance/');
  assert.strictEqual(r.carried.unplaced[0].text, 'maintenance service');
  assert.ok(!/<a /.test(r.carried.html), 'and no link invented in the wrong position: ' + r.carried.html);
});

test('12. bold and emphasis carry across the same way', function () {
  var brief = 'Body\tThe KONE EcoDisc motor is efficient.\tMotor KONE EcoDisc je učinkovit.';
  var r = filler.fill(brief, 'The <strong>KONE EcoDisc</strong> motor is <em>efficient</em>.');

  assert.ok(/<strong>KONE EcoDisc<\/strong>/.test(r.carried.html), 'got: ' + r.carried.html);
  assert.strictEqual(r.carried.unplaced.length, 1, 'the translated "efficient" cannot be placed');
  assert.strictEqual(r.carried.unplaced[0].tag, 'em');
});

test('13. plain English gives plain output and raises nothing', function () {
  var r = filler.fill(SLOVENIA, 'Reduce energy costs');

  assert.strictEqual(r.carried.hadMarkup, false);
  assert.strictEqual(r.carried.unplaced.length, 0);
  assert.strictEqual(r.carried.html, 'Zmanjšajte stroške energije');
});

test('14. localized text cannot inject markup of its own', function () {
  var brief = 'Body\tSee the <terms> and conditions.\tGlejte <pogoje> & določila.';
  var r = filler.fill(brief, 'See the <a href="/terms/">&lt;terms&gt;</a> and conditions.');

  assert.ok(!/<pogoje>/.test(r.carried.html), 'raw angle brackets must be escaped: ' + r.carried.html);
  assert.ok(/&lt;pogoje&gt;/.test(r.carried.html), 'and shown as text: ' + r.carried.html);
  assert.ok(/&amp;/.test(r.carried.html), 'ampersand escaped too: ' + r.carried.html);
});

test('15. b and i are normalised to strong and em', function () {
  var marks = filler.readMarkup('A <b>bold</b> and <i>italic</i> run.');

  assert.deepStrictEqual(marks.map(function (m) { return m.tag; }), ['strong', 'em']);
});

// ─── Cross-cutting ───────────────────────────────────────────────────────

test('16. determinism — the same lookup resolves identically twice', function () {
  var first = filler.fill(SLOVENIA, 'Reduce energy costs');
  var second = filler.fill(SLOVENIA, 'Reduce energy costs');
  delete first.generatedAt; delete second.generatedAt;

  assert.deepStrictEqual(first, second);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

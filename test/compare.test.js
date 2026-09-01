// test/compare.test.js — brief versus built page.
// Run: npm test
//
// Fixtures are a brief, the page that matches it, and the same page with
// deviations planted one per category. The failure that matters is a
// deviation the comparer stays quiet about, so most cases assert something
// IS caught — and the clean-page case asserts the opposite, because a
// comparer that cries wolf on every page is no more useful than one that
// says nothing.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var BriefCompare = require('../compare.js');

var config = {
  'work-types': JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'work-types.json'), 'utf8')
  )
};

var comparer = BriefCompare.create(config);

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

function cat(result, id) {
  return result.categories.filter(function (c) { return c.id === id; })[0].deviations;
}
function textOf(deviations) { return JSON.stringify(deviations); }

// ─── FIXTURES ────────────────────────────────────────────────────────────

var BRIEF = [
  'Meta Title: Lift Safety Features | KONE India',
  'Meta Description: Learn about the key safety features of modern high-rise elevators.',
  'Meta Keywords: elevator safety, high rise lifts',
  'URL Path: https://www.kone.in/blog/lift-safety-features',
  '',
  'What are the Key Safety Features Every High-Rise Elevator Must Have?[1.1]',
  'HERO: AEM Assets - KONE_Feat_Handrail_B_Landscape-004',
  'In a high-rise building, elevators are among the most heavily used systems and residents depend on them every day.',
  '',
  'Emergency Braking Systems[2.1]',
  'These systems automatically activate if the elevator exceeds its designated speed or detects an abnormal condition.',
  '',
  'Door Safety Sensors[3.1]',
  'Modern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.'
].join('\n');

// Chrome is deliberately noisy: if the comparer reads it, the body report
// fills with menu labels and cookie copy.
var NAV = '<nav><a href="/new-buildings/">New buildings</a><a href="/existing-buildings/">Existing buildings</a>' +
  '<p>Cookies help us deliver our services. By using this site you agree to our use of cookies.</p></nav>';
var FOOTER = '<footer><a href="/privacy/">Privacy notice</a><p>Copyright KONE Corporation. All rights reserved.</p></footer>';

function page(parts) {
  return '<!DOCTYPE html><html><head>' +
    '<title>' + (parts.title || 'Lift Safety Features | KONE India') + '</title>' +
    '<meta name="description" content="' + (parts.description || 'Learn about the key safety features of modern high-rise elevators.') + '">' +
    '<meta name="keywords" content="elevator safety, high rise lifts">' +
    '<link rel="canonical" href="https://www.kone.in/blog/lift-safety-features">' +
    '</head><body>' + NAV + '<main>' + parts.main + '</main>' + FOOTER + '</body></html>';
}

var CLEAN_MAIN = [
  '<h1>What are the Key Safety Features Every High-Rise Elevator Must Have?</h1>',
  '<img src="/content/dam/marketing/KONE_Feat_Handrail_B_Landscape-004.jpg" alt="Handrail detail">',
  '<p>In a high-rise building, elevators are among the most heavily used systems and residents depend on them every day.</p>',
  '<h2>Emergency Braking Systems</h2>',
  '<p>These systems automatically activate if the elevator exceeds its designated speed or detects an abnormal condition.</p>',
  '<h2>Door Safety Sensors</h2>',
  '<p>Modern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.</p>'
].join('');

var CLEAN = page({ main: CLEAN_MAIN });

console.log('WCM Brief Analyser — comparer verification\n');

// ─── A clean page ────────────────────────────────────────────────────────

test('1. a page that matches the brief reports no deviations anywhere', function () {
  var r = comparer.compare(BRIEF, CLEAN, { workTypeId: 'new-page' });

  r.categories.forEach(function (c) {
    assert.strictEqual(c.deviations.length, 0,
      c.label + ' should be clean but reported: ' + textOf(c.deviations));
  });
});

test('2. nav, cookie copy and footer never reach the body report', function () {
  var r = comparer.compare(BRIEF, CLEAN, { workTypeId: 'new-page' });
  var everything = textOf(r.categories);

  assert.ok(!/Cookies help us/i.test(everything), 'cookie banner copy leaked into the report');
  assert.ok(!/Privacy notice/i.test(everything), 'footer link leaked into the report');
  assert.ok(!/New buildings/i.test(everything), 'nav label leaked into the report');
});

test('3. punctuation the CMS rewrites is not a deviation', function () {
  // Same copy, but with nbsp, curly quotes and collapsed spacing.
  var fancy = CLEAN_MAIN
    .replace('high-rise building, elevators', 'high-rise building,&nbsp;elevators')
    .replace('Door Safety Sensors</h2>', 'Door Safety Sensors</h2>\n\n   ')
    .replace('people or objects', '“people” or objects');
  var briefWithQuotes = BRIEF.replace('people or objects', '"people" or objects');

  var r = comparer.compare(briefWithQuotes, page({ main: fancy }), { workTypeId: 'new-page' });
  assert.strictEqual(cat(r, 'body').length, 0, 'reported: ' + textOf(cat(r, 'body')));
});

// ─── Planted deviations, one per category ────────────────────────────────

test('4. metadata — a changed meta description is caught, and reported both ways', function () {
  var r = comparer.compare(BRIEF, page({ main: CLEAN_MAIN, description: 'Something the author wrote instead.' }), { workTypeId: 'new-page' });
  var d = cat(r, 'metadata');

  assert.strictEqual(d.length, 1, 'expected exactly one metadata deviation: ' + textOf(d));
  assert.strictEqual(d[0].field, 'Meta description');
  assert.ok(/key safety features/.test(d[0].expected), 'should carry what the brief asked for');
  assert.ok(/Something the author wrote/.test(d[0].found), 'and what the page actually has');
});

test('5. body text — a reworded sentence is caught', function () {
  var reworded = CLEAN_MAIN.replace(
    'Modern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.',
    'Lifts today have sensors on the doors.'
  );
  var d = cat(comparer.compare(BRIEF, page({ main: reworded }), { workTypeId: 'new-page' }), 'body');

  assert.strictEqual(d.length, 1, 'expected one body deviation: ' + textOf(d));
  assert.ok(/advanced door sensors/.test(d[0].expected), 'should quote the brief copy that went missing');
});

test('6. body text — a duplicated section is caught', function () {
  var doubled = CLEAN_MAIN + '<h2>Emergency Braking Systems</h2><p>Duplicate block.</p>';
  var d = cat(comparer.compare(BRIEF, page({ main: doubled }), { workTypeId: 'new-page' }), 'body');

  assert.ok(d.some(function (x) { return /more than once/.test(x.note); }), 'reported: ' + textOf(d));
});

test('7. images — an asset named in the brief but absent from the page is caught', function () {
  var noImage = CLEAN_MAIN.replace(/<img[^>]*>/, '');
  var d = cat(comparer.compare(BRIEF, page({ main: noImage }), { workTypeId: 'new-page' }), 'images');

  assert.ok(d.some(function (x) { return /KONE_Feat_Handrail/.test(x.expected || ''); }), 'reported: ' + textOf(d));
});

test('8. images — a missing alt is caught', function () {
  var noAlt = CLEAN_MAIN.replace(' alt="Handrail detail"', '');
  var d = cat(comparer.compare(BRIEF, page({ main: noAlt }), { workTypeId: 'new-page' }), 'images');

  assert.ok(d.some(function (x) { return /no alt text/.test(x.note); }), 'reported: ' + textOf(d));
});

test('9. links — an author or /content/ path left in a live link is caught', function () {
  var leaked = CLEAN_MAIN + '<a href="/content/kone/in/en/services">Our services</a>';
  var d = cat(comparer.compare(BRIEF, page({ main: leaked }), { workTypeId: 'new-page' }), 'links');

  assert.ok(d.some(function (x) { return /\/content\//.test(x.found || ''); }), 'reported: ' + textOf(d));
});

test('10. structure — sections built out of the brief order are caught', function () {
  var swapped = [
    '<h1>What are the Key Safety Features Every High-Rise Elevator Must Have?</h1>',
    '<img src="/content/dam/marketing/KONE_Feat_Handrail_B_Landscape-004.jpg" alt="Handrail detail">',
    '<p>In a high-rise building, elevators are among the most heavily used systems and residents depend on them every day.</p>',
    '<h2>Door Safety Sensors</h2>',
    '<p>Modern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.</p>',
    '<h2>Emergency Braking Systems</h2>',
    '<p>These systems automatically activate if the elevator exceeds its designated speed or detects an abnormal condition.</p>'
  ].join('');
  var d = cat(comparer.compare(BRIEF, page({ main: swapped }), { workTypeId: 'new-page' }), 'structure');

  assert.ok(d.some(function (x) { return /out of the brief/.test(x.note); }), 'reported: ' + textOf(d));
});

test('11. structure — a section missing entirely is caught', function () {
  var dropped = CLEAN_MAIN
    .replace('<h2>Door Safety Sensors</h2>', '')
    .replace('<p>Modern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.</p>', '');
  var d = cat(comparer.compare(BRIEF, page({ main: dropped }), { workTypeId: 'new-page' }), 'structure');

  assert.ok(d.some(function (x) { return /missing from the page/.test(x.note); }), 'reported: ' + textOf(d));
});

test('12. metadata — a page with no H1, or more than one, is caught', function () {
  var noH1 = cat(comparer.compare(BRIEF, page({ main: CLEAN_MAIN.replace(/<h1>[\s\S]*?<\/h1>/, '') }), { workTypeId: 'new-page' }), 'metadata');
  assert.ok(noH1.some(function (x) { return /no H1/.test(x.note); }), 'no-H1 case reported: ' + textOf(noH1));

  var twoH1 = cat(comparer.compare(BRIEF, page({ main: CLEAN_MAIN + '<h1>Second heading</h1>' }), { workTypeId: 'new-page' }), 'metadata');
  assert.ok(twoH1.some(function (x) { return /2 H1 tags/.test(x.note); }), 'two-H1 case reported: ' + textOf(twoH1));
});

// ─── Localization ────────────────────────────────────────────────────────

test('13. localization — the local column is what must appear, not the English', function () {
  var brief = [
    'Meta title\tKONE MonoSpace 100 DX Residential Elevator\tKONE MonoSpace 100 DX dvigalo za stanovanjske stavbe',
    'Meta description\tAn affordable, compact residential elevator.\tCenovno dostopno in kompaktno dvigalo za stanovanjske stavbe.',
    'Headline\tKONE MonoSpace 100 DX\tKONE MonoSpace 100 DX',
    'Body\tSave valuable building space.\tPrihranite dragocen prostor v stavbi.'
  ].join('\n');

  var stillEnglish = '<!DOCTYPE html><html><head>' +
    '<title>KONE MonoSpace 100 DX Residential Elevator</title>' +
    '<meta name="description" content="An affordable, compact residential elevator.">' +
    '</head><body><main><h1>KONE MonoSpace 100 DX</h1>' +
    '<p>Save valuable building space.</p></main></body></html>';

  var r = comparer.compare(brief, stillEnglish, { workTypeId: 'localization' });

  assert.ok(cat(r, 'metadata').length >= 2, 'untranslated title and description should both be caught: ' + textOf(cat(r, 'metadata')));
  assert.ok(cat(r, 'body').some(function (x) { return /Prihranite/.test(x.expected); }),
    'the Slovenian body copy is missing from the page: ' + textOf(cat(r, 'body')));
});

// ─── URL identity ────────────────────────────────────────────────────────
// The same page has a different URL in every environment. Comparing raw URLs
// makes every link a deviation, which buries the ones that matter.

test('14a. an environment difference in a URL is not a deviation', function () {
  var briefPreview = BRIEF.replace(
    'URL Path: https://www.kone.in/blog/lift-safety-features',
    'URL Path: https://preview.kone.in/blog/lift-safety-features.aspx'
  );
  var d = cat(comparer.compare(briefPreview, CLEAN, { workTypeId: 'new-page' }), 'metadata');

  assert.strictEqual(d.length, 0,
    'preview/.aspx vs www/extensionless is the same page: ' + textOf(d));
});

test('14b. a genuinely different path is still a deviation', function () {
  var briefWrong = BRIEF.replace('/blog/lift-safety-features', '/blog/escalator-safety');
  var d = cat(comparer.compare(briefWrong, CLEAN, { workTypeId: 'new-page' }), 'metadata');

  assert.ok(d.some(function (x) { return /Canonical/.test(x.field); }),
    'a different path must still be caught: ' + textOf(d));
});

test('14c. pathOf strips scheme, host, extension and trailing slash — not the query', function () {
  assert.strictEqual(comparer.pathOf('https://preview.kone.in/services.aspx'), '/services');
  assert.strictEqual(comparer.pathOf('https://www.kone.in/services/'), '/services');
  assert.strictEqual(comparer.pathOf('/services'), '/services');
  assert.strictEqual(comparer.pathOf('https://www.kone.in/search?q=lift'), '/search?q=lift');
  // A directory page: index.aspx on Tridion, extensionless on AEM.
  assert.strictEqual(comparer.pathOf('https://preview.kone.si/services/index.aspx'), '/services');
  assert.notStrictEqual(comparer.pathOf('/services'), comparer.pathOf('/products'));
});

test('14d. a CTA pointing somewhere else is caught, across environments', function () {
  var brief = [
    'Meta title\tKONE\tKONE',
    'Headline\tConnectivity\tPovezljivost',
    'CTA\tLearn more\tVeč o tem',
    'CTA Link\t/digital-services/\t/digitalne-storitve/'
  ].join('\n');

  var right = '<html><head><title>KONE</title></head><body><main><h1>Povezljivost</h1>' +
    '<a href="https://preview.kone.si/digitalne-storitve/index.aspx">Več o tem</a></main></body></html>';
  var wrong = '<html><head><title>KONE</title></head><body><main><h1>Povezljivost</h1>' +
    '<a href="https://www.kone.si/kontakt/">Več o tem</a></main></body></html>';

  assert.strictEqual(cat(comparer.compare(brief, right, { workTypeId: 'localization' }), 'links').length, 0,
    'same destination in a different environment is not a deviation');
  assert.ok(cat(comparer.compare(brief, wrong, { workTypeId: 'localization' }), 'links')
    .some(function (x) { return /points somewhere else/.test(x.note); }),
    'a CTA pointing at the wrong page must be caught');
});

// ─── Asset identity and severity ─────────────────────────────────────────
// A DAM or Scene7 embed URL often carries none of the brief's asset name, so
// an unmatched asset fires on correct pages. It is a prompt to look, not a
// defect, and it must never outrank a real break.

test('14e. a cropped or renamed variant resolves to the same source asset', function () {
  var brief = BRIEF.replace('AEM Assets - KONE_Feat_Handrail_B_Landscape-004',
                            'AEM Assets - shutterstock2335854375');
  var main = CLEAN_MAIN.replace(
    '/content/dam/marketing/KONE_Feat_Handrail_B_Landscape-004.jpg',
    'https://kone.scene7.com/is/image/kone/shutterstock2335854375-1?$hero-desktop$'
  );
  var d = cat(comparer.compare(brief, page({ main: main }), { workTypeId: 'new-page' }), 'images');

  assert.strictEqual(d.length, 0, 'the -1 crop and the preset should not hide the asset: ' + textOf(d));
});

test('14f. an unmatched asset is a check, never a break', function () {
  var noImage = CLEAN_MAIN.replace(/<img[^>]*>/, '<img src="/content/dam/something-else.jpg" alt="Other">');
  var r = comparer.compare(BRIEF, page({ main: noImage }), { workTypeId: 'new-page' });
  var d = cat(r, 'images');

  var unmatched = d.filter(function (x) { return /resolves to this asset/.test(x.note); });
  assert.strictEqual(unmatched.length, 1, 'expected one unmatched asset: ' + textOf(d));
  assert.strictEqual(unmatched[0].severity, 'check', 'must not be a break');
  assert.ok(/check by eye/.test(unmatched[0].note), 'and should say why it may be a false alarm');
});

test('14g. every deviation carries a severity, and breaks sort above checks', function () {
  var main = CLEAN_MAIN
    .replace(/<img[^>]*>/, '<img src="/content/dam/something-else.jpg">')  // check + break (no alt)
    .replace('Modern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.',
             'Rewritten.');
  var r = comparer.compare(BRIEF, page({ main: main }), { workTypeId: 'new-page' });

  r.categories.forEach(function (c) {
    c.deviations.forEach(function (d) {
      assert.ok(d.severity === 'break' || d.severity === 'check',
        c.label + ' deviation has no severity: ' + JSON.stringify(d));
    });
    var severities = c.deviations.map(function (d) { return d.severity; });
    var firstCheck = severities.indexOf('check');
    if (firstCheck !== -1) {
      assert.strictEqual(severities.indexOf('break', firstCheck), -1,
        c.label + ' puts a break after a check: ' + severities.join(', '));
    }
  });

  assert.ok(r.breaks > 0 && r.checks > 0, 'expected both kinds: ' + r.breaks + ' breaks, ' + r.checks + ' checks');
});

// ─── Out of scope ────────────────────────────────────────────────────────

test('14. a redirect brief has no page to read, and the comparer says so', function () {
  var r = comparer.compare('Redirect /old to /new', CLEAN, { workTypeId: 'redirect' });

  assert.strictEqual(r.supported, false);
  assert.strictEqual(r.categories.length, 0, 'it must not invent deviations');
  assert.ok(/following the URL/i.test(r.note), 'and should say how to check it instead: ' + r.note);
});

// ─── Cross-cutting ───────────────────────────────────────────────────────

test('15. determinism — the same pair compares identically twice', function () {
  var first = comparer.compare(BRIEF, CLEAN, { workTypeId: 'new-page' });
  var second = comparer.compare(BRIEF, CLEAN, { workTypeId: 'new-page' });
  delete first.generatedAt; delete second.generatedAt;

  assert.deepStrictEqual(first, second);
});

test('16. all five categories are always reported, in the brief\'s order', function () {
  var r = comparer.compare(BRIEF, CLEAN, { workTypeId: 'new-page' });

  assert.deepStrictEqual(
    r.categories.map(function (c) { return c.id; }),
    ['metadata', 'body', 'images', 'links', 'structure']
  );
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

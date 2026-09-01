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
  // A category the tool withheld reported nothing, which is what the callers
  // asking "was this flagged?" mean by an empty list.
  var found = result.categories.filter(function (c) { return c.id === id; })[0];
  return found ? found.deviations : [];
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
    // og:title is the meta title; the <title> above is the page name. A
    // well-built page carries both, so the fixture does too.
    (parts.ogTitle === null ? '' :
      '<meta property="og:title" content="' + (parts.ogTitle || 'Lift Safety Features | KONE India') + '">') +
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

test('6. structure — a duplicated heading is caught, with or without a brief', function () {
  // Reported under Structure, not Body Text: the finding is about the shape of
  // the page, and it needs no brief to be true.
  var doubled = CLEAN_MAIN + '<h2>Emergency Braking Systems</h2><p>Duplicate block.</p>';
  var d = cat(comparer.compare(BRIEF, page({ main: doubled }), { workTypeId: 'new-page' }), 'structure');

  assert.ok(d.some(function (x) { return /more than once/.test(x.note); }), 'reported: ' + textOf(d));

  // Same page, a brief that names no sections at all.
  var bare = cat(comparer.compare('Nothing to say here.', page({ main: doubled }), { workTypeId: 'localization' }), 'structure');
  assert.ok(bare.some(function (x) { return /more than once/.test(x.note); }),
    'a page-only fault must not depend on the brief: ' + textOf(bare));
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

  assert.ok(d.some(function (x) { return /Page path/.test(x.field); }),
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

// ─── A comparison that never happened ────────────────────────────────────
// The bug this suite exists for: a real Portuguese brief and the real KONE
// Portugal page came back "No deviations" in all five categories, because the
// brief parsed to nothing and nothing compared against a page finds nothing.

test('14h. a brief that parses to nothing is reported unreadable, never clean', function () {
  var r = comparer.compare('a\nb\nc', CLEAN, { workTypeId: 'new-page' });

  assert.strictEqual(r.unreadable, true, 'must say it could not read the brief');
  assert.ok(/not a pass/i.test(r.note), 'and must say so in as many words: ' + r.note);
  r.categories.forEach(function (c) {
    assert.ok(c.deviations.length > 0,
      'a category with nothing in it renders as "No deviations" and reads as a pass: ' + c.label);
  });
});

test('14i. a localization brief written as prose still produces expectations', function () {
  var prose = [
    'Impulsione a sustentabilidade e reduza o consumo energético',
    'A KONE Modernization oferece-lhe um plano de ciclo de vida com melhorias inteligentes que prolongam a vida útil dos seus equipamentos.',
    'Até 74% de poupança de energia'
  ].join('\n');

  var r = comparer.compare(prose, CLEAN, { workTypeId: 'localization' });

  assert.strictEqual(r.unreadable, false, 'prose is readable');
  assert.strictEqual(r.mode, 'prose', 'and the mode is stated: ' + r.mode);
  assert.ok(r.expectations > 0);
  assert.ok(r.breaks > 0, 'copy that is not on the page must be reported');
});

test('14j. a tab-separated localization brief still parses by column', function () {
  var r = comparer.compare(
    'Meta title\tKONE\tKONE Portugal\nHeadline\tUpgrades\tModernizações\nBody\tFast\tRápida',
    CLEAN, { workTypeId: 'localization' });

  assert.strictEqual(r.mode, 'columns', 'got ' + r.mode);
});

// ─── Defects the page shows without any brief ────────────────────────────

test('14k. placeholder and link-less calls to action are caught', function () {
  var main = CLEAN_MAIN +
    '<div class="actions"><a class="ctalink" href="#">Saiba mais</a></div>' +
    '<div class="actions">Learn more</div>';
  var d = cat(comparer.compare(BRIEF, page({ main: main }), { workTypeId: 'new-page' }), 'links');

  assert.ok(d.some(function (x) { return /placeholder href/.test(x.note); }), 'href="#" missed: ' + textOf(d));
  assert.ok(d.some(function (x) { return /bare text with no link/.test(x.note); }), 'dead CTA missed: ' + textOf(d));
  d.forEach(function (x) { assert.strictEqual(x.severity, 'break', 'these are never intentional'); });
});

test('14l. an in-page anchor is a real destination, not a placeholder', function () {
  var main = CLEAN_MAIN + '<a href="#item-136420">Jump to the form</a>';
  var d = cat(comparer.compare(BRIEF, page({ main: main }), { workTypeId: 'new-page' }), 'links');

  assert.ok(!d.some(function (x) { return /placeholder/.test(x.note); }), 'reported: ' + textOf(d));
});

test('14m. a figure that contradicts its own caption is caught', function () {
  // Straight from the live page: the card reads 70% above "Até 74%".
  var main = CLEAN_MAIN +
    '<div class="highlight"><span>70%</span></div><h6>Até 74% de poupança energética.</h6>';
  var d = cat(comparer.compare(BRIEF, page({ main: main }), { workTypeId: 'new-page' }), 'body');
  var conflict = d.filter(function (x) { return /disagree/.test(x.note); })[0];

  assert.ok(conflict, 'reported: ' + textOf(d));
  assert.strictEqual(conflict.expected, '70%');
  assert.ok(/74%/.test(conflict.found), 'the caption should be quoted back: ' + conflict.found);
});

test('14n. a figure that agrees with its caption is not reported', function () {
  var main = CLEAN_MAIN +
    '<div class="highlight"><span>70%</span></div><h6>Até 70% de poupança energética.</h6>';
  var d = cat(comparer.compare(BRIEF, page({ main: main }), { workTypeId: 'new-page' }), 'body');

  assert.ok(!d.some(function (x) { return /disagree/.test(x.note); }), 'false alarm: ' + textOf(d));
});

test('14o. a lazy-loaded image resolves to the asset, not the placeholder', function () {
  var loader = '/Content/ajax-loader-big.gif?t=20260724';
  var real = 'https://s7g10.scene7.com/is/image/kone/2_2-9:760x428';

  ['<img data-src="' + real + '" src="' + loader + '" alt="a">',
   '<img src="' + loader + '" data-src="' + real + '" alt="a">'].forEach(function (tag) {
    var img = comparer.readPage('<html><body><main>' + tag + '</main></body></html>').images[0];
    assert.strictEqual(img.src, real, 'attribute order must not matter: ' + tag);
  });

  var plain = comparer.readPage('<html><body><main><img src="plain.jpg" alt="a"></main></body></html>').images[0];
  assert.strictEqual(plain.src, 'plain.jpg', 'a normal image is untouched');
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

// ─── PHASE 6 ─────────────────────────────────────────────────────────────
// The PORTUGAL brief and the real KONE Portugal page produced 78 findings, of
// which roughly three were real, and missed every defect that mattered. The
// cause was one decision: an Excel export quotes a cell that holds more than
// one paragraph, and splitting on newlines before honouring those quotes tore
// every such row in half.

var QUOTED_BRIEF = [
  'Meta title\tElevator Upgrades for Any Brand\tAtualize o seu elevador | KONE Portugal',
  'Meta description\tUpgrade your elevator\tModernize o seu elevador com a KONE.',
  'Headline\tModernise your elevator now\tModernize o seu elevador agora',
  'Body\t"Upgrade in time and save.',
  'Our modular packages install fast."\t"Atualizar o seu elevador atempadamente permite-lhe poupar tempo.',
  'Os nossos pacotes modulares são instalados rapidamente."',
  'CTA\tLearn more\tSaiba mais',
  'CTA Link\t/upgrades/\t/atualizacoes/'
].join('\n');

test('17. a quoted cell containing a newline stays one row', function () {
  var rows = comparer.splitRows('a\tb\nc\t"d\ne"\tf\n');

  assert.strictEqual(rows.length, 2, 'the quoted newline must not end the row');
  assert.deepStrictEqual(rows[0], ['a', 'b']);
  assert.strictEqual(rows[1][1], 'd\ne', 'and the value keeps its newline without the wrapping quotes');
});

test('18. "" inside a quoted cell is an escaped quote, not the end of it', function () {
  var rows = comparer.splitRows('label\t"he said ""hi"" today"\n');

  assert.strictEqual(rows[0][1], 'he said "hi" today');
});

test('19. a quote inside a cell is punctuation and does not open a quoted cell', function () {
  var rows = comparer.splitRows('label\tsize is 6" wide\tvalue\n');

  assert.strictEqual(rows.length, 1, 'the row must not swallow the rest of the brief');
  assert.strictEqual(rows[0][1], 'size is 6" wide');
});

test('20. a brief with quoted multi-line cells parses as columns, not prose', function () {
  var r = comparer.compare(QUOTED_BRIEF, CLEAN, { workTypeId: 'localization' });

  assert.strictEqual(r.mode, 'columns',
    'this fell to prose before, which is what generated every phantom finding');

  var expect = comparer.readBrief(QUOTED_BRIEF, 'localization');
  assert.strictEqual(expect.body.length, 1, 'the two-paragraph cell is one expectation, not two fragments');
  assert.ok(/poupar tempo[\s\S]*instalados rapidamente/.test(expect.body[0]),
    'and it carries both paragraphs: ' + JSON.stringify(expect.body));
  assert.ok(expect.body[0].indexOf('"') === -1, 'with no wrapping quote left on it');
});

test('20b. an anchor held back as a placeholder is not also reported as missing', function () {
  var brief = 'CTA\tLearn more\tSaiba mais\nCTA Link\t/a/\t/b/';
  var page = '<html><body><main><p>Copy.</p><a href="#">Saiba mais</a></main></body></html>';

  var devs = cat(comparer.compare(brief, page, { workTypeId: 'localization' }), 'links');
  var missing = devs.filter(function (d) { return /not found/.test(d.note); });

  assert.strictEqual(missing.length, 0, 'one broken anchor is one finding: ' + textOf(devs));
  assert.ok(/placeholder/.test(textOf(devs)), 'and it is still reported: ' + textOf(devs));
});

test('21. metadata is read from a localization brief and compared word for word', function () {
  var r = comparer.compare(QUOTED_BRIEF, CLEAN, { workTypeId: 'localization' });
  var devs = cat(r, 'metadata');

  assert.ok(/Atualize o seu elevador/.test(textOf(devs)),
    'the brief\'s Portuguese meta title must be checked against the page: ' + textOf(devs));
});

test('22. a brief that defines no metadata says so, and never "No deviations"', function () {
  var prose = [
    'Impulsione a sustentabilidade e reduza o consumo energético do seu edifício hoje.',
    'A KONE Modernization oferece um plano de ciclo de vida com melhorias inteligentes.'
  ].join('\n');

  var r = comparer.compare(prose, CLEAN, { workTypeId: 'localization' });
  var metadata = r.categories.filter(function (c) { return c.id === 'metadata'; })[0];

  assert.strictEqual(metadata.deviations.length, 0);
  assert.ok(metadata.note, 'an unchecked category must carry a note, not read as clean');
  assert.ok(/not a pass/i.test(metadata.note), metadata.note);
  assert.deepStrictEqual(r.metadataChecked, [], 'and nothing was checked');
});

test('23. metadata the brief does define is reported as checked', function () {
  var r = comparer.compare(BRIEF, CLEAN, { workTypeId: 'new-page' });
  var metadata = r.categories.filter(function (c) { return c.id === 'metadata'; })[0];

  assert.ok(r.metadataChecked.length > 0, 'fields were compared: ' + r.metadataChecked);
  assert.ok(!metadata.note, 'so there must be no "nothing checked" note');
});

test('24. prose mode asserts nothing about structure', function () {
  var prose = [
    'PORTUGAL',
    '80%',
    'Saiba mais',
    'Atualizar o seu elevador atempadamente permite-lhe poupar tempo e evitar complicações.'
  ].join('\n');

  var expect = comparer.readBrief(prose, 'localization');

  assert.strictEqual(expect.mode, 'prose');
  assert.deepStrictEqual(expect.sections, [],
    'PORTUGAL, 80% and Saiba mais are not section headings and must not be demanded as any');
});

test('25. a paragraph the page splits across elements resolves sentence by sentence', function () {
  var page = '<html><body><main>' +
    '<p>Atualizar o seu elevador atempadamente permite-lhe poupar tempo.</p>' +
    '<p>Os nossos pacotes modulares são instalados rapidamente.</p>' +
    '</main></body></html>';
  var brief = 'Atualizar o seu elevador atempadamente permite-lhe poupar tempo. ' +
    'Os nossos pacotes modulares são instalados rapidamente.';

  var r = comparer.compare(brief, page, { workTypeId: 'localization' });

  assert.deepStrictEqual(cat(r, 'body'), [],
    'both sentences are on the page, so nothing is missing: ' + textOf(cat(r, 'body')));
});

test('26. an orphan quote from a torn cell does not fail a paragraph that is present', function () {
  var page = '<html><body><main><p>Os nossos pacotes modulares são instalados rapidamente.</p></main></body></html>';
  var brief = 'Os nossos pacotes modulares são instalados rapidamente."';

  assert.deepStrictEqual(cat(comparer.compare(brief, page, { workTypeId: 'localization' }), 'body'), []);
});

test('27. copy genuinely absent from the page is still a break', function () {
  var page = '<html><body><main><p>Something else entirely on the page.</p></main></body></html>';
  var brief = 'Os nossos pacotes modulares são instalados rapidamente e sem incómodos.';

  var devs = cat(comparer.compare(brief, page, { workTypeId: 'localization' }), 'body');

  assert.strictEqual(devs.length, 1, textOf(devs));
  assert.strictEqual(devs[0].severity, 'break');
});

test('28. failing nearly every expectation warns about the brief, and still shows it', function () {
  var rows = [];
  for (var i = 0; i < 10; i++) {
    rows.push('Body\tEnglish master ' + i + '\tTexto localizado que nunca aparece na página ' + i + '.');
  }
  var r = comparer.compare(rows.join('\n'), CLEAN, { workTypeId: 'localization' });

  assert.strictEqual(r.suspectParse, true, 'a near-total miss still points at the brief');
  assert.ok(/read wrongly/i.test(r.parseNote), r.parseNote);
  assert.ok(cat(r, 'body').length > 0,
    'but the findings are shown, because the count is what explains them');
  assert.strictEqual(r.coverage.missing, r.coverage.total, 'nothing was found: ' + JSON.stringify(r.coverage));
});

test('29. page-only findings report alongside a suspect parse', function () {
  var rows = [];
  for (var i = 0; i < 10; i++) {
    rows.push('Body\tEnglish master ' + i + '\tTexto localizado que nunca aparece na página ' + i + '.');
  }
  var page = '<html><body><main><p>Unrelated.</p><a href="#">Saiba mais</a></main></body></html>';

  var r = comparer.compare(rows.join('\n'), page, { workTypeId: 'localization' });

  assert.strictEqual(r.suspectParse, true);
  assert.ok(/placeholder/i.test(textOf(cat(r, 'links'))),
    'the href="#" needs no brief to be wrong: ' + textOf(cat(r, 'links')));
});

test('29b. coverage counts what the brief asked for and what landed', function () {
  var rows = [
    'Headline\tMaster\tEmergency Braking Systems',
    'Body\tMaster\tModern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.',
    'Body\tMaster\tEsta frase nunca aparece na página de forma alguma.'
  ];
  var r = comparer.compare(rows.join('\n'), CLEAN, { workTypeId: 'localization' });

  assert.strictEqual(r.coverage.total, r.coverage.found + r.coverage.missing, JSON.stringify(r.coverage));
  assert.strictEqual(r.coverage.missing, 1, 'one line is genuinely absent: ' + JSON.stringify(r.coverage));
  assert.strictEqual(r.coverage.complete, false);
});

test('29c. a brief entirely present on the page reports complete coverage', function () {
  var rows = [
    'Headline\tMaster\tEmergency Braking Systems',
    'Headline\tMaster\tDoor Safety Sensors',
    'Body\tMaster\tModern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.'
  ];
  var r = comparer.compare(rows.join('\n'), CLEAN, { workTypeId: 'localization' });

  assert.strictEqual(r.coverage.complete, true, 'everything the brief asked for is there');
  assert.strictEqual(r.coverage.missing, 0);
  assert.strictEqual(r.coverage.found, r.coverage.total);
});

test('30. a page failing only some of its expectations is a normal report', function () {
  // Half the rows are on the page and half are not — an ordinary result, and
  // the guard must not swallow it. The threshold exists for a misread brief,
  // not for a page with real defects on it.
  var rows = [
    'Headline\tMaster\tEmergency Braking Systems',
    'Headline\tMaster\tDoor Safety Sensors',
    'Body\tMaster\tThese systems automatically activate if the elevator exceeds its designated speed or detects an abnormal condition.',
    'Body\tMaster\tModern lifts use advanced door sensors that detect people or objects in the doorway before the doors close.',
    'Body\tMaster\tIn a high-rise building, elevators are among the most heavily used systems and residents depend on them every day.'
  ];
  for (var i = 0; i < 5; i++) rows.push('Body\tMaster\tEsta frase localizada nunca aparece na página, número ' + i + '.');

  var r = comparer.compare(rows.join('\n'), CLEAN, { workTypeId: 'localization' });

  assert.ok(r.expectations >= 8, 'expectations: ' + r.expectations);
  assert.ok(!r.parseFailed, 'half missing is well under the threshold, so the findings stand');
  assert.ok(r.breaks > 0, 'and the real misses are still reported');
});

test('31. "Back to top" is not reported as a placeholder link', function () {
  var page = '<html><body><main><p>Copy.</p><a href="#">Back to top</a></main></body></html>';

  var devs = cat(comparer.compare(BRIEF, page, { workTypeId: 'new-page' }), 'links');

  assert.ok(!/Back to top/.test(textOf(devs)), 'that anchor is correct as written: ' + textOf(devs));
});

test('32. an accordion toggle on href="#" is not reported either', function () {
  var page = '<html><body><main><a href="#" aria-expanded="false">Perguntas frequentes</a></main></body></html>';

  var devs = cat(comparer.compare(BRIEF, page, { workTypeId: 'new-page' }), 'links');

  assert.ok(!/Perguntas frequentes/.test(textOf(devs)), textOf(devs));
});

test('33. a real placeholder CTA is still reported', function () {
  var page = '<html><body><main><a href="#">Saiba mais</a></main></body></html>';

  var devs = cat(comparer.compare(BRIEF, page, { workTypeId: 'new-page' }), 'links');

  assert.ok(/Saiba mais/.test(textOf(devs)), 'this one was never wired up: ' + textOf(devs));
});

test('34. a stat and its caption are matched across real template markup', function () {
  // The window used to be counted in raw characters, so the wrapper divs on a
  // real card pushed the caption out of range and the contradiction went
  // unreported on the very page it was built for.
  var wrappers = '<div class="col-md-4 proof-point-card text-center" data-component="proof-point">' +
    '<div class="proof-point-card-inner-wrapper">'.repeat(12);
  var page = '<html><body><main><span>70%</span>' + wrappers +
    '<h6>Até 74% de poupança energética.</h6></main></body></html>';

  var conflicts = comparer.readPage(page).statConflicts;

  assert.strictEqual(conflicts.length, 1, 'markup between them is not distance: ' + JSON.stringify(conflicts));
  assert.strictEqual(conflicts[0].figure, '70%');
});

test('35. a percentage far away in reading order is not treated as a caption', function () {
  var page = '<html><body><main><span>70%</span><p>' +
    new Array(70).join('palavra ') + '</p><h6>Até 74% de poupança.</h6></main></body></html>';

  assert.deepStrictEqual(comparer.readPage(page).statConflicts, [],
    'unrelated figures elsewhere on the page must not pair up');
});

// The 70%/74% contradiction on the real KONE Portugal page went unreported
// through two rounds of fixes, because the detector kept depending on which
// elements the template wrapped the figure in. It no longer looks at tags.

var STAT_CAPTION = '<h6>Até 74% de poupança energética.</h6>';

function statsIn(markup) {
  return comparer.readPage('<html><body><main>' + markup + '</main></body></html>').statConflicts;
}

test('36. a contradicting figure is caught whatever markup holds it', function () {
  var shapes = {
    'a span': '<span>70%</span>',
    'a heading': '<h2>70%</h2>',
    'a heading the old tag list left out': '<h4><strong>70%</strong></h4>',
    'nested elements': '<div class="big"><span>70%</span></div>',
    'the percent sign styled separately': '<span>70</span><span>%</span>',
    'a non-breaking space before the sign': '<span>70&nbsp;%</span>',
    'a link around the figure': '<a href="/x"><span>70%</span></a>'
  };

  Object.keys(shapes).forEach(function (name) {
    var found = statsIn(shapes[name] + STAT_CAPTION);
    assert.strictEqual(found.length, 1, 'missed when the figure sits in ' + name);
    assert.strictEqual(found[0].figure, '70%');
  });
});

test('37. wrapper markup between a figure and its caption is not distance', function () {
  var wrappers = '<div class="proof-point-card-inner-wrapper text-center">'.repeat(14);

  assert.strictEqual(statsIn('<h2>70%</h2>' + wrappers + STAT_CAPTION).length, 1);
});

test('38. a figure that agrees with its caption is never reported', function () {
  assert.deepStrictEqual(statsIn('<h2>74%</h2>' + STAT_CAPTION), []);
});

test('39. a row of bare figures is not a figure and a caption', function () {
  // Reading text instead of tags makes a data table look like a stat card
  // followed by a different number. It is not, and must stay silent.
  assert.deepStrictEqual(statsIn('<table><tr><td>70%</td><td>74%</td><td>88%</td></tr></table>'), []);
  assert.deepStrictEqual(statsIn('<table><tr><td>70%</td><td>74%</td><td>Energy</td></tr></table>'), []);
});

test('40. consecutive stat cards do not caption each other', function () {
  var cards =
    '<div><span>70%</span><h6>Até 70% de poupança.</h6></div>' +
    '<div><span>88%</span><h6>Até 88% mais rápido.</h6></div>';

  assert.deepStrictEqual(statsIn(cards), []);
});

test('41. percentages in running prose are not stat cards', function () {
  assert.deepStrictEqual(statsIn('<p>Reduza o consumo em 70% e melhore 74% da eficiência.</p>'), []);
});

test('42. an unreadable brief still reports what the page says about itself', function () {
  var page = '<html><body><main><h2>Repetido</h2><h2>Repetido</h2>' +
    '<a href="#">Saiba mais</a><span>70%</span><h6>Até 74% de poupança.</h6></main></body></html>';

  var r = comparer.compare('x\ny\nz', page, { workTypeId: 'new-page' });

  assert.strictEqual(r.unreadable, true);
  assert.ok(r.breaks > 0, 'these need no brief to be true');
  var all = textOf(r.categories);
  assert.ok(/more than once/.test(all), all);
  assert.ok(/placeholder/.test(all), all);
  assert.ok(/disagree/.test(all), all);
});

// og:title, the window title and the URL's last segment are three different
// fields. They were treated as one, so the brief's meta title was compared
// against the window title and og:title was never read at all.

test('43. og:title is the meta title and the window title is the page name', function () {
  var p = comparer.readPage(
    '<html><head><title>Elevator Upgrades - KONE Portugal</title>' +
    '<meta property="og:title" content="Atualize o seu elevador">' +
    '<link rel="canonical" href="https://preview.kone.pt/predios-existentes/elevator-upgrades/">' +
    '</head><body><main><p>x</p></main></body></html>');

  assert.strictEqual(p.metaTitle, 'Atualize o seu elevador');
  assert.strictEqual(p.pageName, 'Elevator Upgrades - KONE Portugal');
  assert.strictEqual(p.pagePath, 'elevator-upgrades');
});

test('44. a page with no og:title does not borrow the window title for it', function () {
  var p = comparer.readPage('<html><head><title>Only a window title</title></head><body><main><p>x</p></main></body></html>');

  assert.strictEqual(p.metaTitle, null, 'absent means absent');
  assert.strictEqual(p.pageName, 'Only a window title');
});

test('45. the brief meta title is compared against og:title, not the window title', function () {
  // The two differ, and only og:title matches the brief. Comparing against the
  // window title — as it used to — would report a defect that is not there.
  var html = page({ main: CLEAN_MAIN, title: 'Something else entirely' });
  var d = cat(comparer.compare(BRIEF, html, { workTypeId: 'new-page' }), 'metadata');

  assert.ok(!d.some(function (x) { return x.field === 'Meta title' && x.severity === 'break'; }),
    'og:title matches the brief, so this is not a defect: ' + textOf(d));
});

test('46. a page missing og:title is a check, not a break', function () {
  var html = page({ main: CLEAN_MAIN, ogTitle: null });
  var d = cat(comparer.compare(BRIEF, html, { workTypeId: 'new-page' }), 'metadata');
  var found = d.filter(function (x) { return x.field === 'Meta title'; })[0];

  assert.ok(found, 'the absence is worth reporting: ' + textOf(d));
  assert.strictEqual(found.severity, 'check', 'but plenty of templates ship no Open Graph');
  assert.ok(/window title/.test(found.note), found.note);
});

test('47. metadata is listed even when the brief defines none of it', function () {
  var prose = 'Impulsione a sustentabilidade e reduza o consumo energético do seu edifício.';
  var r = comparer.compare(prose, CLEAN, { workTypeId: 'localization' });
  var metadata = r.categories.filter(function (c) { return c.id === 'metadata'; })[0];

  assert.ok(metadata.rows && metadata.rows.length, 'the author must be able to see what the page carries');

  var byField = {};
  metadata.rows.forEach(function (row) { byField[row.field] = row; });

  ['Meta title', 'Page name', 'Page path'].forEach(function (field) {
    assert.ok(byField[field], field + ' must always be listed');
    assert.strictEqual(byField[field].state, 'not-in-brief', field + ' is not in this brief');
    assert.ok(byField[field].found, field + ' must still show what is on the page: ' + JSON.stringify(byField[field]));
  });
});

test('48. page path is shown as a segment but compared as a whole path', function () {
  var r = comparer.compare(BRIEF, CLEAN, { workTypeId: 'new-page' });
  var row = r.categories[0].rows.filter(function (x) { return x.field === 'Page path'; })[0];

  assert.strictEqual(row.found, 'lift-safety-features', 'displayed as the segment');
  assert.strictEqual(row.state, 'matches', 'and matched against the full canonical');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

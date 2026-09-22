// test/page-model.test.js — turning a parsed brief into a neutral page model.
// Run: npm test
//
// The failure that matters here is a component invented from a brief that
// never asked for it — a campaign brief with no page copy must produce zero
// components, not a plausible-looking hero. Every component that IS
// produced must show its evidence: which rows, and why.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var PageModel = require('../page-model.js');

var workTypesJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'work-types.json'), 'utf8')
);
var mockComponentsJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'config', 'mock-components.json'), 'utf8')
);

var pm = PageModel.create({ 'work-types': workTypesJson });
var pmWithFile = PageModel.create({ 'work-types': workTypesJson, 'mock-components': mockComponentsJson });

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// ─── FIXTURES ────────────────────────────────────────────────────────────

// A real campaign brief (converted from an actual KONE landing-page brief):
// market, line, target searches, URL, sources, verification notes — and no
// page copy whatsoever.
var CAMPAIGN_BRIEF = [
  'Market\tItaly',
  'Line\tNBS',
  'Copy language\tItalian, informal tu',
  'Target searches\tascensore ospedale, montalettighe, ascensori RSA / cliniche',
  'Monthly search volumes\tmontalettighe 260, ascensore ospedale 20',
  'URL Path\thttps://www.kone.it/nuovi-edifici/ascensori/sanita/',
  'Sources\thttps://www.kone.it/nuovi-edifici/ascensori/ https://www.kone.it/nuovi-edifici/ascensori/kone-transys-dx/',
  'Verification notes\tThe copy is built on the published KONE TranSys DX content. If KONE can share healthcare-specific material, the page can be enriched with a dedicated section.'
].join('\n');

// fields-by-market: rows are content fields, columns are markets, a real
// market header row present. Two sections, so grouping can be checked.
var FIELDS_BY_MARKET_BRIEF = [
  'Level 2\tSPAIN',
  'Field\tEnglish\tSPAIN\tITALY',
  'Hero section',
  'Headline\tKONE MonoSpace 100 DX\tKONE MonoSpace 100 DX ES\tKONE MonoSpace 100 DX IT',
  'Subheading\tSave space and gain design freedom\tAhorre espacio y gane libertad de diseño\tRisparmia spazio e guadagna libertà di design',
  'Content block',
  'Body\tWith a compact motor, energy use is reduced.\tCon un motor compacto, se reduce el consumo.\tCon un motore compatto, si riduce il consumo.',
  'CTA\tLearn more\tMás información\tScopri di più'
].join('\n');

// fields-by-market with no market header row at all — the SLOVENIA shape
// filler.js already handles via its no-config fallback.
var NO_HEADER_BRIEF = [
  'Headline\tKONE MonoSpace 100 DX\tKONE MonoSpace 100 DX',
  'Subheading\tSave space\tPrihranite prostor',
  'Body\tCompact motor reduces energy use.\tKompakten motor zmanjša porabo energije.'
].join('\n');

// markets-by-field: the transpose — one row per market, one column per
// field. Body cells deliberately long enough to read as prose.
var MARKETS_BY_FIELD_BRIEF = [
  'Country\tLanguages\tHeader text translated\tBody text translated',
  'Bulgaria\tBulgarian\tЗащита на данни\tТова е дълъг параграф с повече от четиридесет знака за да мине проверката за проза, ясно достатъчно дълъг текст.',
  'Croatia\tCroatian\tZaštita podataka\tOvo je dulji odlomak s više od četrdeset znakova kako bi prošao provjeru za prozu, dovoljno dug tekst za provjeru.',
  'Germany\tGerman\tDatenschutz\tDies ist ein längerer Absatz mit mehr als vierzig Zeichen, um die Prosa-Prüfung zu bestehen, ausreichend langer Text.'
].join('\n');

// labelled: a stray paragraph before any heading marker, then a proper
// section — the ambiguous-row case.
var AMBIGUOUS_BRIEF = [
  'URL Path\thttps://www.kone.com/example/',
  'This is a stray paragraph of body copy that appears before any numbered heading marker in the brief, so it genuinely has nowhere to attach',
  'Product overview[1.0]',
  'KONE MonoSpace DX is a compact elevator solution designed for modern buildings with limited space for machinery.'
].join('\n');

// labelled: one real content section, one section named for page chrome.
var CHROME_BRIEF = [
  'URL Path\thttps://www.kone.com/example2/',
  'Introduction to KONE elevators[1.0]',
  'KONE elevators are designed for reliability across a wide range of building types and usage patterns worldwide.',
  'Footer[2.0]',
  'Contact us at the number listed below for more information about our elevator maintenance services today.'
].join('\n');

function allComponents(models) {
  var out = [];
  models.forEach(function (m) { out = out.concat(m.components); });
  return out;
}

// ─── TESTS ───────────────────────────────────────────────────────────────

test('1. a metadata-only campaign brief yields metadata and zero components', function () {
  var model = pm.build(CAMPAIGN_BRIEF, {});

  assert.strictEqual(model.components.length, 0,
    'no page copy in this brief — nothing should be typed as a component: ' + JSON.stringify(model.components));
  assert.strictEqual(model.page.path, 'https://www.kone.it/nuovi-edifici/ascensori/sanita/');
  assert.strictEqual(model.unresolved.length, 0,
    'every row here is recognised job metadata, not ambiguous content: ' + JSON.stringify(model.unresolved));
});

test('2. a fields-by-market brief groups rows by section into components', function () {
  var model = pm.build(FIELDS_BY_MARKET_BRIEF, { market: 'SPAIN' });

  assert.strictEqual(model.orientation, 'fields-by-market');
  assert.strictEqual(model.components.length, 2, JSON.stringify(model.components));
  assert.strictEqual(model.components[0].type, 'hero');
  assert.strictEqual(model.components[0].heading, 'KONE MonoSpace 100 DX ES');
  assert.strictEqual(model.components[1].type, 'content');
});

test('3. a named section wins over shape — high confidence, evidence quoted', function () {
  var model = pm.build(FIELDS_BY_MARKET_BRIEF, { market: 'SPAIN' });
  var hero = model.components[0];

  assert.strictEqual(hero.confidence, 'high');
  assert.ok(/Hero section/.test(hero.why), hero.why);
});

test('4. switching the market changes text and nothing else', function () {
  var es = pm.build(FIELDS_BY_MARKET_BRIEF, { market: 'SPAIN' });
  var it = pm.build(FIELDS_BY_MARKET_BRIEF, { market: 'ITALY' });

  assert.strictEqual(es.components[0].heading, 'KONE MonoSpace 100 DX ES');
  assert.strictEqual(it.components[0].heading, 'KONE MonoSpace 100 DX IT');
  assert.strictEqual(es.components[0].type, it.components[0].type);
  assert.strictEqual(es.components[0].confidence, it.components[0].confidence);
  assert.deepStrictEqual(es.components[0].sourceRows, it.components[0].sourceRows);
  assert.deepStrictEqual(es.components[1].sourceRows, it.components[1].sourceRows);
});

test('5. a brief with no market header row still reads as one section', function () {
  var model = pm.build(NO_HEADER_BRIEF, {});

  assert.strictEqual(model.orientation, 'fields-by-market');
  assert.strictEqual(model.components.length, 1, JSON.stringify(model.components));
  assert.deepStrictEqual(model.components[0].sourceRows, [1, 2, 3],
    'sourceRows must be 1-based, matching the brief\'s own line numbers');
});

test('6. a markets-by-field brief resolves the selected market\'s own row', function () {
  var model = pm.build(MARKETS_BY_FIELD_BRIEF, { market: 'Bulgaria' });

  assert.strictEqual(model.orientation, 'markets-by-field');
  assert.strictEqual(model.components.length, 1, JSON.stringify(model.components));
  assert.strictEqual(model.components[0].heading, 'Защита на данни');
  assert.ok(/^Това/.test(model.components[0].body[0]));
});

test('7. markets-by-field switches cleanly between markets', function () {
  var bg = pm.build(MARKETS_BY_FIELD_BRIEF, { market: 'Bulgaria' });
  var de = pm.build(MARKETS_BY_FIELD_BRIEF, { market: 'Germany' });

  assert.strictEqual(bg.components[0].heading, 'Защита на данни');
  assert.strictEqual(de.components[0].heading, 'Datenschutz');
  assert.notDeepStrictEqual(bg.components[0].sourceRows, de.components[0].sourceRows,
    'each market\'s row is a different line in the brief');
});

test('8. content before any heading is unresolved, not guessed into a component', function () {
  var model = pm.build(AMBIGUOUS_BRIEF, {});

  assert.strictEqual(model.unresolved.length, 1, JSON.stringify(model.unresolved));
  assert.ok(/before any heading/.test(model.unresolved[0].why), model.unresolved[0].why);
  assert.strictEqual(model.components.length, 1);
  assert.strictEqual(model.components[0].heading, 'Product overview');
});

test('9. a row naming page chrome is dropped with a stated reason, not rendered', function () {
  var model = pm.build(CHROME_BRIEF, {});

  assert.strictEqual(model.components.length, 1, JSON.stringify(model.components));
  assert.strictEqual(model.components[0].heading, 'Introduction to KONE elevators');
  var chromeEntry = model.unresolved.filter(function (u) { return /Footer/.test(u.text); })[0];
  assert.ok(chromeEntry, JSON.stringify(model.unresolved));
  assert.ok(/chrome/.test(chromeEntry.why), chromeEntry.why);
});

test('10. every component carries sourceRows, confidence and why — no silent typing', function () {
  var models = [
    pm.build(FIELDS_BY_MARKET_BRIEF, { market: 'SPAIN' }),
    pm.build(NO_HEADER_BRIEF, {}),
    pm.build(MARKETS_BY_FIELD_BRIEF, { market: 'Croatia' }),
    pm.build(AMBIGUOUS_BRIEF, {}),
    pm.build(CHROME_BRIEF, {})
  ];
  var components = allComponents(models);
  assert.ok(components.length >= 5, 'expected several components across fixtures, got ' + components.length);

  components.forEach(function (c) {
    assert.ok(c.type, 'a component with no type: ' + JSON.stringify(c));
    assert.ok(c.confidence === 'high' || c.confidence === 'medium' || c.confidence === 'low',
      'bad confidence on ' + c.type + ': ' + c.confidence);
    assert.ok(c.why && c.why.length > 0, 'a component with no evidence: ' + JSON.stringify(c));
    assert.ok(Array.isArray(c.sourceRows) && c.sourceRows.length > 0,
      'a component with no source rows: ' + JSON.stringify(c));
    c.sourceRows.forEach(function (r) {
      assert.ok(typeof r === 'number' && r >= 1, 'source row must be 1-based: ' + r);
    });
  });
});

test('11. an unrecognised section falls to a generic component, marked for review', function () {
  var brief = [
    'URL Path\thttps://www.kone.com/example3/',
    'Xyzzy widget zone[1.0]',
    'Some copy that does not match any recognised component signal or shape at all here today.'
  ].join('\n');
  var model = pm.build(brief, {});

  assert.strictEqual(model.components.length, 1);
  assert.strictEqual(model.components[0].type, 'content',
    'a heading with a body paragraph reads as content by shape even with an odd heading name');
});

test('12. config/mock-components.json matches the built-in defaults it exists to override', function () {
  var withDefaults = pm.build(FIELDS_BY_MARKET_BRIEF, { market: 'SPAIN' });
  var withFile = pmWithFile.build(FIELDS_BY_MARKET_BRIEF, { market: 'SPAIN' });

  assert.strictEqual(withDefaults.components[0].type, withFile.components[0].type);
  assert.strictEqual(withDefaults.components[1].type, withFile.components[1].type);
});

test('13. a repeating title/body shape reads as a card group without any label vocabulary', function () {
  // Deliberate scope limit: readBrief's labelled parser strips each
  // heading's own [n.m] marker before this module ever sees it, so the
  // h1/h2/h3 hierarchy that would separate a section's own heading from
  // its card children is gone by the time it gets here. Detection works on
  // shape alone — a run of consecutive heading+short-body leaves reads as
  // one card group, whether or not one of them was "the section title".
  var brief = [
    'URL Path\thttps://www.kone.com/example4/',
    'Reliability[1.0]',
    'Our elevators are built to run for decades with minimal downtime across every market we serve.',
    'Safety[1.1]',
    'Every KONE elevator meets or exceeds the safety standards required in its market of installation.',
    'Support[1.2]',
    'Our technical support line is available around the clock for every customer who needs assistance.'
  ].join('\n');
  var model = pm.build(brief, {});

  var cards = model.components.filter(function (c) { return c.type === 'cards'; })[0];
  assert.ok(cards, JSON.stringify(model.components));
  assert.strictEqual(cards.items.length, 3, JSON.stringify(cards.items));
  assert.strictEqual(cards.confidence, 'medium');
  assert.strictEqual(model.components.length, 1,
    'the whole run folds into one cards component, not three separate content blocks: ' + JSON.stringify(model.components));
});

test('14. question-shaped headings read as an accordion', function () {
  var brief = [
    'URL Path\thttps://www.kone.com/example5/',
    'What elevator suits a hospital?[1.0]',
    'KONE recommends TranSys DX for very high traffic buildings such as hospitals, built to last.',
    'Is a machine room required?[1.1]',
    'No, TranSys DX uses the KONE EcoDisc motor and needs no machine room at all in the building.'
  ].join('\n');
  var model = pm.build(brief, {});

  var accordion = model.components.filter(function (c) { return c.type === 'accordion'; })[0];
  assert.ok(accordion, JSON.stringify(model.components));
  assert.strictEqual(accordion.items.length, 2);
  assert.strictEqual(accordion.items[0].question, 'What elevator suits a hospital?');
});

test('15. front-matter Internal Links become a CTA group, not unresolved', function () {
  // Internal Links are declared in front matter, so by row order they
  // always sit before the first heading — that is not the same as being
  // orphaned. Found reviewing the real landing-page brief fixtures below.
  var brief = [
    'URL Path\thttps://www.kone.si/kone-monospace-100-dx/',
    'Internal Links\t●\thttps://www.kone.si/studio/tool/',
    '●\thttps://www.kone.si/edifici-esistenti/ascensori-modernizzazione/',
    'KONE MonoSpace 100 DX[1.0]',
    'Save valuable space and gain greater design freedom with our machine-roomless elevator today.'
  ].join('\n');
  var model = pm.build(brief, {});

  var cta = model.components.filter(function (c) { return c.type === 'cta'; })[0];
  assert.ok(cta, JSON.stringify(model.components));
  assert.strictEqual(cta.links.length, 2, JSON.stringify(cta.links));
  assert.strictEqual(model.unresolved.length, 0, JSON.stringify(model.unresolved));
});

test('16. the eleven real campaign briefs never invent a component', function () {
  var dir = path.join(__dirname, 'fixtures', 'landing-pages-briefs');
  var files = fs.readdirSync(dir).filter(function (f) { return /^\d\d-/.test(f) && f !== '12-monospace-100dx-content-brief.brief.txt'; });
  assert.strictEqual(files.length, 11, 'expected all eleven campaign brief fixtures: ' + JSON.stringify(files));

  files.forEach(function (f) {
    var text = fs.readFileSync(path.join(dir, f), 'utf8');
    var model = pm.build(text, {});
    assert.strictEqual(model.components.length, 0,
      f + ': a campaign brief with no page copy produced a component: ' + JSON.stringify(model.components));
    assert.ok(model.page.path, f + ': the declared URL should still populate page.path');
  });
});

test('17. the content brief predicts hero, cards, accordion and cta together', function () {
  var text = fs.readFileSync(
    path.join(__dirname, 'fixtures', 'landing-pages-briefs', '12-monospace-100dx-content-brief.brief.txt'), 'utf8');
  var model = pm.build(text, {});

  var types = model.components.map(function (c) { return c.type; });
  assert.deepStrictEqual(types.slice().sort(), ['accordion', 'cards', 'cta', 'hero']);
  assert.strictEqual(model.unresolved.length, 0, JSON.stringify(model.unresolved));
});

// ─── buildFromPage — the same model, read from an existing page ──────────

var MARKER_PAGE = fs.readFileSync(path.join(__dirname, 'fixtures', 'kone-si-monospace-100dx.html'), 'utf8');
var LIVE_FAQ_PAGE = fs.readFileSync(path.join(__dirname, 'fixtures', 'kone-in-elevator-types-faq.html'), 'utf8');
var LANDING_PAGE = fs.readFileSync(path.join(__dirname, 'fixtures', 'kone-it-healthcare-landing.html'), 'utf8');

test('18. a page with real Component Field markers is read at high confidence', function () {
  var model = pm.buildFromPage(MARKER_PAGE, {});
  assert.strictEqual(model.origin, 'page');
  assert.ok(model.components.length >= 5, JSON.stringify(model.components.map(function (c) { return c.type; })));

  var hero = model.components.filter(function (c) { return c.type === 'hero'; })[0];
  assert.ok(hero, 'expected a hero component from the HeroBanner module');
  assert.strictEqual(hero.confidence, 'high');
  assert.ok(/Component Field markers/.test(hero.why), hero.why);
  assert.ok(hero.sourceModule && hero.sourceModule.anchor, JSON.stringify(hero.sourceModule));
});

test('19. repeating authored fields become items, not one blob of text', function () {
  var model = pm.buildFromPage(MARKER_PAGE, {});
  var cards = model.components.filter(function (c) { return c.type === 'cards'; })[0];
  assert.ok(cards, JSON.stringify(model.components));
  assert.ok(cards.items.length >= 2, JSON.stringify(cards.items));

  var accordion = model.components.filter(function (c) { return c.type === 'accordion'; })[0];
  assert.ok(accordion, JSON.stringify(model.components));
  assert.ok(accordion.items.length >= 2 && accordion.items[0].question, JSON.stringify(accordion.items));
});

test('20. page chrome (Breadcrumbs) is dropped from a marker-bearing page, not rendered', function () {
  var model = pm.buildFromPage(MARKER_PAGE, {});
  assert.ok(!model.components.some(function (c) { return /breadcrumb/i.test(c.heading || ''); }));
  assert.ok(model.unresolved.some(function (u) { return /Breadcrumbs/i.test(u.text) && /chrome/.test(u.why); }),
    JSON.stringify(model.unresolved));
});

test('21. a live page with no markers still resolves its component via the CSS-class map', function () {
  var model = pm.buildFromPage(LIVE_FAQ_PAGE, {});
  assert.strictEqual(model.components.length, 1, JSON.stringify(model.components));
  assert.strictEqual(model.components[0].type, 'accordion');
  assert.strictEqual(model.components[0].confidence, 'high');
  assert.ok(/CSS classes/.test(model.components[0].why), model.components[0].why);
});

test('22. a page whose sections use no <section class="module-…"> markup falls back to heading shape', function () {
  var model = pm.buildFromPage(LANDING_PAGE, {});
  var types = model.components.map(function (c) { return c.type; });
  assert.deepStrictEqual(types, ['content', 'cards', 'content', 'accordion'], JSON.stringify(types));
  assert.ok(model.components.every(function (c) { return c.confidence !== 'high'; }),
    'shape-only inference on unmarked markup should never claim high confidence: ' + JSON.stringify(model.components));
});

test('23. h1/h2 sections and their own h3 sub-headings are told apart, not flattened into one run', function () {
  var model = pm.buildFromPage(LANDING_PAGE, {});
  var cards = model.components.filter(function (c) { return c.type === 'cards'; })[0];
  assert.strictEqual(cards.items.length, 3, JSON.stringify(cards.items));
  assert.strictEqual(cards.heading, 'In ospedale l\'ascensore non può fermarsi');
});

test('24. a <details>/<summary> FAQ is read as an accordion, with no duplicated answer text', function () {
  var model = pm.buildFromPage(LANDING_PAGE, {});
  var accordion = model.components.filter(function (c) { return c.type === 'accordion'; })[0];
  assert.strictEqual(accordion.items.length, 2);
  assert.strictEqual(accordion.items[0].question, 'Quale ascensore per un ospedale?');
  assert.strictEqual(accordion.body.length, 0,
    'the answer belongs to its item only, not duplicated into body too: ' + JSON.stringify(accordion.body));
});

test('25. every page-built component carries sourceRows, confidence and why too', function () {
  var models = [pm.buildFromPage(MARKER_PAGE, {}), pm.buildFromPage(LIVE_FAQ_PAGE, {}), pm.buildFromPage(LANDING_PAGE, {})];
  var components = allComponents(models);
  components.forEach(function (c) {
    assert.ok(c.type, JSON.stringify(c));
    assert.ok(c.confidence === 'high' || c.confidence === 'medium' || c.confidence === 'low', c.confidence);
    assert.ok(c.why && c.why.length, JSON.stringify(c));
    assert.ok(Array.isArray(c.sourceRows) && c.sourceRows.length > 0, JSON.stringify(c));
  });
});

test('26. build() and buildFromPage() report which origin produced the model', function () {
  var fromBrief = pm.build(CAMPAIGN_BRIEF, {});
  var fromPage = pm.buildFromPage(LANDING_PAGE, {});
  assert.strictEqual(fromBrief.origin, 'brief');
  assert.strictEqual(fromPage.origin, 'page');
  assert.strictEqual(fromPage.market, null);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

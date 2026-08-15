// test/engine.test.js — dependency-free verification.
// Run: npm test
//
// The fixtures are real briefs, not invented ones. The failure mode that
// matters is not a crash — it is a confident, silently wrong call, or a
// two-line request coming back with questions that belong to a different kind
// of job. Every case asserts on the decision, and several assert on what the
// tool must NOT ask.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var BriefEngine = require('../engine.js');

var config = {
  'work-types': JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'config', 'work-types.json'), 'utf8')
  )
};

var engine = BriefEngine.create(config);

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

function ids(list) { return list.map(function (x) { return x.id; }); }
function has(list, id) { return list.indexOf(id) !== -1; }
function allQuestions(a) { return a.questions.join(' | '); }

// ─── FIXTURES ────────────────────────────────────────────────────────────
// Four real briefs, one per playbook.

var DENMARK_REDIRECTS = [
  'https://www.kone.dk/dxexperiments.aspx\tx\thttps://www.kone.dk/',
  'https://www.kone.dk/searchresults.aspx\tx\thttps://www.kone.dk/',
  'https://www.kone.dk/campaign/\tx\thttps://www.kone.dk/',
  'https://www.kone.dk/campaign/24-7-connect-escalators/\tx\thttps://www.kone.dk/',
  'https://www.kone.dk/nyheder-referencer-historier/nyheder/kone-top-klima-performer.aspx\tx\thttps://www.kone.dk/'
].join('\n');

var CYPRUS_PARAGRAPH = [
  'Delete this paragrapgh',
  'https://www.kone.com.cy/en/existing-buildings/maintenance/[NJ9.1]',
  'Preventive maintenance offers flexible, tailored, regular maintenance to keep everything running',
  'smoothly and safely. For example, KONE Care DX, a product related to Kone DX Elevators, is the first',
  'carbon-neutral maintenance service in the elevator industry.'
].join('\n');

var INDIA_BLOG = [
  'Meta Title: High-Rise Elevator Safety Features Every Building Must Have | KONE India',
  'Meta Description: Learn about the key safety features of modern high-rise elevators, including',
  'emergency braking, door sensors, fire safety systems, backup power, and predictive maintenance.',
  'Meta Keywords: elevator high rise, high rise lifts, elevator safety features',
  'URL Path: https://www.kone.in/blog/high-rise-lift-safety-features',
  '',
  'What are the Key Safety Features Every High-Rise Elevator Must Have?[1.1]',
  'HERO: AEM Assets - KONE_Feat_Handrail_B_Landscape-004',
  'In a high-rise building, elevators are among the most heavily used systems. Residents, office workers,',
  'visitors, and maintenance teams depend on them every day to move efficiently through the building.',
  '',
  'Why Elevator Safety Matters in High-Rise Buildings[2.1]',
  'Unlike low-rise buildings, high-rise towers place greater demands on elevator systems.',
  '',
  'Emergency Braking Systems[3.1]',
  'One of the most important safety features in modern high-rise lifts is the emergency braking system.',
  '',
  'FAQs[12.1]',
  'What are the essential safety features required for high-rise elevators?[13.1]',
  'Essential safety features include emergency brakes, door sensors and backup power systems.'
].join('\n');

var SLOVENIA_LOCALIZATION = [
  'Images in DAM: https://kone-aem.adobecqms.net/assets.html/content/dam/marketing/media-bank/images/modelsite/monospace-100-dx',
  'https://www.kone.si/elevators/monospace-100-dx/',
  '',
  'Meta title\tKONE MonoSpace 100 DX Residential Elevator\tKONE MonoSpace 100 DX dvigalo za stanovanjske stavbe | KONE',
  'Meta description\tAn affordable, compact residential elevator for apartment buildings.\tCenovno dostopno in kompaktno dvigalo za stanovanjske stavbe do 10 nadstropij.',
  '',
  'Headline\tKONE MonoSpace 100 DX\tKONE MonoSpace 100 DX',
  'Subheading\tSave valuable space and gain greater design freedom with our affordable machine-roomless residential elevator.\tPrihranite dragocen prostor in si zagotovite večjo oblikovalsko svobodo z našim cenovno ugodnim stanovanjskim dvigalom brez strojnice.',
  'CTA 1 / Button\tGet in touch\tStopite v stik',
  '',
  'Title\tSave valuable building space\tPrihranite dragocen prostor v stavbi',
  'Body\tDelivery excellence, strategic partner committed to your project success.\tOdlične dobave, strateški partner, zavezan uspehu vaših projektov.',
  '',
  'Title\tReduce energy costs\tZmanjšajte stroške energije',
  'Body\tWith a compact KONE EcoDisc hoisting motor and smart energy-saving features.\tS kompaktnim dvižnim motorjem KONE EcoDisc in pametnimi funkcijami za varčevanje z energijo.',
  '',
  'Title\tConnected from day one\tPovezani od prvega dne',
  'Body\tBuilt-in connectivity powers predictive maintenance.\tVgrajena povezljivost omogoča napovedno vzdrževanje in klicanje dvigal s pametnega telefona.'
].join('\n');

console.log('WCM Brief Analyser — verification\n');

// ─── 1. Redirect ─────────────────────────────────────────────────────────

test('1. redirect list with no word "redirect" in it → redirect, from the URL-pair rows alone', function () {
  var a = engine.analyse(DENMARK_REDIRECTS);

  assert.strictEqual(a.workType.id, 'redirect', 'expected redirect, got ' + a.workType.id);
  assert.ok(a.workType.confident, 'should be a confident call');
  assert.ok(
    a.workType.matched.some(function (m) { return m.label === 'urlPairRows'; }),
    'the URL-pair rows should be among the signals that decided it'
  );
  assert.strictEqual(a.needs.missing.length, 0, 'source and destination are both here: ' + ids(a.needs.missing));
  assert.ok(a.ready, 'a complete redirect brief is ready to action');
});

test('2. redirect brief → Tridion, because the source URLs carry .aspx', function () {
  var a = engine.analyse(DENMARK_REDIRECTS);

  assert.strictEqual(a.cms.value, 'Tridion', 'expected Tridion, got ' + a.cms.value);
  assert.ok(/\.aspx/.test(a.cms.reason), 'the reason should name the marker it read: ' + a.cms.reason);
  assert.ok(a.steps.length > 0, 'expected Tridion redirect steps');
  assert.ok(
    /Building Blocks/i.test(JSON.stringify(a.steps)) && /root\/system\/redirects/i.test(JSON.stringify(a.steps)),
    'the Tridion recipe should name the Redirection folder and the redirect root page'
  );
  assert.ok(/TCM ID/i.test(JSON.stringify(a.steps)), 'the Tridion recipe should offer the page-metadata route too');
});

test('3. AEM redirect → ACS Commons Redirect Manager, not the Tridion route', function () {
  var a = engine.analyse('Redirect https://www.kone.in/old-services to https://www.kone.in/services');

  assert.strictEqual(a.workType.id, 'redirect');
  assert.strictEqual(a.cms.value, 'AEM', 'kone.in is a migrated market');
  assert.ok(/ACS Commons/i.test(JSON.stringify(a.steps)), 'the AEM recipe should name ACS Commons');
  assert.ok(!/Building Blocks/i.test(JSON.stringify(a.steps)), 'the AEM recipe should not mention Tridion Building Blocks');
});

// ─── CMS detection ───────────────────────────────────────────────────────
// Most of the estate is still Tridion. AEM is the exception, so a URL with no
// .aspx in it proves nothing on its own — kone.co.uk is the case that caught
// the old "no .aspx means migrated" rule out.

test('3a. kone.co.uk has no .aspx and is still Tridion', function () {
  var a = engine.analyse('Update the intro copy on https://www.kone.co.uk/existing-buildings/');

  assert.strictEqual(a.cms.value, 'Tridion', 'got ' + a.cms.value + ' — ' + a.cms.reason);
  assert.ok(/not one of the migrated markets/i.test(a.cms.reason), 'the reason should name the rule: ' + a.cms.reason);
});

test('3b. every migrated market resolves to AEM', function () {
  [
    'https://www.kone.in/services/',
    'https://www.kone.ae/services/',
    'https://www.kone.us/services/',
    'https://www.kone.fr/services/'
  ].forEach(function (url) {
    var a = engine.analyse('Update the intro copy on ' + url);
    assert.strictEqual(a.cms.value, 'AEM', url + ' → ' + a.cms.value);
    assert.ok(/migrated market/i.test(a.cms.reason), 'the reason should name the rule: ' + a.cms.reason);
  });
});

test('3c. non-migrated markets resolve to Tridion', function () {
  ['https://www.kone.dk/', 'https://www.kone.si/', 'https://www.kone.com.cy/', 'https://www.kone.lt/']
    .forEach(function (url) {
      var a = engine.analyse('Update the intro copy on ' + url);
      assert.strictEqual(a.cms.value, 'Tridion', url + ' → ' + a.cms.value);
    });
});

test('3d. an .aspx page is Tridion even on a migrated market', function () {
  var a = engine.analyse('Update the intro copy on https://www.kone.in/legacy/services.aspx');

  assert.strictEqual(a.cms.value, 'Tridion', 'the page itself is un-migrated: ' + a.cms.reason);
  assert.ok(/\.aspx/.test(a.cms.reason), 'the reason should name the marker it read: ' + a.cms.reason);
});

test('4. redirect with a source but no destination → asks for the destination only', function () {
  var a = engine.analyse('Please retire https://www.kone.dk/campaign/ — 301 it.');

  assert.strictEqual(a.workType.id, 'redirect');
  assert.ok(has(ids(a.needs.missing), 'destination_url'), 'destination should be missing');
  assert.ok(has(ids(a.needs.have), 'source_url'), 'source should be found');
  assert.strictEqual(a.questions.length, 1, 'exactly one question, not a checklist: ' + allQuestions(a));
  assert.ok(!a.ready);
});

test('5. redirect asks nothing about components, assets, markets or environments', function () {
  var a = engine.analyse(DENMARK_REDIRECTS);
  var q = allQuestions(a);

  assert.ok(!/component/i.test(q), 'must not ask for components');
  assert.ok(!/asset|image|dam/i.test(q), 'must not ask for assets');
  assert.ok(!/market|region|country/i.test(q), 'must not ask for markets');
  assert.ok(!/environment|dev|qa|prod/i.test(q), 'must not ask for environments');
  assert.ok(!/approver|approval|sign.?off/i.test(q), 'must not ask for an approver');
});

// ─── 2. Content update ───────────────────────────────────────────────────

test('6. "delete this paragraph" + a URL → content update, nothing missing', function () {
  var a = engine.analyse(CYPRUS_PARAGRAPH);

  assert.strictEqual(a.workType.id, 'content-update', 'expected content-update, got ' + a.workType.id);
  assert.strictEqual(a.cms.value, 'Tridion', 'kone.com.cy is not a migrated market');
  assert.strictEqual(a.needs.missing.length, 0, 'where and what are both here: ' + ids(a.needs.missing));
  assert.strictEqual(a.questions.length, 0, 'a complete brief gets no questions back');
  assert.ok(a.ready);
});

test('7. content update needs exactly two things — where, and what', function () {
  var a = engine.analyse(CYPRUS_PARAGRAPH);
  var needed = ids(a.needs.have).concat(ids(a.needs.missing)).sort();

  assert.deepStrictEqual(needed, ['change_description', 'target_url'], 'got ' + needed.join(', '));
});

test('8. image swap → the DAM Smart Crop route, in either CMS', function () {
  var a = engine.analyse(
    'Change the hero image on https://www.kone.lt/pastatyti-pastatai/prieziura/ — use ' +
    'https://kone-aem.adobecqms.net/assetdetails.html/content/dam/marketing/media-bank/images/shutterstock_404145328.jpg'
  );

  assert.strictEqual(a.workType.id, 'content-update');
  assert.ok(/Smart Crop/i.test(JSON.stringify(a.steps)), 'the recipe should carry the Smart Crop step');
  assert.ok(/embed URL/i.test(JSON.stringify(a.steps)), 'the recipe should say to copy the embed URL');
});

test('9. a DAM link never decides the CMS — only the site URL does', function () {
  var a = engine.analyse(
    'Replace the hero image on https://www.kone.dk/referencer/kone-top.aspx with ' +
    'https://kone-aem.adobecqms.net/assetdetails.html/content/dam/marketing/images/hero.jpg'
  );

  assert.strictEqual(a.cms.value, 'Tridion', 'the .aspx site URL wins over the AEM DAM link');
  assert.strictEqual(a.urls.dam.length, 1, 'the DAM link should be held separately');
  assert.strictEqual(a.urls.site.length, 1, 'and kept out of the site URLs');
});

test('10. a bare change request with no URL → asks where, and nothing else', function () {
  var a = engine.analyse('Please delete the second paragraph.');

  assert.strictEqual(a.workType.id, 'content-update');
  assert.deepStrictEqual(ids(a.needs.missing), ['target_url']);
  assert.strictEqual(a.cms.value, 'Unknown', 'no site URL means the platform cannot be read');
  assert.ok(!a.ready, 'unknown CMS is not ready to action');
});

// ─── 3. New page ─────────────────────────────────────────────────────────

test('11. blog brief with meta fields and numbered sections → new page, complete', function () {
  var a = engine.analyse(INDIA_BLOG);

  assert.strictEqual(a.workType.id, 'new-page', 'expected new-page, got ' + a.workType.id);
  assert.strictEqual(a.cms.value, 'AEM');
  assert.strictEqual(a.needs.missing.length, 0, 'the brief carries everything: ' + ids(a.needs.missing));
  assert.ok(/Page Properties/i.test(JSON.stringify(a.steps)), 'the AEM recipe should set page properties');
  assert.ok(/FAQ|accordion/i.test(JSON.stringify(a.steps)), 'the recipe should cover the Q&A block');
});

test('12. new page missing its meta description → asks for that one field', function () {
  var a = engine.analyse(INDIA_BLOG.replace(/Meta Description:.*\n.*\n/, ''));

  assert.strictEqual(a.workType.id, 'new-page');
  assert.deepStrictEqual(ids(a.needs.missing), ['meta_description'], 'got ' + ids(a.needs.missing).join(', '));
});

// ─── 4. Localization ─────────────────────────────────────────────────────

test('13. two-column English/local brief → localization, not new page', function () {
  var a = engine.analyse(SLOVENIA_LOCALIZATION);

  assert.strictEqual(a.workType.id, 'localization', 'expected localization, got ' + a.workType.id);
  assert.ok(
    a.workType.matched.some(function (m) { return m.label === 'nonEnglishText'; }),
    'the translated column should be among the signals that decided it'
  );
  assert.ok(has(ids(a.needs.have), 'localized_content'), 'the localized copy is present');
});

test('14. localization recipe localizes existing components — it does not create a page', function () {
  var a = engine.analyse(SLOVENIA_LOCALIZATION);
  var steps = JSON.stringify(a.steps);

  assert.ok(/already/i.test(steps), 'the recipe should say the master content is already there');
  assert.ok(!/create the page/i.test(steps), 'it must not tell the author to create a page');
  assert.ok(/left in English/i.test(steps), 'it should check nothing is left untranslated');
});

// ─── Cross-cutting ───────────────────────────────────────────────────────

test('15. every brief is scored against every playbook, and carries its signals', function () {
  var a = engine.analyse(CYPRUS_PARAGRAPH);

  assert.strictEqual(a.workType.alternatives.length, config['work-types'].workTypes.length,
    'all four playbooks should appear in the scores');
  a.workType.matched.forEach(function (m) {
    assert.ok(m.label && typeof m.weight === 'number', 'every match carries its label and weight');
  });
});

test('15a. no recipe step re-asks a question the analysis has already answered', function () {
  // Block 1 states the CMS and the reason it decided. A step telling the
  // author to work it out again is noise, and one phrased around .aspx also
  // contradicts how detection actually works.
  config['work-types'].workTypes.forEach(function (playbook) {
    ['AEM', 'Tridion'].forEach(function (cms) {
      playbook.steps[cms].forEach(function (step) {
        assert.ok(!/confirm the cms|determine the cms|check (which )?cms/i.test(step),
          playbook.id + '/' + cms + ' re-asks for the CMS: ' + step);
        assert.ok(!/\.aspx/i.test(step),
          playbook.id + '/' + cms + ' restates the .aspx rule: ' + step);
      });
    });
  });
});

test('16. an empty brief guesses nothing', function () {
  var a = engine.analyse('');

  assert.ok(!a.workType.confident, 'nothing matched, so it must not claim confidence');
  assert.strictEqual(a.cms.value, 'Unknown');
  assert.ok(!a.ready);
});

test('17. the work type can be overridden by hand', function () {
  var a = engine.analyse(CYPRUS_PARAGRAPH, { workTypeOverride: 'redirect' });

  assert.strictEqual(a.workType.id, 'redirect');
  assert.ok(a.workType.overridden, 'the override should be visible in the result');
  assert.ok(has(ids(a.needs.missing), 'destination_url'), 'needs are re-checked against the chosen type');
});

test('18. the CMS can be overridden by hand', function () {
  var a = engine.analyse(CYPRUS_PARAGRAPH, { cmsOverride: 'Tridion' });

  assert.strictEqual(a.cms.value, 'Tridion');
  assert.ok(/hand/i.test(a.cms.reason));
  assert.ok(/TCM ID/i.test(JSON.stringify(a.steps)), 'and the steps follow the chosen CMS');
});

test('19. determinism — the same brief analyses identically twice', function () {
  var first = engine.analyse(SLOVENIA_LOCALIZATION);
  var second = engine.analyse(SLOVENIA_LOCALIZATION);
  delete first.generatedAt; delete second.generatedAt;

  assert.deepStrictEqual(first, second);
});

test('20. no brief is ever asked for something outside its own playbook', function () {
  var briefs = [DENMARK_REDIRECTS, CYPRUS_PARAGRAPH, INDIA_BLOG, SLOVENIA_LOCALIZATION];

  briefs.forEach(function (brief) {
    var a = engine.analyse(brief);
    var playbook = config['work-types'].workTypes.filter(function (t) { return t.id === a.workType.id; })[0];
    var allowed = playbook.needs.map(function (n) { return n.id; });
    ids(a.needs.have).concat(ids(a.needs.missing)).forEach(function (id) {
      assert.ok(allowed.indexOf(id) !== -1, a.workType.id + ' asked for ' + id + ', which is not in its playbook');
    });
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

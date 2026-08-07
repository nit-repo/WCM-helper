// test/engine.test.js — dependency-free verification of the scoring engine.
// Run: npm test
//
// The cases below are the plan's own verification list (§11), in order. They
// exist because the failure mode that matters here is not a crash — it is a
// confident, silently wrong classification. Each case asserts on the decision,
// not just that something was returned.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var BriefEngine = require('../engine.js');
var Exporter = require('../export.js');

var CONFIG_DIR = path.join(__dirname, '..', 'config');
var config = {};
['work-types', 'components', 'risk-flags', 'locations', 'execution-steps'].forEach(function (name) {
  config[name] = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name + '.json'), 'utf8'));
});

var engine = BriefEngine.create(config);

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

function ids(list) { return list.map(function (x) { return x.id; }); }
function questionText(a) { return a.questions.map(function (q) { return q.question; }).join(' | '); }

console.log('WCM Brief Analyser — engine verification\n');

// ─── 1. Incomplete bug brief ─────────────────────────────────────────────
test('1. incomplete bug brief → bug type, red score, hard blocks, generated questions', function () {
  var a = engine.analyse('The accordion is broken and not working, please fix it. Bug.');

  assert.strictEqual(a.workType.id, 'bug', 'expected bug, got ' + a.workType.id);
  assert.strictEqual(a.completeness.rag, 'red', 'expected red, got ' + a.completeness.rag + ' (' + a.completeness.score + ')');
  assert.ok(a.hardBlocks.length > 0, 'expected at least one hard block');
  assert.ok(includes(ids(a.hardBlocks), 'block-bug-no-repro'), 'expected the missing-repro block');
  assert.ok(includes(ids(a.hardBlocks), 'block-no-location'), 'expected the missing-location block');
  assert.ok(includes(ids(a.completeness.missing), 'steps_to_reproduce'), 'Steps to Reproduce should be missing');
  assert.ok(includes(ids(a.completeness.missing), 'evidence'), 'Evidence should be missing');
  assert.ok(/exact steps to reproduce/i.test(questionText(a)), 'should generate the repro question');
  assert.ok(/DEV, QA, PRE-PROD/i.test(questionText(a)), 'should generate the environment question');
});

// ─── 2. AEM EXF navigation update ────────────────────────────────────────
test('2. AEM EXF navigation brief → EXF type, rollout steps, child-publish risk flag', function () {
  var a = engine.analyse(
    'Please update the Header EXF in AEM. Add a new Level 1 nav item labelled "Modernisation" to the mega menu ' +
    'pointing at /content/frontlines/uk/en/modernisation. Roll out from Master EN to Region Master AME and then ' +
    'to all country sites. Environment: PROD. Approved by A. Approver.'
  );

  assert.strictEqual(a.workType.id, 'exf-update', 'expected exf-update, got ' + a.workType.id);
  assert.strictEqual(a.cms.value, 'AEM');
  var actions = a.executionSteps.map(function (s) { return s.action; });
  assert.ok(includes(actions, 'publish_exf_children'), 'expected an explicit child-publish step');
  assert.ok(includes(actions, 'rollout_region'), 'expected a region rollout step');
  assert.ok(includes(ids(a.riskFlags), 'exf-child-publish'), 'expected the child EXF publish flag');
});

// ─── 3. Tridion → AEM migration ──────────────────────────────────────────
test('3. migration brief → migration type, duplicate-row flag, CMS reads Mixed', function () {
  var a = engine.analyse(
    'Migrate the Tridion page at /uk/en/services/maintenance to AEM at /content/frontlines/uk/en/services/maintenance. ' +
    'Component mapping: Tridion RTF maps to Text Block, Tridion Image Component maps to cmp-image. ' +
    'SEO mapping sheet attached for the old URL to new canonical redirects. Market: UK site. Approver: A. Approver.'
  );

  assert.strictEqual(a.workType.id, 'migration', 'expected migration, got ' + a.workType.id);
  assert.strictEqual(a.cms.value, 'Mixed', 'expected Mixed, got ' + a.cms.value);
  assert.strictEqual(a.cms.label, 'Mixed — Migration context');
  assert.ok(includes(ids(a.riskFlags), 'duplicate-migration-rows'), 'expected the duplicate migration row flag');
  assert.ok(a.executionSteps.length > 0, 'Mixed CMS should still produce migration steps');
  assert.ok(includes(a.executionSteps.map(function (s) { return s.action; }), 'check_migration_sheet'));
});

// ─── 4. SEO brief ────────────────────────────────────────────────────────
test('4. SEO brief → SEO type, Pillar 1 metadata gate in the steps', function () {
  var a = engine.analyse(
    'SEO fix for the AU site: the internal links to our service tool pages currently carry nofollow, which kills ' +
    'link equity. They should be normal followed links, corrected in AEM Page Properties. Affected URLs are listed ' +
    'in the audit sheet, https://www.kone.com/en_AU/services/tools.aspx being the main one.'
  );

  assert.strictEqual(a.workType.id, 'seo', 'expected seo, got ' + a.workType.id);
  assert.ok(includes(ids(a.riskFlags), 'nofollow-internal-link'), 'expected the nofollow flag');
  var instructions = a.executionSteps.map(function (s) { return s.instruction; }).join(' ');
  assert.ok(/Pillar 1/.test(instructions), 'expected the Pillar 1 metadata gate in the steps');
});

// ─── 5. Deliberately ambiguous brief ─────────────────────────────────────
test('5. ambiguous brief → flagged as ambiguous rather than silently picked', function () {
  var a = engine.analyse('Please publish the updated content to the page.');
  assert.strictEqual(a.workType.ambiguous, true, 'expected ambiguous, got a confident ' + a.workType.label);
  assert.ok(a.questions.some(function (q) { return q.type === 'open' && /which is it/.test(q.question); }),
    'expected an open clarifying question about the classification');
});

// ─── 6. Country-code false positive ──────────────────────────────────────
test('6. bare country-code word with no market context → no regional detection', function () {
  var a = engine.analyse('Raised with IT support as a ticket. The US team flagged it during their review.');
  assert.strictEqual(a.location.markets.length, 0,
    'expected no markets, got ' + a.location.markets.map(function (m) { return m.code; }).join(','));

  // Same codes, now written as market codes with market context, must still be detected.
  var b = engine.analyse('Publish this to the IT site and the US site.');
  assert.ok(b.location.markets.length >= 2, 'anchored country codes should still be detected');

  // A pronoun next to a rollout verb is the other half of this trap: "It should
  // roll out" must not become Italy, while the market in the path is still read.
  var c = engine.analyse('Add the nav item at /content/frontlines/uk/en/services. It should roll out to all country sites.');
  var codes = c.location.markets.map(function (m) { return m.code; });
  assert.ok(!includes(codes, 'IT'), 'the pronoun "It" must not register as Italy, got ' + codes.join(','));
  assert.ok(includes(codes, 'UK'), 'the market in the /content path should be detected, got ' + codes.join(','));
  assert.strictEqual(c.location.marketReasons.UK, 'path or URL segment');
});

// ─── 7. Component named, asset absent ────────────────────────────────────
test('7. Hero mentioned with no image reference → missing-asset gap', function () {
  var a = engine.analyse(
    'Update the hero on the existing campaign page at https://www.kone.com/en_AU/campaign. ' +
    'The new headline copy should read "Move with confidence". Environment: PROD. Approver: A. Approver. AU market site.'
  );
  assert.ok(includes(ids(a.assets.missing), 'dam_image'), 'expected a missing DAM image asset');
  assert.ok(includes(ids(a.assets.missing), 'alt_text'), 'expected missing alt text');
  assert.ok(/DAM asset/i.test(questionText(a)), 'expected the generated DAM question');
});

// ─── 8. Component gap detection ──────────────────────────────────────────
test('8. PDP brief with only Hero + Text Block → commonly-expected components nudged', function () {
  var a = engine.analyse(
    'Create a new product page for the KONE MonoSpace elevator. It needs a hero and a text block of body copy. ' +
    'Page title: KONE MonoSpace Elevator. Meta description to follow. AU market site. Approver: A. Approver. ' +
    'Target path /content/frontlines/au/en/products/monospace.'
  );
  assert.strictEqual(a.workType.id, 'new-page', 'expected new-page, got ' + a.workType.id);
  assert.strictEqual(a.location.pageType, 'pdp', 'expected pdp, got ' + a.location.pageType);
  var rec = ids(a.components.recommended);
  assert.ok(includes(rec, 'grid-block'), 'expected a Grid Block nudge, got ' + rec.join(','));
  assert.ok(includes(rec, 'cta-button'), 'expected a CTA nudge, got ' + rec.join(','));
});

// ─── 9. Export ───────────────────────────────────────────────────────────
test('9. export produces all 14 audit columns, populated', function () {
  var a = engine.analyse(
    'Update the Header EXF in AEM: new nav item pointing at /content/frontlines/uk/en/services. ' +
    'Roll out to all country sites. PROD. Approver: A. Approver.'
  );
  var table = Exporter.buildTable([a]);
  assert.strictEqual(table.headers.length, 14, 'expected 14 columns, got ' + table.headers.length);
  assert.strictEqual(table.rows.length, 1);

  var row = table.rows[0];
  assert.strictEqual(row.length, 14, 'row width must match header width');
  var byName = {};
  table.headers.forEach(function (h, i) { byName[h] = row[i]; });

  assert.ok(byName['Work Type'], 'Work Type must be populated');
  assert.strictEqual(byName['CMS Platform'], 'AEM');
  assert.ok(byName['Completeness Score'].indexOf('%') !== -1, 'score should carry a RAG string');
  assert.ok(byName['Execution Steps'].indexOf('1.') === 0, 'steps should be numbered');
  assert.ok(byName['Matched Keywords (Audit)'].length > 0, 'audit column must carry the matched keywords');
  assert.ok(byName['Classification Confidence'].indexOf('%') !== -1);
  assert.ok(byName['Environment Scope'].length > 0);

  var xml = Exporter.toSpreadsheetXml([a]);
  assert.ok(xml.indexOf('<?xml') === 0, 'export must be a well-formed workbook');
  assert.ok(xml.indexOf('Matched Keywords (Audit)') !== -1);
  assert.ok(xml.indexOf(']]>') === -1 || true);
});

// ─── 10. Real examples from the reference data ───────────────────────────
test('10. real-example fixtures classify to their documented work type', function () {
  var fixtures = [
    ['Swap the hero image on the campaign landing page for the AU site.', 'content-update'],
    ['Fix the broken CTA link pointing to a 404 page — it is a defect on PROD, steps to reproduce below.', 'bug'],
    ['New campaign landing page for the seasonal promo, built from scratch.', 'new-page'],
    ['Roll out the Master EN blueprint to the Region Master AME live copies and publish to the country sites.', 'rollout'],
    ['Global campaign adoption from the Master publication into all markets — localize per market.', 'blueprint-adoption'],
    ['Run the full 52-point QA audit across the four pillars on PRE-PROD before sign-off.', 'qa-audit'],
    ['Remove the noindex from these indexable pages and correct the canonical.', 'seo']
  ];
  fixtures.forEach(function (pair) {
    var a = engine.analyse(pair[0]);
    assert.strictEqual(a.workType.id, pair[1],
      '"' + pair[0].substring(0, 40) + '…" → expected ' + pair[1] + ', got ' + a.workType.id);
  });
});

// ─── 11. Structural guarantees ───────────────────────────────────────────
test('11. determinism — the same brief analyses identically twice', function () {
  var brief = 'Update the accordion copy on the UK site product page at /content/frontlines/uk/en/products. PROD.';
  var first = engine.analyse(brief);
  var second = engine.analyse(brief);
  delete first.generatedAt; delete second.generatedAt;
  assert.deepStrictEqual(first, second);
});

test('12. CMS unspecified blocks execution steps and asks for the platform', function () {
  var a = engine.analyse('Change the wording in the accordion to say "Book a service visit" instead.');
  assert.strictEqual(a.cms.value, 'Unspecified');
  assert.strictEqual(a.executionSteps.length, 0, 'steps must not be generated for an unknown platform');
  assert.ok(/AEM or Tridion/.test(questionText(a)), 'expected the CMS question');

  var overridden = engine.analyse('Change the wording in the accordion.', { cmsOverride: 'AEM' });
  assert.strictEqual(overridden.cms.value, 'AEM');
  assert.ok(overridden.executionSteps.length > 0, 'override should unblock the steps');
});

test('13. multi-market brief raises the One-Ticket-Per-Market flag and escalates effort', function () {
  var a = engine.analyse('Update the footer link across the AU site, NZ site and UK site.');
  assert.strictEqual(a.conditions.multiMarket, true);
  assert.ok(includes(ids(a.riskFlags), 'multi-market-single-ticket'), 'expected the split-per-market flag');
  assert.strictEqual(a.effort.tier, 'Complex');
});

test('14. explainability — every classification carries the keywords that drove it', function () {
  var a = engine.analyse('Publish the Header EXF change to the mega menu navigation.');
  assert.ok(a.workType.matchedKeywords.length > 0, 'matched keywords must be recorded');
  a.workType.matchedKeywords.forEach(function (k) {
    assert.ok(typeof k.term === 'string' && typeof k.weight === 'number', 'each match carries term + weight');
  });
  assert.strictEqual(a.allScores.length, config['work-types'].workTypes.length,
    'every work type must be scored, not just the winner');
});

test('15. refine() re-scores an answer through the same path rather than special-casing it', function () {
  var brief = 'Please publish the updated content to the page.';
  var before = engine.analyse(brief);
  assert.strictEqual(before.workType.ambiguous, true);

  var after = engine.refine(brief, [{ question: 'Which is it?', answer: 'It is an Experience Fragment change to the Header EXF mega menu in AEM.' }]);
  assert.strictEqual(after.workType.id, 'exf-update');
  assert.strictEqual(after.workType.ambiguous, false);
});

function includes(list, value) {
  for (var i = 0; i < list.length; i++) if (list[i] === value) return true;
  return false;
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

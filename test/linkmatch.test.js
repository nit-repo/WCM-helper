// test/linkmatch.test.js — link suggestions and link relevance, on real kone.bh material.
// Run: npm test
//
// The page is the real Tridion preview of the Bahrain builders page and the
// sitemap is the real kone.bh URL list (test/fixtures). The real page has
// since been fixed to carry links on its "Learn more" cards, so the bare-text
// case is made from it by removing one link — the only synthetic shape here.

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var Compare = require('../compare.js');
var Links = require('../linkmatch.js');

function load(name) { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }

var comparer = Compare.create({ 'work-types': JSON.parse(load('../config/work-types.json')), sites: JSON.parse(load('../config/sites.json')) });
var RULINGS = JSON.parse(load('../config/link-rulings.json'));
var lm = Links.create({ pathOf: comparer.pathOf, rulings: RULINGS });
var bare = Links.create({ pathOf: comparer.pathOf });
var SITEMAP = load('fixtures/kone-bh-sitemap.txt');
var PAGE = load('fixtures/kone-bh-builders.html');
var idx = lm.index(Links.parseSitemap(SITEMAP), { source: 'pasted' });

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}
function audit(html, l, index) {
  return (l || lm).audit({ page: comparer.readPage(html), index: index === undefined ? idx : index });
}
function row(a, text, href) {
  return a.rows.filter(function (r) { return r.text === text && (href === undefined || r.href === href); })[0];
}
function top(r) { return r.suggestions[0] && r.suggestions[0].path; }

test('1. parseSitemap reads a URL list, a sitemap.xml, and skips comments and junk', function () {
  assert.strictEqual(Links.parseSitemap(SITEMAP).length, 204);
  assert.deepStrictEqual(Links.parseSitemap('<urlset><url><loc>https://www.kone.bh/en/a/</loc></url><url><loc>https://www.kone.bh/en/b.aspx?x=1&amp;y=2</loc></url></urlset>'),
    ['https://www.kone.bh/en/a/', 'https://www.kone.bh/en/b.aspx?x=1&y=2']);
  assert.deepStrictEqual(Links.parseSitemap('# note\nhttps://x.kone.bh/a  https://x.kone.bh/b\nnot-a-url'), ['https://x.kone.bh/a', 'https://x.kone.bh/b']);
});

test('2. the index finds the /en/ prefix and the editorial sections', function () {
  assert.strictEqual(idx.prefix, 'en');
  assert.strictEqual(idx.host, 'kone.bh');
  var press = idx.byPath['/en/news-insights/press-releases/kone-partners-with-jeddah-tower'];
  assert.ok(press && press.editorial);
  assert.ok(!idx.byPath['/en/new-buildings/elevators/builders/kone-jumplift'].editorial);
});

test('3. a bare "Learn more" CTA gets the page it names as a confident suggestion', function () {
  var html = PAGE.replace('<a href="/en/new-buildings/elevators/builders/kone-jumplift.aspx">Learn more about KONE JumpLift</a>', 'Learn more about KONE JumpLift')
    .replace('<a href="/en/new-buildings/elevators/builders/kone-construction-time-use-elevator.aspx">Learn more about KONE construction time use</a>', 'Learn more about KONE construction time use')
    .replace('<a href="/en/studio/">Learn more about KONE&#160;Studio</a>', 'Learn more about KONE Studio');
  var a = audit(html);
  var jump = row(a, 'Learn more about KONE JumpLift');
  assert.strictEqual(jump.kind, 'dead-cta');
  assert.strictEqual(jump.verdict, 'red');
  assert.strictEqual(top(jump), '/en/new-buildings/elevators/builders/kone-jumplift');
  assert.ok(jump.confident);
  assert.strictEqual(top(row(a, 'Learn more about KONE construction time use')), '/en/new-buildings/elevators/builders/kone-construction-time-use-elevator');
  assert.strictEqual(top(row(a, 'Learn more about KONE Studio')), '/en/studio');
});

test('4. text that names no page gets no confident suggestion', function () {
  var s = lm.suggest('Discover how we keep saving space', idx);
  assert.ok(!s.confident);
  assert.strictEqual(lm.suggest('Get in touch', idx).suggestions.length, 0);
});

test('5. a path missing /en/ is red; pointing at this page, the fix is the bare anchor', function () {
  var r = row(audit(PAGE), 'Get in touch');
  assert.strictEqual(r.verdict, 'red');
  assert.ok(/missing the \/en\//.test(r.reason), r.reason);
  assert.strictEqual(r.suggestions[0].url, '#item-147220');
  assert.strictEqual(r.count, 2, 'the hero and the CTA band carry the same link');
});

test('6. a path missing /en/ that points elsewhere gets the prefixed path', function () {
  var html = PAGE.replace('href="/en/studio/"', 'href="/studio/"');
  var r = row(audit(html), 'Learn more about KONE Studio');
  assert.strictEqual(r.verdict, 'red');
  assert.strictEqual(r.suggestions[0].url, '/en/studio/');
});

test('7. the team\'s rulings: 100 DX and KONE 2000 amber, MiniSpace High-Rise green, Codes and Standards amber', function () {
  var a = audit(PAGE);
  var dx = row(a, 'KONE MonoSpace® 100 DX');
  assert.strictEqual(dx.verdict, 'amber');
  assert.strictEqual(dx.ruling.id, 'bh-monospace-100-dx');
  assert.strictEqual(top(dx), '/en/new-buildings/elevators/kone-monospace-dx', 'still names the closest dedicated page');
  assert.strictEqual(row(a, 'KONE 2000').verdict, 'amber');
  assert.strictEqual(row(a, 'KONE MiniSpace DX High-Rise').verdict, 'green');
  assert.strictEqual(row(a, 'Learn more about our Codes and Standards').verdict, 'amber');
});

test('8. the same verdicts come from the matching itself, with no rulings at all', function () {
  var a = audit(PAGE, bare);
  var dx = row(a, 'KONE MonoSpace® 100 DX');
  assert.strictEqual(dx.verdict, 'amber');
  assert.ok(/listing page/.test(dx.reason), dx.reason);
  var k2000 = row(a, 'KONE 2000');
  assert.strictEqual(k2000.verdict, 'amber');
  assert.ok(/page exists, but its address .* is not about "2000"/.test(k2000.reason) && /no other page in the sitemap/.test(k2000.reason), k2000.reason);
  assert.strictEqual(row(a, 'KONE MiniSpace DX High-Rise').verdict, 'green');
  assert.strictEqual(row(a, 'Learn more about our Codes and Standards').verdict, 'amber');
  ['KONE MonoSpace® Home', 'KONE MiniSpace™ DX', 'KONE TranSys™ DX', 'Learn more about KONE JumpLift', 'Learn more about KONE Studio', 'New buildings']
    .forEach(function (t) { assert.strictEqual(row(a, t).verdict, 'green', t); });
});

test('9. a ruling stops applying the moment the link changes', function () {
  var html = PAGE.replace('<a href="/en/tools-downloads/">Learn more about our Codes and Standards</a>',
    '<a href="/en/tools-downloads/glossary/">Learn more about our Codes and Standards</a>');
  var r = row(audit(html), 'Learn more about our Codes and Standards');
  assert.strictEqual(r.ruling, undefined);
  assert.strictEqual(r.verdict, 'amber', 'judged afresh — the glossary is not about codes either');
});

test('10. press releases are never suggested for product text, unless the text asks for news', function () {
  assert.strictEqual(lm.suggest('Learn more about KONE UltraRope', idx).suggestions.length, 0);
  var news = lm.suggest('Read the press release on UltraRope', idx).suggestions;
  assert.ok(news.length && /press-releases/.test(news[0].path), JSON.stringify(news));
});

test('11. generic text and other sites are not judged; home links are not either', function () {
  var a = audit(PAGE);
  assert.ok(!a.rows.some(function (r) { return /my\.kone\.com/.test(r.href || ''); }), 'external');
  assert.ok(!a.rows.some(function (r) { return r.href === '/en/'; }), 'home');
  var html = PAGE.replace('href="/new-buildings/builders/#item-147220" target="_self">Get in touch<', 'href="/en/about-us/contact-us/" target="_self">Get in touch<');
  assert.ok(!audit(html).rows.some(function (r) { return r.href === '/en/about-us/contact-us/'; }), 'generic text to a real page');
});

test('12. a path the sitemap does not list is amber', function () {
  var html = PAGE.replace('href="/en/studio/"', 'href="/en/studio-old/"');
  var r = row(audit(html), 'Learn more about KONE Studio');
  assert.strictEqual(r.verdict, 'amber');
  assert.ok(/does not list/.test(r.reason));
  assert.strictEqual(top(r), '/en/studio');
});

test('13. with no sitemap only what needs none is reported: bare text and empty links', function () {
  var html = PAGE.replace('<a href="/en/new-buildings/elevators/builders/kone-jumplift.aspx">Learn more about KONE JumpLift</a>', 'Learn more about KONE JumpLift')
    .replace('<a href="/en/studio/">', '<a href="#">');
  var a = audit(html, lm, null);
  assert.deepStrictEqual(a.rows.map(function (r) { return r.kind + ':' + r.verdict; }).sort(), ['dead-cta:red', 'placeholder:red']);
  assert.ok(a.rows.every(function (r) { return r.suggestions.length === 0; }));
});

test('14. the rulings file is well formed', function () {
  RULINGS.rulings.forEach(function (r) {
    assert.ok(r.id && r.text && r.target && /^(green|amber|red)$/.test(r.verdict), JSON.stringify(r));
    new RegExp(r.text, 'i');
  });
});

// ─── Generic CTA text, judged by its component ──────────────────────────────
// The real kone.in one-week page (fixture): its content-river component
// "Smart, flexible elevator upgrades for all major brands" ends in
// "Explore options" → …/elevator-upgrades/. The kone.in sitemap is not in the
// repo, so the URL list below is synthetic: the link's own target plus real
// kone.in paths taken from the page's navigation.

var IN_PAGE = load('fixtures/kone-in-one-week-modernization.html');
var IN_URLS = [
  'https://www.kone.in/existing-buildings/elevator-modernization/elevator-upgrades/',
  'https://www.kone.in/modernization.html',
  'https://www.kone.in/modernization/elevator-modernization.html',
  'https://www.kone.in/modernization/elevator-modernization/elevator-replacement.html',
  'https://www.kone.in/modernization/escalator-autowalk-modernization.html',
  'https://www.kone.in/maintenance-service/elevator-maintenance.html',
  'https://www.kone.in/about-kone/careers.html'
];
var inIdx = lm.index(IN_URLS, { source: 'pasted' });

test('15. generic CTA wording names nothing: "Explore options", "Start now", "Learn more"', function () {
  ['Explore options', 'Start now', 'Learn more', 'Scopri le opzioni'].forEach(function (t) {
    assert.deepStrictEqual(Links.tokens(t), [], t);
  });
  assert.deepStrictEqual(Links.tokens('Explore elevator upgrades'), ['elevator', 'upgrade']);
});

test('16. "Explore options" → elevator-upgrades passes, judged by its component\'s title', function () {
  var r = row(audit(IN_PAGE, lm, inIdx), 'Explore options');
  assert.ok(r, 'the generic CTA is judged, not skipped');
  assert.strictEqual(r.verdict, 'green', r.reason);
  assert.strictEqual(r.context.heading, 'Smart, flexible elevator upgrades for all major brands');
  assert.ok(/generic link text — judged by its component "Smart, flexible elevator upgrades/.test(r.reason), r.reason);
  assert.ok(/elevator, upgrade/.test(r.reason), r.reason);
});

test('17. the same CTA pointed at an unrelated page is a check, suggesting the page the component is about', function () {
  var html = IN_PAGE.replace('https://www.kone.in/existing-buildings/elevator-modernization/elevator-upgrades/', 'https://www.kone.in/about-kone/careers.html');
  var r = row(audit(html, lm, inIdx), 'Explore options');
  assert.strictEqual(r.verdict, 'amber', r.reason);
  assert.ok(/not about elevator upgrades/.test(r.reason), r.reason);
  assert.strictEqual(top(r), '/existing-buildings/elevator-modernization/elevator-upgrades');
});

test('18. written as bare text, "Explore options" is suggested the page its component names', function () {
  var html = IN_PAGE.replace(/<a class="btn btn-primary btn-big" role="button" href="[^"]*" target="_blank">Explore options<\/a>/, 'Explore options');
  var r = row(audit(html, lm, inIdx), 'Explore options');
  assert.strictEqual(r.kind, 'dead-cta');
  assert.strictEqual(top(r), '/existing-buildings/elevator-modernization/elevator-upgrades');
  assert.ok(r.confident);
});

test('19. a generic CTA with nothing firm to compare against is not guessed at', function () {
  var html = IN_PAGE.replace('Smart, flexible elevator upgrades for all major brands', 'Built around you')
    .replace(/<p>Within one week[^<]*<\/p>/, '<p>Talk to us.</p>')
    .replace('https://www.kone.in/existing-buildings/elevator-modernization/elevator-upgrades/', 'https://www.kone.in/about-kone/careers.html');
  assert.strictEqual(row(audit(html, lm, inIdx), 'Explore options'), undefined);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

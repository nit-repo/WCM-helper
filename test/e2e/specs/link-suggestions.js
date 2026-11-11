// The Summary and its sitemap-aware link suggestions, on the real Bahrain
// builders page and the real kone.bh sitemap — and the "Link suggestions"
// option on each of the three QA sources.
'use strict';

const fs = require('fs');
const path = require('path');
const BUILDERS = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'kone-bh-builders.html'), 'utf8');

module.exports = async function (t) {
  const page = await t.qaPage();
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const grab = (text, re) => (text.match(re) || [''])[0];
  let discovers = 0;
  page.on('request', r => { if (/\/api\/discover/.test(r.url())) discovers++; });
  const summary = () => page.evaluate(() => {
    const text = document.getElementById('output').innerText;
    return text.slice(text.indexOf('SUMMARY'));
  });

  t.check('signed in, the Page card says a pasted page never leaves the browser',
    /^A pasted page never leaves the browser\./.test(await page.textContent('#page-hint')));
  t.check('Link suggestions is ticked by default on a pasted page', await page.isChecked('#page-sitemap-links'));

  // Ticked: the site's sitemap is fetched for the page's market.
  await page.fill('#html', BUILDERS);
  await page.click('#qa-btn');
  await page.waitForFunction(() => /Sitemap: kone\.bh, \d+ URLs/.test(document.getElementById('output').textContent), null, { timeout: 30000 });
  let text = await summary();
  t.check('the sitemap is fetched once for the page\'s market', discovers === 1 && /Sitemap: kone\.bh, 204 URLs, fetched automatically/.test(text), discovers + ' calls · ' + grab(text, /Sitemap:[^\n]*/));
  t.check('spelling: a misspelling with its correction', /fixMisspelling — Commerical/.test(text) && /SuggestCommercial/.test(text));
  t.check('spelling: a KONE product name spelled wrongly', /fixProduct name — TransSys/.test(text) && /SuggestTranSys/.test(text));
  t.check('links: a path missing /en/ is a fix, with the anchor to use',
    /fixLink — "Get in touch" → \/new-buildings\/builders\/#item-147220 \(×2\)/.test(text) && /Suggest#item-147220/.test(text), grab(text, /fixLink[^\n]*/));
  t.check('links: a team ruling is applied and named', /ruling bh-monospace-100-dx/.test(text) && /kone-monospace-dx\//.test(text));
  t.check('links: the ones that pass are counted', /8 links that pass/.test(text));
  t.check('lists: typed numbering and lists written as paragraphs', /checkTyped numbering/.test(text) && /checkList as paragraphs/.test(text));
  t.check('verdicts read pass / check / fix, not colours', !/\b(amber|red|green)(Link|Misspelling|Typed)/.test(text));

  await page.click('#copy-summary');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  t.check('Copy summary: plain text with [fix] and [check]', /\[fix\]/.test(copied) && /\[check\]/.test(copied) && !/\[amber\]|\[red\]/.test(copied), copied.slice(0, 200));

  // A second run reuses the sitemap already read.
  await page.click('#qa-btn');
  await page.waitForFunction(() => /Sitemap: kone\.bh, \d+ URLs/.test(document.getElementById('output').textContent));
  t.check('a second run reuses the cached sitemap', discovers === 1, discovers + ' calls');

  // Unticked: nothing is read, and the Summary says so.
  await page.uncheck('#page-sitemap-links');
  await page.waitForFunction(() => /Sitemap: not read/.test(document.getElementById('output').textContent));
  text = await summary();
  t.check('unticked: the Summary says link suggestions are off',
    /Sitemap: not read — link suggestions are off for this page/.test(text) && /LINK SUGGESTIONS — 0/.test(text), grab(text, /Sitemap:[^\n]*/));
  t.check('unticked: Fetch sitemap is offered', await page.isVisible('#summary-fetch-sitemap'));

  // Fetch sitemap reads it for this page only; the setting stays off.
  await page.click('#summary-fetch-sitemap');
  await page.waitForFunction(() => /LINK SUGGESTIONS — [1-9]/i.test(document.getElementById('output').innerText), null, { timeout: 20000 });
  t.check('Fetch sitemap brings the suggestions back, and the option stays unticked', !(await page.isChecked('#page-sitemap-links')));

  // Each source has its own option, and each is remembered.
  await page.click('[data-source="live"]');
  t.check('Live URL shows its own option and hides the Page card\'s',
    await page.isVisible('#live-sitemap-links') && !(await page.isVisible('#page-sitemap-links')));
  t.check('Live URL\'s option is still ticked: the settings are separate', await page.isChecked('#live-sitemap-links'));
  await page.reload();
  await t.ready(page);
  await page.click('#tab-qa');
  t.check('after a reload the pasted-page option is still unticked', !(await page.isChecked('#page-sitemap-links')));

  // A crawl reads each site's whole sitemap, so a crawled page's report has suggestions too.
  await page.click('[data-source="crawl"]');
  await page.click('[data-crawl-src="list"]');
  const builders = t.harness.site('www.kone.bh', '/en/new-buildings/elevators/builders/');
  await page.fill('#crawl-urls', builders);
  await page.check('#crawl-sitemap-links');
  await page.click('#crawl-btn');
  await page.waitForFunction(() => /Done —/.test(document.getElementById('output').textContent), null, { timeout: 40000 });
  await page.click('table.crawl tbody tr.open-row');
  await page.waitForSelector('#crawl-back');
  text = await summary();
  t.check('a crawled page\'s report says its sitemap was read during the crawl', /Sitemap: kone\.bh, 204 URLs, read during the crawl/.test(text), grab(text, /Sitemap:[^\n]*/));
  t.check('and carries link suggestions', /LINK SUGGESTIONS — [1-9]/.test(text) && /fixLink — "Get in touch"/.test(text));
};

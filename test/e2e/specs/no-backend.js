// With no backend configured the tool runs as it always has: no sign-in, no
// live fetching — paste, upload and the bookmarklet only.
'use strict';

const fs = require('fs');
const path = require('path');
const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');
const BUILDERS = fs.readFileSync(path.join(FIXTURES, 'kone-bh-builders.html'), 'utf8');
const SITEMAP = fs.readFileSync(path.join(FIXTURES, 'kone-bh-sitemap.txt'), 'utf8');

module.exports = async function (t) {
  const page = await t.page({ withBackend: false });
  let apiCalls = 0;
  page.on('request', r => { if (/\/api\//.test(r.url())) apiCalls++; });

  await page.goto(t.harness.toolUrl + '/index.html');
  await page.waitForFunction(() => !document.documentElement.classList.contains('gating') && !document.getElementById('qa-btn').disabled);
  t.check('the tool opens with no sign-in and no Sign out', /\/index\.html$/.test(new URL(page.url()).pathname) && !(await page.isVisible('#signout-btn')));

  await page.click('#tab-qa');
  t.check('Live URL and Crawl are not offered', !(await page.isVisible('#qa-source')));
  t.check('the Page card says nothing leaves the browser', /^Nothing leaves the browser\./.test(await page.textContent('#page-hint')));

  // Without a pasted sitemap there are no link suggestions, and it says how to get them.
  await page.fill('#html', BUILDERS);
  await page.click('#qa-btn');
  await page.waitForFunction(() => /SUMMARY/.test(document.getElementById('output').innerText));
  let text = await page.evaluate(() => document.getElementById('output').innerText);
  t.check('no sitemap: the Summary says to paste one', /Sitemap: none — link suggestions skipped\. Paste the site's sitemap in the Page card\./.test(text),
    (text.match(/Sitemap:[^\n]*/) || [''])[0]);
  t.check('the page is still judged: spelling and lists', /Misspelling — Commerical/.test(text) && /Typed numbering/.test(text));

  // A pasted sitemap is used.
  await page.evaluate(() => { document.getElementById('sitemap-box').open = true; });
  await page.fill('#sitemap-text', SITEMAP);
  await page.click('#qa-btn');
  await page.waitForFunction(() => /Sitemap: pasted, \d+ URLs/.test(document.getElementById('output').textContent));
  text = await page.evaluate(() => document.getElementById('output').innerText);
  t.check('a pasted sitemap gives link suggestions', /Sitemap: pasted, 204 URLs/.test(text) && /fixLink — "Get in touch"/.test(text), (text.match(/Sitemap:[^\n]*/) || [''])[0]);

  // Unticked, even a pasted sitemap is left alone.
  await page.uncheck('#page-sitemap-links');
  await page.waitForFunction(() => /Sitemap: not read/.test(document.getElementById('output').textContent));
  t.check('with Link suggestions off, the pasted sitemap is not used', true);

  t.check('nothing was sent to any backend', apiCalls === 0, apiCalls + ' calls');
};

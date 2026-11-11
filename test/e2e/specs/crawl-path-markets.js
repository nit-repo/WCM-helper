// Markets that live under a path on kone.com: a crawl of United States and
// India reads each market's own sitemap, never the corporate one at the root.
'use strict';

module.exports = async function (t) {
  const page = await t.qaPage();
  await page.click('[data-source="crawl"]');
  await page.click('[data-crawl-src="sites"]');
  await page.evaluate(() => { document.querySelector('details.markets').open = true; });
  await page.check('#crawl-markets input[data-market="United States"]');
  await page.check('#crawl-markets input[data-market="India"]');
  const sent = [];
  page.on('request', r => { if (/\/api\/discover/.test(r.url())) sent.push(JSON.parse(r.postData()).site); });
  await page.click('#crawl-btn');
  await page.waitForFunction(() => /Done —/.test(document.getElementById('output').textContent), null, { timeout: 40000 });
  const urls = await page.evaluate(() => [...document.querySelectorAll('table.crawl tbody td.url')].map(td => td.textContent.trim()));
  const text = await t.output(page);

  t.check('each market\'s own sitemap address is sent to the backend',
    sent.some(s => s.sitemap === 'https://www.kone.com/en-us/sitemap.xml') && sent.some(s => s.sitemap === 'https://www.kone.com/en-in/sitemap.xml'), JSON.stringify(sent));
  t.check('the US pages come from /en-us/sitemap.xml', urls.filter(u => /\/en-us/.test(u)).length === 2, urls.join(' '));
  t.check('the India pages come from /en-in/sitemap.xml', urls.filter(u => /\/en-in/.test(u)).length === 2, urls.join(' '));
  t.check('no corporate (/global/) pages are crawled', !urls.some(u => /\/global\//.test(u)));
  t.check('no "no sitemap" note', !/no sitemap could be read/.test(text), (text.match(/no sitemap[^\n]{0,120}/) || [''])[0]);
};

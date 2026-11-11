// Link checking on one page, and a crawl of two sites with the link pass:
// the per-site rollup, the filters, the broken-links table, opening a row.
'use strict';

module.exports = async function (t) {
  const es = p => t.harness.site('www.kone.es', p);
  const page = await t.qaPage();
  const grab = (text, re) => (text.match(re) || [''])[0];

  // Live URL with "Check its links too".
  await page.click('[data-source="live"]');
  await page.uncheck('#live-sitemap-links');
  await page.check('#live-links');
  await page.fill('#live-url', es('/contacto/'));
  await page.click('#live-btn');
  await page.waitForFunction(() => /Links\d+ checked/.test(document.getElementById('output').textContent), null, { timeout: 20000 });
  let text = await t.output(page);
  t.check('link check: 3 checked — 1 fine, 2 broken', /Links3 checked — 1 fine, 2 broken, 0 not verified/.test(text), grab(text, /Links\d[^\n]{0,60}/));
  t.check('link check: the broken external link, with where it sits',
    /Broken link \(external\) — answered 404Page body — "Contacto"/.test(text) && /external\.example:3710\/gone/.test(text), grab(text, /Broken link \(external\)[^\n]{0,120}/));
  t.check('link check: the broken KONE link', /Broken link \(KONE\) — answered 404/.test(text) && /kone\.es:3710\/roto\//.test(text));
  t.check('a page served over plain http is a fix', /HTTPS — the page was served over plain http/.test(text));
  t.check('Form Assembly ID 758 matches Spain', /Form Assembly IDSpain758matches the expected value/.test(text), grab(text, /Form Assembly ID[^\n]{0,60}/));
  await page.uncheck('#live-links');

  // A preview page behind a login is "unverified", never "broken".
  await page.fill('#live-url', t.harness.site('preview.kone.es', '/contacto/'));
  await page.click('#live-btn');
  await page.waitForFunction(() => /Behind login/.test(document.getElementById('output').textContent), null, { timeout: 20000 });
  text = await t.output(page);
  t.check('a preview page behind login is "could not verify", and points to the bookmarklet',
    /Could not verify the page/i.test(text) && /unverified Behind login \(401\) — capture it with the bookmarklet instead/.test(text), text.slice(0, 200));

  // A crawl of Spain and Belgium (FR), with the link pass.
  await page.click('[data-source="crawl"]');
  await page.click('[data-crawl-src="sites"]');
  await page.evaluate(() => { document.querySelector('details.markets').open = true; });
  await page.check('#crawl-markets input[data-market="Spain"]');
  await page.check('#crawl-markets input[data-market="Belgium (FR)"]');
  await page.uncheck('#crawl-sitemap-links');
  await page.check('#crawl-links');
  await page.click('#crawl-btn');
  await page.waitForFunction(() => /Done —/.test(document.getElementById('output').textContent), null, { timeout: 60000 });
  text = await page.evaluate(() => document.getElementById('output').innerText);
  t.check('crawl: totals line', /7 pages · 6 ok · 1 dead · 0 unverified · 6 with something to fix · 2 broken links/.test(text), grab(text, /\d+ pages · [^\n]+/));
  t.check('crawl: robots.txt disallowed URLs are skipped and said so', /Spain — 1 URL skipped: robots\.txt disallows them\./.test(text));
  t.check('crawl: kone.be keeps only its /fr pages', /kone\.be\/fr\nBelgium \(FR\)\t1\t/.test(text), grab(text, /kone\.be[^\n]*\n[^\n]*/));
  t.check('crawl: per-site rollup for Spain', /kone\.es\nSpain\t6\t5\t1\t0\t/.test(text), grab(text, /kone\.es\nSpain[^\n]*/));

  const rows = await t.crawlRows(page);
  const row = re => rows.filter(r => re.test(r))[0] || '';
  t.check('crawl: a dead page is a row with its answer', /Answered 404 \| 404/.test(row(/\/roto\//)), row(/\/roto\//));
  t.check('crawl: wrong Form ID (924 on a Spain page)', /wrong 924/.test(row(/\/titulo\//)), row(/\/titulo\//));
  t.check('crawl: another market\'s site name in the title is a fix', /\| fix \| right 758/.test(row(/\/india\//)), row(/\/india\//));
  t.check('crawl: broken links counted per page', /\| 2 \|$/.test(row(/\/contacto\//).replace(/\s*\|\s*$/, ' |')), row(/\/contacto\//));

  const broken = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#output section.card')].filter(c => /^Broken links/.test(c.querySelector('h3') ? c.querySelector('h3').textContent : ''));
    return cards.length ? cards[0].innerText : '';
  });
  t.check('crawl: the broken-links table lists each link once, with every page that carries it and where',
    /kone\.es:3710\/roto\/\tAnswered 404\t/.test(broken) && /external\.example:3710\/gone\tAnswered 404/.test(broken) && /Page body — "Contacto"/.test(broken), broken.slice(0, 300));

  // Filters narrow the table.
  await page.click('.filters .chip[data-filter="form"]');
  let shown = await t.crawlRows(page);
  t.check('filter: Form ID wrong shows only that page', shown.length === 1 && /\/titulo\//.test(shown[0]), shown.join('\n'));
  await page.click('.filters .chip[data-filter="dead"]');
  shown = await t.crawlRows(page);
  t.check('filter: Dead shows only the 404', shown.length === 1 && /\/roto\//.test(shown[0]), shown.join('\n'));
  await page.click('.filters .chip[data-filter="all"]');

  // A row opens that page's full report, and Back returns to the crawl.
  await page.click('table.crawl tbody tr.open-row:has(td.url:text-is("' + es('/titulo/') + '"))');
  await page.waitForSelector('#crawl-back');
  text = await t.output(page);
  t.check('opening a row shows that page\'s report',
    /Form Assembly IDSpain924differs from the expected value/.test(text) && /more than one|H1/.test(text), grab(text, /Form Assembly ID[^\n]{0,80}/));
  t.check('generic link text is flagged', /click here/.test(text) && /Link text/.test(text));
  await page.click('#crawl-back');
  await page.waitForSelector('table.crawl');
  t.check('Back returns to the crawl results', (await t.crawlRows(page)).length === 7);

  const csv = await t.downloadText(page, () => page.click('#crawl-csv'));
  t.check('CSV: one line per page plus the header, starting with a byte-order mark for Excel',
    csv.charCodeAt(0) === 0xFEFF && csv.split('\r\n').length === 8, csv.split('\r\n').length + ' lines');
};

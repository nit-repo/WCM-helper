// KONE US on kone.com/en-us: the real contact page with AEM's native forms,
// the crawl picker's areas and frontlines, and codes in a crawl URL list.
'use strict';

module.exports = async function (t) {
  const US = t.harness.site('www.kone.com', '/en-us/contact.html');
  const page = await t.qaPage();
  let text = '';
  const grab = re => (text.match(re) || [''])[0];

  // Live URL, link suggestions on: reads kone.com/en-us's own sitemap.
  await page.click('[data-source="live"]');
  await page.check('#live-sitemap-links');
  await page.fill('#live-url', US);
  await page.click('#live-btn');
  await page.waitForFunction(() => /Form market/.test(document.getElementById('output').textContent), null, { timeout: 20000 });
  await page.waitForFunction(() => /Sitemap: kone\.com\/en-us, \d+ URLs/.test(document.getElementById('output').textContent), null, { timeout: 20000 });
  text = await t.output(page);
  t.check('market is United States', /MarketUnited States/.test(text), grab(/Market[^\n]{0,40}/));
  t.check('Forms: the AEM sales form with its topic and lead fields',
    /AEM sales-form-with-sfdc\/sales-master"Adding new equipment to an existing building"Modernization \(FRB\) · koneCountry USA · site us\/en · 3 steps · reCAPTCHA v3 ✓ · submit ✓/.test(text),
    grab(/AEM sales-form-with-sfdc\/sales-master[^\n]{0,200}/));
  t.check('Forms: the customer-service form with no koneCountry, under its nested topic',
    /customer-service-master-variation-2\/master"Customer service › Content on this website"koneCountry none/.test(text),
    grab(/customer-service-master-variation-2\/master"[^\n]{0,120}/));
  t.check('Form Assembly ID row: AEM forms, 1488 not applicable',
    /Form Assembly IDUnited StatesAEM forms \(4\): [^\n]*AEM forms — FormAssembly 1488 not applicable/.test(text), grab(/Form Assembly IDUnited States[^\n]{0,60}/));
  t.check('Form market row matches, noting the two forms with no koneCountry',
    /Form marketUnited Statesfrontlines\/us\/en · koneCountry USAmatches the expected value — koneCountry missing on 2 forms/.test(text), grab(/Form marketUnited States[^\n]{0,140}/));
  t.check('the missing koneCountry is a check', /carry no koneCountry — confirm their leads route to United States/.test(text));
  t.check('title: "KONE Corporation" is not accepted, and the ending to use is named',
    /"KONE Corporation" is not accepted on United States pages — end the title with " \| KONE US"/.test(text));
  t.check('cross-market link: the header\'s "KONE global" item', /1 link to kone\.com\/global\/ \(the corporate site\)/.test(text));
  t.check('form accessibility: empty legends', /2 empty <legend>s/.test(text));
  t.check('header and footer belong to the market: no finding', !/Header\/footer market/.test(text));
  t.check('the sitemap read is kone.com/en-us\'s own', /Sitemap: kone\.com\/en-us, 2 URLs/.test(text), grab(/Sitemap:[^\n]{0,80}/));
  const aemHref = await page.evaluate(() => { const a = [...document.querySelectorAll('#output a')].find(x => x.textContent === 'Open in AEM'); return a ? a.href : null; });
  t.check('Open in AEM links to the page in the author tree',
    aemHref === 'https://author-p156420-e1658594.adobeaemcloud.com/ui#/aem/sites.html/content/frontlines/us-temp/en/contact', aemHref);
  t.check('the AEM line shows the path, and there is no TCM line on an AEM page',
    /AEM\/content\/frontlines\/us-temp\/en\/contact · Open in AEM/.test(text) && !/no pagetcmid on the page/.test(text), grab(/AEM\/content[^\n]{0,60}/));

  // The crawl picker: KONE's own area and frontline codes.
  await page.click('[data-source="crawl"]');
  const chips = await page.evaluate(() => ({
    areas: [...document.querySelectorAll('#crawl-areas .chip')].map(b => b.childNodes[0].textContent + ':' + b.querySelector('.n').textContent),
    frontlines: [...document.querySelectorAll('#crawl-frontlines .chip')].map(b => b.childNodes[0].textContent + ':' + b.querySelector('.n').textContent),
    tip: (document.querySelector('#crawl-frontlines .chip[data-value="ITIB"]') || {}).title
  }));
  t.check('areas are EU, APM, AME', chips.areas.join(' ') === 'EU:25 APM:22 AME:3', chips.areas.join(' '));
  t.check('the ten frontlines', chips.frontlines.join(' ') === 'ITIB:3 EEM:8 GIN:3 NORD:8 FBL:3 KANZ:2 KMTA:13 KSEA:6 KEI:1 USCA:3', chips.frontlines.join(' '));
  t.check('a frontline\'s tooltip names its markets', chips.tip === 'ITIB — Italy, Spain, Portugal', chips.tip);
  await page.click('#crawl-frontlines .chip[data-value="ITIB"]');
  const picked = await page.textContent('#crawl-picked');
  t.check('clicking ITIB picks its 3 markets', picked === '3 of 50 picked', picked);
  await page.click('[data-pick="none"]');

  // A crawl URL list: a frontline code beside a URL, and a word that is neither.
  await page.click('[data-crawl-src="list"]');
  await page.fill('#crawl-urls', 'ITIB\n' + US + '\nfoo');
  await page.uncheck('#crawl-sitemap-links');
  await page.fill('#crawl-limit', '1');
  const discovered = [];
  page.on('request', r => { if (/\/api\/discover/.test(r.url())) discovered.push(JSON.parse(r.postData() || '{}').site); });
  await page.click('#crawl-btn');
  await page.waitForFunction(() => /Done —/.test(document.getElementById('output').textContent), null, { timeout: 40000 });
  const rows = await t.crawlRows(page);
  t.check('ITIB in the list discovers Italy, Spain and Portugal', discovered.map(s => s.domain).sort().join(',') === 'kone.es,kone.it,kone.pt', JSON.stringify(discovered));
  t.check('the US row shows AEM ×4 with a check pill', rows.some(r => /en-us\/contact\.html/.test(r) && /AEM ×4 check/.test(r)), rows.join('\n'));
  t.check('the US row offers Open in AEM in the TCM ID / AEM column', rows.some(r => /en-us\/contact\.html/.test(r) && /Open in AEM$/.test(r)));
  t.check('the ITIB pages are crawled beside it', rows.length === 4, rows.length + ' rows');
  text = await t.output(page);
  t.check('"foo" is skipped and named', /"foo" skipped — not a URL or an area\/frontline code/.test(text));

  const csv = await t.downloadText(page, () => page.click('#crawl-csv'));
  const head = csv.split('\r\n')[0];
  t.check('CSV: AEM path and Open in AEM columns', head.indexOf('"AEM path","Open in AEM"') !== -1);
  t.check('CSV: AEM form columns',
    ['Form provider', 'Form market', 'AEM form paths', 'AEM site', 'koneCountry', 'Business types'].every(h => head.indexOf('"' + h + '"') !== -1));
  const usLine = csv.split('\r\n').filter(l => /en-us\/contact/.test(l))[0] || '';
  t.check('CSV: the US row\'s values',
    /"AEM"/.test(usLine) && /"check"/.test(usLine) && /"us\/en"/.test(usLine) && /"USA \| none"/.test(usLine) && /Modernization \(FRB\) \| Modernization \(TRB\)/.test(usLine),
    usLine.slice(0, 300));
};

// Redirect chains, loops and load time, in the Live URL report and the crawl.
'use strict';

module.exports = async function (t) {
  const es = p => t.harness.site('www.kone.es', p);
  const page = await t.qaPage();
  const live = async (url, done) => {
    await page.fill('#live-url', url);
    await page.click('#live-btn');
    await page.waitForFunction(done, null, { timeout: 20000 });
    return t.output(page);
  };
  const reported = () => /Read the page content from|The page is broken/i.test(document.getElementById('output').textContent) &&
    !/Asking the backend|Timing: fetch/.test(document.getElementById('output').textContent);
  const grab = (text, re) => (text.match(re) || [''])[0];

  await page.click('[data-source="live"]');
  await page.uncheck('#live-sitemap-links');

  // Four redirects: one more than the three allowed.
  let text = await live(es('/cadena/4/'), reported);
  t.check('chain: 4 redirects carry a fix pill', /Redirectsfix 4 redirects/.test(text), grab(text, /Redirects[^\n]{0,60}/));
  t.check('chain: every hop is shown with its status',
    /\/cadena\/4\/ \(301\) → [^ ]*\/cadena\/3\/ \(302\) → [^ ]*\/cadena\/2\/ \(301\) → [^ ]*\/cadena\/1\/ \(302\) → [^ ]*\/contacto\//.test(text), grab(text, /cadena\/4\/ \(301\)[^\n]{0,200}/));
  t.check('chain: reported under Hyperlinks as more than 3', /4 redirects — more than 3/.test(text), grab(text, /Redirect chain[^\n]{0,160}/));
  t.check('chain: load time says how much of it was redirects', /Load timeTTFB [\d.]+ s · HTML [\d.]+ s \([\d.]+ s of it redirects\)/.test(text), grab(text, /Load time[^\n]{0,80}/));

  // One redirect is not a finding.
  text = await live(es('/redir/'), reported);
  t.check('one redirect: shown, with a pass pill', /Redirectspass 1 redirect/.test(text) && !/Redirect chain/.test(text), grab(text, /Redirects[^\n]{0,60}/));

  // A loop is a broken page, and the loop is spelled out.
  text = await live(es('/bucle/'), reported);
  t.check('loop: the page is reported broken, with the loop shown',
    /The page is broken/i.test(text) && /Redirect loop — [^ ]*\/bucle\/ → [^ ]*\/bucle2\/ → [^ ]*\/bucle\//.test(text), text.slice(0, 200));

  // A slow first byte is a check; the report says where it was measured from.
  text = await live(es('/lento/'), reported);
  t.check('slow page: TTFB over 0.8 s is marked', /Load timeTTFB 0\.9\d s/.test(text), grab(text, /Load time[^\n]{0,60}/));
  t.check('slow page: a Server response (TTFB) check', /Server response \(TTFB\)/.test(text) && /over 0\.80? s/.test(text), grab(text, /Server response[^\n]{0,160}/));
  t.check('timings say they are measured from the backend, HTML only', /Measured from the backend's server, not from the market's country, HTML only/.test(text));
  const psi = await page.evaluate(() => { const a = [...document.querySelectorAll('#output a')].find(x => /PageSpeed/.test(x.textContent)); return a ? a.href : null; });
  t.check('and link to PageSpeed Insights for this URL', /^https:\/\/pagespeed\.web\.dev\/.*lento/.test(psi || ''), psi);

  // "Time it 3 times": three fetches, one report, the average shown.
  let fetches = 0;
  const count = r => { if (/\/api\/fetch/.test(r.url())) fetches++; };
  page.on('request', count);
  await page.check('#live-runs');
  text = await live(es('/contacto/'), () => /average of 3 fetches/.test(document.getElementById('output').textContent));
  page.off('request', count);
  t.check('3 runs: three fetch calls', fetches === 3, fetches + ' calls');
  t.check('3 runs: the report says average of 3, with each time', /average of 3 fetches \([\d.]+ s, [\d.]+ s, [\d.]+ s\)/.test(text), grab(text, /average of[^\n]{0,60}/));
  await page.reload();
  await t.ready(page);
  await page.click('#tab-qa');
  await page.click('[data-source="live"]');
  t.check('3 runs: the option is remembered after a reload', await page.isChecked('#live-runs'));
  await page.uncheck('#live-runs');

  // The crawl: Redirects and TTFB / load columns, and the loop as a failed row.
  await page.click('[data-source="crawl"]');
  await page.click('[data-crawl-src="list"]');
  await page.fill('#crawl-urls', [es('/contacto/'), es('/cadena/4/'), es('/bucle/'), es('/lento/')].join('\n'));
  await page.uncheck('#crawl-sitemap-links');
  await page.click('#crawl-btn');
  await page.waitForFunction(() => /Done —/.test(document.getElementById('output').textContent), null, { timeout: 40000 });
  const heads = await page.evaluate(() => [...document.querySelectorAll('table.crawl thead th')].map(th => th.textContent));
  t.check('crawl table has Redirects and TTFB / load columns', heads.indexOf('Redirects') !== -1 && heads.indexOf('TTFB / load') !== -1, heads.join(' | '));
  const rows = await t.crawlRows(page);
  const row = re => rows.filter(r => re.test(r))[0] || '';
  t.check('crawl: the chain row shows 4 redirects', /\| 200 \| 4 \|/.test(row(/cadena/)), row(/cadena/));
  t.check('crawl: the loop row says loop, with the reason', /Redirect loop/.test(row(/bucle/)) && /\| loop \|/.test(row(/bucle/)), row(/bucle/));
  t.check('crawl: the slow row shows its TTFB / load', /0\.9\d \/ 0\.9\d s/.test(row(/lento/)), row(/lento/));
  const filters = await page.evaluate(() => [...document.querySelectorAll('.filters .chip')].map(b => b.textContent));
  t.check('crawl: filters for redirects and slow pages', filters.some(f => /^Redirects/.test(f)) && filters.some(f => /^Slow/.test(f)), filters.join(' | '));

  const csv = await t.downloadText(page, () => page.click('#crawl-csv'));
  const head = csv.split('\r\n')[0];
  t.check('CSV: redirect and timing columns',
    ['Redirects', 'Redirect chain', 'Redirect time (ms)', 'TTFB (ms)', 'Load time (ms)', 'Size (bytes)'].every(h => head.indexOf('"' + h + '"') !== -1), head.slice(0, 200));
  t.check('CSV: the chain is written out', /cadena\/4\/ \(301\) → /.test(csv));
};

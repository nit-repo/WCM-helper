// FormAssembly forms: the real kone.ae page (form injected by AEM's
// component), pasted rendered markup, and a crawl list naming expected ids.
'use strict';

// Made up, from the team's form 752 example: FormAssembly's rendered markup.
const TFA = '<!DOCTYPE html><html lang="en"><head><title>Contact us | KONE</title><link rel="canonical" href="https://www.kone.ae/about-kone/contact.html"></head><body><main><h1>Contact us</h1>' +
  '<div class="wForm" id="752-WRPR" data-language="en_GB"><h3 class="wFormTitle">Contact us</h3>' +
  '<form method="post" action="https://kone.tfaforms.net/api_v2/rest/workflow/processor" id="752">' +
  '<div id="g-recaptcha-render-div"></div><input type="submit" id="submit_button" value="Submit">' +
  '<input type="hidden" value="752" name="tfa_dbFormId" id="tfa_dbFormId"><input type="hidden" value="27" name="tfa_dbVersionId" id="tfa_dbVersionId"></form></div></main></body></html>';

module.exports = async function (t) {
  const AE = t.harness.site('www.kone.ae', '/modernization/elevator-modernization.html');
  const page = await t.qaPage();
  const grab = (text, re) => (text.match(re) || [''])[0];

  // Live URL: the real kone.ae page.
  await page.click('[data-source="live"]');
  await page.uncheck('#live-sitemap-links');
  await page.fill('#live-url', AE);
  await page.click('#live-btn');
  await page.waitForFunction(() => /Form1491/.test(document.getElementById('output').textContent), null, { timeout: 20000 });
  let text = await t.output(page);
  t.check('Live URL: the form line names 1491 from the embed script, AEM component',
    /Form1491 from embed script URL · AEM form component/.test(text), grab(text, /Form1491[^\n]{0,80}/));
  t.check('Live URL: the form is placed under its section, with its anchor', /Page body — "Find the right solution for you" · #form-assembly/.test(text));
  t.check('Live URL: says the form is injected by script', /Injected by script when the page loads/.test(text));
  t.check('Live URL: Form Assembly ID is a fix, 1491 against the UAE\'s 752',
    /embeds FormAssembly form 1491 \(kone\.tfaforms\.net\/publish\/1491\), but UAE pages are expected to use 752/.test(text));
  t.check('Live URL: the row reads UAE · 1491 · differs', /Form Assembly IDUAE1491differs from the expected value/.test(text), grab(text, /Form Assembly IDUAE[^\n]{0,80}/));
  t.check('Live URL: no AEM line on a market with no AEM author tree', !/Open in AEM/.test(text));

  // A pasted page with FormAssembly's rendered markup.
  await page.click('[data-source="page"]');
  await page.uncheck('#page-sitemap-links');
  await page.fill('#html', TFA);
  await page.click('#qa-btn');
  await page.waitForFunction(() => /Form752/.test(document.getElementById('output').textContent));
  text = await t.output(page);
  t.check('Pasted markup: id, source, title read', /Form752 from tfa_dbFormId · form markup · "Contact us"/.test(text), grab(text, /Form752[^\n]{0,120}/));
  t.check('Pasted markup: post host, version, language, submit button and CAPTCHA read',
    /posts to kone\.tfaforms\.net · version 27 · language en_GB · submit button ✓ · CAPTCHA ✓/.test(text), grab(text, /posts to[^\n]{0,120}/));
  t.check('Pasted markup: 752 matches the UAE, nothing to fix about the form', !/Form wiring/.test(text) && !/expected to use/.test(text));

  // A crawl URL list naming the expected form id; the header line is skipped.
  await page.click('[data-source="crawl"]');
  await page.click('[data-crawl-src="list"]');
  await page.fill('#crawl-urls', 'url,expected_form_id\n' + AE + ', 1491');
  await page.uncheck('#crawl-sitemap-links');
  await page.click('#crawl-btn');
  await page.waitForFunction(() => /Done —/.test(document.getElementById('output').textContent), null, { timeout: 30000 });
  const rows = await t.crawlRows(page);
  t.check('Crawl list: one page, and 1491 is right because the list named it', rows.length === 1 && /right 1491/.test(rows[0]), rows.join('\n'));
  const csv = await t.downloadText(page, () => page.click('#crawl-csv'));
  const head = csv.split('\r\n')[0];
  t.check('CSV: form columns present',
    ['Form ID', 'Form ID found', 'Expected form ID', 'Embed', 'Form ID source', 'Post host', 'Submit button', 'CAPTCHA'].every(h => head.indexOf('"' + h + '"') !== -1), head);
  t.check('CSV: the row carries matches · 1491 · expected 1491', /"matches","1491","1491"/.test(csv), grab(csv, /"matches"[^\n]{0,60}/));
};

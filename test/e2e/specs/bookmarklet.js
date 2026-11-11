// The bookmarklet: a page opened from QA's launcher sends its own HTML back
// to the tab that opened it. The bookmarklet's real code is taken from its
// install page and run on the opened page, as a click on the bookmark would.
'use strict';

module.exports = async function (t) {
  // The install page builds the bookmarklet for this tool's own origin.
  const install = await t.page();
  await install.goto(t.harness.toolUrl + '/bookmarklet.html');
  await install.waitForFunction(() => /^javascript:/.test(document.getElementById('bookmarklet-link').getAttribute('href')));
  const href = await install.getAttribute('#bookmarklet-link', 'href');
  const code = decodeURI(href.replace(/^javascript:/, ''));
  t.check('the install page builds a javascript: bookmarklet', /WCM_PAGE_CAPTURE/.test(code));
  t.check('it sends only to this tool\'s origin, never "*"', code.indexOf('postMessage(p,"' + t.harness.toolUrl + '")') !== -1 && code.indexOf('"*"') === -1);
  await install.click('#bookmarklet-link');
  t.check('clicking the link on the install page goes nowhere', /\/bookmarklet\.html$/.test(new URL(install.url()).pathname));
  await install.close();

  // QA → Open page → the bookmarklet on the opened page.
  const page = await t.qaPage();
  await page.uncheck('#page-sitemap-links');
  const target = t.harness.site('www.kone.es', '/titulo/');
  await page.fill('#page-url', target);
  const [opened] = await Promise.all([page.waitForEvent('popup'), page.click('#launch-btn')]);
  await opened.waitForLoadState('domcontentloaded');
  t.check('Open page opens the page in a new tab', opened.url() === target, opened.url());

  await opened.evaluate(code);
  await page.waitForFunction(() => document.getElementById('html').value.length > 0, null, { timeout: 10000 });
  const html = await page.inputValue('#html');
  t.check('the page\'s HTML lands in QA\'s Page box', /<h1>Uno<\/h1><h1>Dos<\/h1>/.test(html), html.slice(0, 120));
  await page.waitForFunction(() => /Form Assembly ID/.test(document.getElementById('output').textContent));
  const text = await t.output(page);
  t.check('and QA runs on it straight away', /Form Assembly IDSpain924differs from the expected value/.test(text), (text.match(/Form Assembly ID[^\n]{0,80}/) || [''])[0]);
  const overlay = await opened.evaluate(() => { const d = document.getElementById('__wcmh__'); return d ? d.textContent : ''; });
  t.check('the opened page says it was sent', /Sent to WCM Helper/.test(overlay), overlay.slice(0, 80));

  // On a page not opened from the tool, it says so instead of opening anything.
  const lone = await page.context().newPage();
  await lone.goto(target);
  await lone.evaluate(code);
  const alone = await lone.evaluate(() => { const d = document.getElementById('__wcmh__'); return d ? d.textContent : ''; });
  t.check('on a page opened any other way, it says there is nowhere to send it', /Nowhere to send it/.test(alone), alone.slice(0, 80));
};

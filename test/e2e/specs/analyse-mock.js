// The Analyse tab: reading a brief, building its mock page in a sandboxed
// frame, and handing the mock to QA. No backend involved.
'use strict';

const fs = require('fs');
const path = require('path');
const BRIEF = fs.readFileSync(path.join(__dirname, '..', '..', 'fixtures', 'unmarked-content-brief.txt'), 'utf8');

module.exports = async function (t) {
  const page = await t.page({ withBackend: false });
  await page.goto(t.harness.toolUrl + '/index.html');
  await page.waitForFunction(() => !document.documentElement.classList.contains('gating') && !document.getElementById('analyse-btn').disabled);
  const output = () => page.evaluate(() => document.getElementById('output').innerText);

  // The built-in sample brief: a page removal on a Tridion site.
  await page.click('#sample-btn');
  await page.click('#analyse-btn');
  await page.waitForFunction(() => /TYPE OF WORK/i.test(document.getElementById('output').innerText));
  let text = await output();
  t.check('the sample brief is read as a page removal on Tridion, with the reason shown',
    /Page removal/.test(text) && /Tridion — The page URL carries \.aspx/.test(text), text.slice(0, 200));
  t.check('the analysis lists what the job needs and how to do it', /WHAT THIS NEEDS/i.test(text) && /HOW TO DO IT IN TRIDION/i.test(text));

  // A real content brief (kone.in blog page): its mock page.
  await page.fill('#brief', BRIEF);
  await page.click('#mock-btn');
  await page.waitForSelector('#mock-preview');
  const frame = page.frames().find(f => f !== page.mainFrame());
  const sandbox = await page.getAttribute('#mock-preview', 'sandbox');
  t.check('the mock page renders in a frame with every sandbox restriction on', sandbox === '' && !!frame, 'sandbox=' + JSON.stringify(sandbox));
  const mockText = frame ? await frame.evaluate(() => document.body.innerText) : '';
  t.check('the mock page carries the brief\'s headline', /Residential Elevators vs Commercial Elevators/.test(mockText), mockText.slice(0, 200));
  text = await output();
  t.check('the outline beside it names the page', /PAGE:/i.test(text), text.slice(0, 120));

  // Send to QA: the mock's HTML lands in the QA tab's Page box.
  await page.click('#send-to-qa');
  await page.waitForFunction(() => document.getElementById('tab-qa').getAttribute('aria-selected') === 'true');
  const sent = await page.inputValue('#html');
  t.check('Send to QA puts the mock page into QA', sent.length > 1000 && /Residential Elevators vs Commercial Elevators/.test(sent), sent.length + ' characters');
  t.check('the brief is still there for QA to check against', (await page.inputValue('#brief')).length === BRIEF.length);
};

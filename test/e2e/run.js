// test/e2e/run.js — the browser tests: the real tool, in a real browser,
// against the real backend and stand-in KONE sites (see harness.js).
//
// Run: npm run test:e2e            (every spec in specs/)
//      npm run test:e2e -- crawl   (only specs whose file name contains "crawl")
//
// Each spec gets a fresh browser context — its own localStorage and sign-in —
// and exports async function (t). t.check(label, ok, detail) records one
// check; a spec that throws fails as a whole. Any Content-Security-Policy
// violation or uncaught page error in any spec is itself a failed check: the
// deployed site sends the same policy.

'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const harness = require('./harness');

const SPECS = path.join(__dirname, 'specs');

async function main() {
  const only = process.argv[2];
  const files = fs.readdirSync(SPECS).filter(f => /\.js$/.test(f) && (!only || f.indexOf(only) !== -1)).sort();
  const servers = await harness.start();
  // The browser itself only ever opens localhost — except the bookmarklet
  // spec, which opens a fake KONE page as an author would; that host is
  // mapped to this machine, and no proxy is used.
  const browser = await chromium.launch({ args: ['--no-sandbox', '--no-proxy-server', '--host-resolver-rules=MAP www.kone.es 127.0.0.1'] });
  let passed = 0, failed = 0;

  for (const file of files) {
    console.log('\n' + file);
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true });
    const problems = [];
    const t = {
      harness,
      check(label, ok, detail) {
        if (ok) { passed++; console.log('  ok   ' + label); }
        else { failed++; console.log('  FAIL ' + label + (detail == null ? '' : '\n       ' + String(detail).slice(0, 600))); }
      },
      // A new tab that reports CSP violations and page errors. withBackend:
      // false serves config/backend.json with no backend, as a deployment
      // without one would.
      async page(options) {
        const opts = Object.assign({ withBackend: true }, options);
        const p = await context.newPage();
        p.on('pageerror', e => problems.push('page error: ' + e.message));
        p.on('console', m => {
          if (m.type() === 'error' && /Content Security Policy|Refused to/i.test(m.text())) problems.push('CSP: ' + m.text());
        });
        await p.route('**/config/backend.json*', r => r.fulfill({
          contentType: 'application/json',
          body: JSON.stringify(opts.withBackend ? { url: '', devUrl: harness.backendUrl } : { url: '', devUrl: '' })
        }));
        return p;
      },
      // Signed in, on the QA tab.
      async qaPage(options) {
        const p = await t.page(options);
        await p.goto(harness.toolUrl + '/login.html');
        await p.fill('#password', harness.PASSWORD);
        await p.click('#login-btn');
        await p.waitForURL(u => /\/index\.html$/.test(u.pathname));
        await t.ready(p);
        await p.click('#tab-qa');
        return p;
      },
      ready: p => p.waitForFunction(() => !document.documentElement.classList.contains('gating') && !document.getElementById('qa-btn').disabled),
      output: p => p.evaluate(() => document.getElementById('output').textContent),
      // The rows of the crawl's Pages table (not the per-site rollup or the broken-links table).
      crawlRows: p => p.evaluate(() => {
        const pages = [...document.querySelectorAll('table.crawl')].filter(tb => [...tb.querySelectorAll('thead th')].some(th => th.textContent === 'Status'))[0];
        return pages ? [...pages.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).join(' | ')) : [];
      }),
      async downloadText(p, click) {
        const [dl] = await Promise.all([p.waitForEvent('download'), click()]);
        return fs.readFileSync(await dl.path(), 'utf8');
      }
    };
    try {
      await require(path.join(SPECS, file))(t);
    } catch (e) {
      failed++;
      console.log('  FAIL ' + file + ' stopped: ' + (e && e.message ? e.message.split('\n')[0] : e));
    }
    t.check('no Content-Security-Policy violations or page errors', !problems.length, problems.join(' / '));
    await context.close();
  }

  await browser.close();
  await servers.stop();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });

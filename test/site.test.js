// test/site.test.js — the deployed site's own safety rules.
// Run: npm test
//
// The tool is static files plus response headers from vercel.json. These
// checks keep the pieces that have to agree in agreement: the pages carry
// no inline script (the Content-Security-Policy would block it), the policy
// lets the pages reach the backend they are configured for, every page
// carries one build string, and files the site has no use for are not
// published with it.

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
function read(file) { return fs.readFileSync(path.join(ROOT, file), 'utf8'); }

var vercel = JSON.parse(read('vercel.json'));
var backend = JSON.parse(read('config/backend.json'));
var pkg = JSON.parse(read('package.json'));
var setVersion = require('../scripts/set-version.js');
var serve = require('../serve.js');
var PAGES = setVersion.PAGES;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

function headers() {
  var out = {};
  vercel.headers.forEach(function (rule) {
    if (rule.source === '/(.*)') rule.headers.forEach(function (h) { out[h.key] = h.value; });
  });
  return out;
}
function directive(csp, name) {
  var m = new RegExp('(?:^|;\\s*)' + name + '\\s+([^;]*)').exec(csp);
  return m ? m[1].trim().split(/\s+/) : null;
}
function scriptTags(html) {
  // Comments blanked first: a commented-out tag is not on the page.
  return html.replace(/<!--[\s\S]*?-->/g, '').match(/<script\b[^>]*>/gi) || [];
}

console.log('WCM Helper — site rules');

test('1. the pages are the three the version script knows, and each exists', function () {
  assert.deepStrictEqual(PAGES, ['index.html', 'login.html', 'bookmarklet.html']);
  PAGES.forEach(function (p) { assert.ok(read(p).length > 0, p); });
});

test('2. no page carries an inline script or an on…= handler — the policy would block both', function () {
  PAGES.forEach(function (p) {
    var html = read(p).replace(/<!--[\s\S]*?-->/g, '');
    scriptTags(html).forEach(function (tag) {
      assert.ok(/\ssrc="[^"]+"/.test(tag), p + ': a <script> with no src — ' + tag);
      assert.ok(!/\ssrc="(https?:)?\/\//.test(tag), p + ': a script from another origin — ' + tag);
    });
    var handler = /<[a-z][^>]*\son[a-z]+\s*=/i.exec(html);
    assert.ok(!handler, p + ': an inline event handler — ' + (handler && handler[0].slice(0, 80)));
    assert.ok(!/href="javascript:/i.test(html), p + ': a javascript: link written into the page');
  });
});

test('3. every script tag on every page carries the same build string', function () {
  assert.strictEqual(setVersion.current().length, 1, 'more than one build string: ' + setVersion.current().join(', '));
  PAGES.forEach(function (p) {
    scriptTags(read(p)).forEach(function (tag) {
      assert.ok(/\?v=[\w.-]+"/.test(tag), p + ': a script tag with no ?v= — ' + tag);
    });
  });
});

test('4. the version script reads build strings and refuses a malformed one', function () {
  assert.deepStrictEqual(setVersion.versionsIn('<script src="a.js?v=2026-01-01a"></script><script src="b.js?v=2026-01-01a"></script>'), ['2026-01-01a']);
  assert.deepStrictEqual(setVersion.versionsIn('<script src="a.js?v=1"></script><script src="b.js?v=2"></script>'), ['1', '2']);
  assert.throws(function () { setVersion.set('2026 01 01'); }, /letters, digits, dots and dashes/);
  assert.throws(function () { setVersion.set('"><script>'); }, /letters, digits, dots and dashes/);
});

test('5. Content-Security-Policy: scripts from this site only, nothing may frame it, no plugins', function () {
  var csp = headers()['Content-Security-Policy'];
  assert.ok(csp, 'no Content-Security-Policy header');
  assert.deepStrictEqual(directive(csp, 'default-src'), ["'self'"]);
  assert.deepStrictEqual(directive(csp, 'script-src'), ["'self'"], 'no inline, eval or third-party script');
  assert.deepStrictEqual(directive(csp, 'object-src'), ["'none'"]);
  assert.deepStrictEqual(directive(csp, 'frame-ancestors'), ["'none'"]);
  assert.deepStrictEqual(directive(csp, 'base-uri'), ["'self'"]);
  assert.deepStrictEqual(directive(csp, 'form-action'), ["'self'"]);
  assert.ok(!/unsafe-eval/.test(csp));
});

test('6. the policy lets the pages call the backend they are configured for, and nothing else', function () {
  var connect = directive(headers()['Content-Security-Policy'], 'connect-src');
  assert.ok(backend.url, 'config/backend.json names no backend');
  var origin = new URL(backend.url).origin;
  assert.ok(connect.indexOf(origin) !== -1, 'connect-src does not allow ' + origin + ' — the tool could not reach its backend');
  assert.deepStrictEqual(connect.slice().sort(), ["'self'", origin].sort());
});

test('7. the other security headers are set', function () {
  var h = headers();
  assert.strictEqual(h['X-Content-Type-Options'], 'nosniff');
  assert.strictEqual(h['X-Frame-Options'], 'DENY');
  assert.strictEqual(h['Referrer-Policy'], 'no-referrer');
  assert.ok(/camera=\(\)/.test(h['Permissions-Policy']));
  assert.strictEqual(h['Cache-Control'], 'public, max-age=0, must-revalidate', 'unchanged: pages always revalidate');
});

test('8. the local server sends the deployed headers, plus the local backend in connect-src', function () {
  var local = serve.siteHeaders(), deployed = headers();
  Object.keys(deployed).forEach(function (k) {
    if (k !== 'Content-Security-Policy') assert.strictEqual(local[k], deployed[k], k);
  });
  var connect = directive(local['Content-Security-Policy'], 'connect-src');
  assert.ok(connect.indexOf('http://localhost:*') !== -1);
  assert.strictEqual(local['Content-Security-Policy'].replace(/ http:\/\/localhost:\* http:\/\/127\.0\.0\.1:\*/, ''), deployed['Content-Security-Policy']);
});

test('9. files the site has no use for are not published — but nothing the backend project needs is dropped', function () {
  var ignored = read('.vercelignore').split('\n').map(function (l) { return l.trim(); })
    .filter(function (l) { return l && l.charAt(0) !== '#'; });
  ['test', 'scripts', '.github', '*.md'].forEach(function (entry) {
    assert.ok(ignored.indexOf(entry) !== -1, entry + ' is not in .vercelignore');
  });
  // The backend is deployed from this same repo and reads config/sites.json.
  ['backend', 'config', 'backend/', 'config/'].forEach(function (entry) {
    assert.ok(ignored.indexOf(entry) === -1, entry + ' must not be ignored: the backend project deploys from this repo');
  });
  var hidden = (vercel.redirects || []).filter(function (r) { return r.source === '/backend/:path*'; })[0];
  assert.ok(hidden && hidden.destination === '/', 'the site does not keep /backend/ out of reach');
});

test('10. the tool still ships with no runtime dependencies, and deploying installs nothing', function () {
  assert.ok(!pkg.dependencies || !Object.keys(pkg.dependencies).length, 'a runtime dependency was added');
  assert.strictEqual(vercel.installCommand, '', 'the deploy would install the dev-only packages');
  assert.strictEqual(vercel.buildCommand, null);
  Object.keys(pkg.devDependencies).forEach(function (name) {
    assert.ok(/^\d+\.\d+\.\d+$/.test(pkg.devDependencies[name]), name + ' is not pinned to an exact version');
  });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

// test/backend.test.js — the live-fetch backend, without the live internet.
// Run: npm test
//
// The sandbox this is built in cannot reach kone.* at all, and a test that
// needs the internet is a test that flakes. So a local server plays
// www.kone.es: the fetcher is pointed at it through an injected resolver,
// with private addresses allowed for that one fetcher only. Every other
// test runs the guard as it ships — and the first thing it proves is that
// the same 127.0.0.1 is refused without that test-only allowance.

var assert = require('assert');
var http = require('http');
var zlib = require('zlib');
var guard = require('../backend/lib/guard');
var fetcherLib = require('../backend/lib/fetcher');
var sitemapLib = require('../backend/lib/sitemap');
var auth = require('../backend/lib/auth');
var handlers = require('../backend/lib/handlers');
var sites = require('../config/sites.json');

var passed = 0, failed = 0, queue = [];
function test(name, fn) { queue.push({ name: name, fn: fn }); }
function runAll() {
  return queue.reduce(function (p, t) {
    return p.then(function () { return t.fn(); })
      .then(function () { passed++; console.log('  ok   ' + t.name); },
        function (e) { failed++; console.log('  FAIL ' + t.name + '\n       ' + (e && e.message)); });
  }, Promise.resolve());
}

var bases = guard.koneBases(sites);

// ─── the fake KONE site ────────────────────────────────────────────────────
var PORT = 0;
var PAGE = '<!DOCTYPE html><html lang="es"><head><title>Contacto | KONE España</title>' +
  '<link rel="canonical" href="https://www.kone.es/contacto/"></head><body><main><h1>Contacto</h1></main></body></html>';

function sitemapXml(paths) {
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    paths.map(function (p) { return '<url><loc>' + (/^https?:/.test(p) ? p : 'http://www.kone.es:' + PORT + p) + '</loc></url>'; }).join('') +
    '</urlset>';
}

var server = http.createServer(function (req, res) {
  var host = String(req.headers.host || '').split(':')[0];
  var url = req.url;
  function send(status, type, body, extra) {
    res.writeHead(status, Object.assign({ 'content-type': type }, extra || {}));
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  if (host === 'preview.kone.es') return send(401, 'text/html', 'login required');
  if (host === 'evil.example') return send(200, 'text/html', '<p>not KONE</p>');
  if (host === 'www.kone.be') {
    if (url === '/robots.txt') return send(200, 'text/plain', 'Sitemap: http://www.kone.be:' + PORT + '/sitemap.xml');
    if (url === '/sitemap.xml') {
      return send(200, 'application/xml', '<urlset>' + ['/fr/a/', '/fr/b/', '/nl/a/', '/nl/new-buildings/x/', '/fr/new-buildings/y/']
        .map(function (p) { return '<url><loc>http://www.kone.be:' + PORT + p + '</loc></url>'; }).join('') + '</urlset>');
    }
  }
  switch (url) {
    case '/page': return send(200, 'text/html; charset=utf-8', zlib.gzipSync(PAGE), { 'content-encoding': 'gzip' });
    case '/redirect': return send(301, 'text/html', '', { location: '/redirect2' });
    case '/redirect2': return send(302, 'text/html', '', { location: '/page' });
    case '/off': return send(302, 'text/html', '', { location: 'http://evil.example:' + PORT + '/x' });
    case '/login-redir': return send(302, 'text/html', '', { location: '/sso/login?next=/x' });
    case '/loop': return send(302, 'text/html', '', { location: '/loop' });
    case '/missing': return send(404, 'text/html', 'gone');
    case '/boom': return send(503, 'text/html', 'down');
    case '/blocked': return send(403, 'text/html', 'no bots');
    case '/big': return send(200, 'text/html', '<html>' + 'x'.repeat(5000) + '</html>');
    case '/pdf': return send(200, 'application/pdf', '%PDF-1.4');
    case '/slow': return; // never answers
    case '/head405':
      if (req.method === 'HEAD') return send(405, 'text/plain', '');
      return send(200, 'text/html', PAGE);
    case '/robots.txt':
      return send(200, 'text/plain', 'User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private/\nAllow: /private/open/\n' +
        'Sitemap: http://www.kone.es:' + PORT + '/sitemap_index.xml\n');
    case '/sitemap_index.xml':
      return send(200, 'application/xml', '<?xml version="1.0"?><sitemapindex>' +
        '<sitemap><loc>http://www.kone.es:' + PORT + '/sitemap-1.xml</loc></sitemap>' +
        '<sitemap><loc>http://www.kone.es:' + PORT + '/sitemap-2.xml.gz</loc></sitemap></sitemapindex>');
    case '/sitemap-1.xml':
      return send(200, 'application/xml', sitemapXml(['/', '/contacto/', '/private/secret/', '/private/open/ok/', 'https://www.kone.de/x/', '/a?x=1&amp;y=2']));
    case '/sitemap-2.xml.gz':
      return send(200, 'application/x-gzip', zlib.gzipSync(sitemapXml(['/new-buildings/', '/new-buildings/escalators/', '/contacto/'])));
    default: return send(404, 'text/html', 'no');
  }
});

function localResolve(host, cb) {
  if (/(^|\.)kone\.(es|be)$/.test(host) || host === 'evil.example') return cb(null, [{ address: '127.0.0.1', family: 4 }]);
  cb(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
}

var fetcher, sitemaps;
function at(path, host) { return 'http://' + (host || 'www.kone.es') + ':' + PORT + path; }

// ─── guard ─────────────────────────────────────────────────────────────────

test('1. every registry domain is a KONE base, plus kone.com', function () {
  Object.keys(sites.countries).forEach(function (k) {
    assert.ok(bases.indexOf(sites.countries[k].domain) !== -1, k);
  });
  assert.ok(bases.indexOf('kone.com') !== -1);
});

test('2. KONE hosts: www., preview. and the bare domain pass; look-alikes do not', function () {
  ['kone.es', 'www.kone.es', 'preview.kone.es', 'preview-training.kone.com', 'www.kone.co.uk', 'www.kone.com.tr']
    .forEach(function (h) { assert.ok(guard.isKoneHost(h, bases), h); });
  ['kone.es.evil.com', 'notkone.es', 'kone.esx', 'evil.com', 'kone.co', 'uk']
    .forEach(function (h) { assert.ok(!guard.isKoneHost(h, bases), h); });
});

test('3. URL shape: only http(s), ports 80/443, no credentials, no bare IPs', function () {
  assert.ok(guard.checkUrl('https://www.kone.es/contacto/', { koneOnly: true, bases: bases }).ok);
  assert.ok(guard.checkUrl('http://www.kone.es:80/', { koneOnly: true, bases: bases }).ok);
  [['ftp://www.kone.es/', /only http and https/], ['file:///etc/passwd', /only http and https/],
    ['javascript:alert(1)', /only http and https/], ['https://www.kone.es:8443/', /ports 80 and 443/],
    ['https://user:pw@www.kone.es/', /user name or password/], ['http://127.0.0.1/', /bare IP/],
    ['http://[::1]/', /bare IP/], ['http://169.254.169.254/latest/meta-data/', /bare IP/],
    ['not a url', /not a valid URL/], ['https://evil.com/', /not a KONE site/]
  ].forEach(function (c) {
    var r = guard.checkUrl(c[0], { koneOnly: true, bases: bases });
    assert.ok(!r.ok && c[1].test(r.reason), c[0] + ' → ' + r.reason);
  });
  assert.ok(guard.checkUrl('https://evil.com/', { koneOnly: false }).ok, 'link checks may reach any public host');
});

test('4. private, loopback, link-local, CGNAT and mapped addresses are all refused', function () {
  ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1']
    .forEach(function (ip) { assert.ok(guard.isPrivateAddress(ip), ip); });
  ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700::1111', '::ffff:8.8.8.8']
    .forEach(function (ip) { assert.ok(!guard.isPrivateAddress(ip), ip); });
});

test('5. a KONE host that resolves to 127.0.0.1 is refused by the shipping guard', function () {
  var real = fetcherLib.createFetcher({ bases: bases, resolve: localResolve, allowPorts: [PORT] });
  return real.fetchPage(at('/page')).then(function (r) {
    assert.strictEqual(r.verdict, 'refused');
    assert.ok(/private address \(127\.0\.0\.1\)/.test(r.reason), r.reason);
    assert.strictEqual(r.html, null);
  });
});

test('6. a host resolving to any private address among public ones is refused', function (done) {
  var lookup = guard.vettedLookup({ resolve: function (h, cb) { cb(null, [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }]); } });
  return new Promise(function (resolve, reject) {
    lookup('www.kone.es', {}, function (err) {
      try { assert.ok(err && err.code === 'EPRIVATE', 'expected EPRIVATE'); resolve(); } catch (e) { reject(e); }
    });
  });
});

// ─── fetcher ───────────────────────────────────────────────────────────────

test('7. fetchPage: a gzip page comes back decoded, with its facts', function () {
  return fetcher.fetchPage(at('/page')).then(function (r) {
    assert.strictEqual(r.verdict, 'ok');
    assert.strictEqual(r.status, 200);
    assert.ok(/KONE España/.test(r.html));
    assert.strictEqual(r.redirects.length, 0);
    assert.strictEqual(r.tls, null, 'plain http carries no certificate');
    assert.ok(r.bytes > 0 && typeof r.ms === 'number');
  });
});

test('8. fetchPage: a redirect chain is followed and recorded', function () {
  return fetcher.fetchPage(at('/redirect')).then(function (r) {
    assert.strictEqual(r.verdict, 'ok');
    assert.strictEqual(r.finalUrl, at('/page'));
    assert.deepStrictEqual(r.redirects.map(function (x) { return x.status; }), [301, 302]);
  });
});

test('9. fetchPage: a redirect off KONE stops there, with no body', function () {
  return fetcher.fetchPage(at('/off')).then(function (r) {
    assert.strictEqual(r.verdict, 'refused');
    assert.ok(/evil\.example/.test(r.reason) && /not a KONE site/.test(r.reason), r.reason);
    assert.strictEqual(r.html, null);
  });
});

test('10. fetchPage: a redirect to a login page is unverified, never a pass', function () {
  return fetcher.fetchPage(at('/login-redir')).then(function (r) {
    assert.strictEqual(r.verdict, 'unverified');
    assert.ok(/login page/.test(r.reason) && /bookmarklet/.test(r.reason), r.reason);
  });
});

test('11. fetchPage: a preview host behind login reads "behind login — use the bookmarklet"', function () {
  return fetcher.fetchPage(at('/x/', 'preview.kone.es')).then(function (r) {
    assert.strictEqual(r.verdict, 'unverified');
    assert.ok(/behind login/.test(r.reason) && /bookmarklet/.test(r.reason), r.reason);
  });
});

test('12. fetchPage: 404 and 503 are dead; 403 on a live host is unverified', function () {
  return Promise.all([at('/missing'), at('/boom'), at('/blocked')].map(fetcher.fetchPage)).then(function (rs) {
    assert.deepStrictEqual(rs.map(function (r) { return r.verdict; }), ['dead', 'dead', 'unverified']);
    assert.ok(/blocking automated checks/.test(rs[2].reason));
  });
});

test('13. fetchPage: too many redirects, an oversized page, a PDF', function () {
  return Promise.all([at('/loop'), at('/big'), at('/pdf')].map(fetcher.fetchPage)).then(function (rs) {
    assert.ok(rs[0].verdict === 'unverified' && /more than 5 redirects/.test(rs[0].reason), rs[0].reason);
    assert.ok(rs[1].verdict === 'unverified' && /larger than/.test(rs[1].reason), rs[1].reason);
    assert.ok(rs[2].verdict === 'unverified' && /not an HTML page/.test(rs[2].reason), rs[2].reason);
  });
});

test('14. fetchPage: a server that never answers times out as unverified', function () {
  return fetcher.fetchPage(at('/slow')).then(function (r) {
    assert.strictEqual(r.verdict, 'unverified');
    assert.ok(/timed out/.test(r.reason), r.reason);
  });
});

test('15. checkLink: HEAD answered 405 falls back to GET; status only', function () {
  return fetcher.checkLink(at('/head405')).then(function (r) {
    assert.strictEqual(r.verdict, 'ok');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.html, undefined, 'no body ever comes back from a link check');
  });
});

test('16. checkLink: external hosts are allowed, still through the private-address guard', function () {
  var real = fetcherLib.createFetcher({ bases: bases, resolve: localResolve, allowPorts: [PORT] });
  return Promise.all([fetcher.checkLink(at('/x', 'evil.example')), real.checkLink(at('/x', 'evil.example')),
    fetcher.checkLink(at('/missing'))]).then(function (rs) {
    assert.strictEqual(rs[0].verdict, 'ok', 'an external link gets a status');
    assert.strictEqual(rs[1].verdict, 'refused', 'but never on a private address');
    assert.strictEqual(rs[2].verdict, 'dead');
  });
});

test('17. tlsSummary: valid, expiring, expired and untrusted certificates', function () {
  var now = Date.parse('2026-10-01T00:00:00Z');
  var good = fetcherLib.tlsSummary({ valid_to: 'Dec 31 00:00:00 2026 GMT', issuer: { O: 'DigiCert Inc' } }, true, null, now);
  assert.deepStrictEqual([good.valid, good.daysLeft, good.issuer, good.error], [true, 91, 'DigiCert Inc', null]);
  var expired = fetcherLib.tlsSummary({ valid_to: 'Sep 1 00:00:00 2026 GMT', issuer: { CN: 'R3' } }, true, null, now);
  assert.deepStrictEqual([expired.valid, expired.error, expired.issuer], [false, 'CERT_HAS_EXPIRED', 'R3']);
  var untrusted = fetcherLib.tlsSummary({ valid_to: 'Dec 31 00:00:00 2026 GMT', issuer: {} }, false, 'DEPTH_ZERO_SELF_SIGNED_CERT', now);
  assert.deepStrictEqual([untrusted.valid, untrusted.error], [false, 'DEPTH_ZERO_SELF_SIGNED_CERT']);
});

// ─── sitemaps ──────────────────────────────────────────────────────────────

test('18. readRobots: only the * group counts; Sitemap lines are collected', function () {
  var r = sitemapLib.readRobots('User-agent: Googlebot\nDisallow: /\n\nUser-agent: *\nDisallow: /a/ # x\nAllow: /a/b/\nSitemap: https://x/s.xml');
  assert.deepStrictEqual(r.sitemaps, ['https://x/s.xml']);
  assert.deepStrictEqual(r.rules, [{ allow: false, path: '/a/' }, { allow: true, path: '/a/b/' }]);
  assert.ok(!sitemapLib.robotsAllows('/a/c', r.rules));
  assert.ok(sitemapLib.robotsAllows('/a/b/c', r.rules), 'longest match wins');
  assert.ok(sitemapLib.robotsAllows('/z', r.rules));
  assert.ok(!sitemapLib.robotsAllows('/x.pdf', [{ allow: false, path: '/*.pdf$' }]));
});

test('19. discover: robots → index → sitemaps (one gzipped), filtered and counted', function () {
  return sitemaps.discover({ domain: 'kone.es' }, {}).then(function (r) {
    assert.strictEqual(r.error, null, r.error);
    assert.strictEqual(r.sitemaps.length, 3, 'the index and both sitemaps were read');
    var paths = r.urls.map(function (u) { return new URL(u).pathname + new URL(u).search; });
    assert.deepStrictEqual(paths.sort(), ['/', '/a?x=1&y=2', '/contacto/', '/new-buildings/', '/new-buildings/escalators/', '/private/open/ok/']);
    assert.deepStrictEqual(r.excluded, { robots: 1, otherHost: 1, outsidePath: 0 });
    assert.strictEqual(r.available, 6);
  });
});

test('20. discover: per-site limit and path prefix', function () {
  return Promise.all([
    sitemaps.discover({ domain: 'kone.es' }, { perSiteLimit: 2 }),
    sitemaps.discover({ domain: 'kone.es' }, { pathPrefix: '/new-buildings/' })
  ]).then(function (rs) {
    assert.strictEqual(rs[0].urls.length, 2);
    assert.strictEqual(rs[0].available, 6, 'the cap never hides how many there were');
    assert.strictEqual(rs[1].urls.length, 2);
    assert.strictEqual(rs[1].excluded.outsidePath, 5, 'the prefix is applied before robots.txt');
  });
});

test('21. discover: a two-language domain keeps only its own language path', function () {
  return sitemaps.discover({ domain: 'kone.be', langPath: 'fr' }, { pathPrefix: 'new-buildings' }).then(function (r) {
    assert.deepStrictEqual(r.urls.map(function (u) { return new URL(u).pathname; }), ['/fr/new-buildings/y/']);
    assert.strictEqual(r.site, 'kone.be/fr');
  });
});

test('22. discover: a site with no readable sitemap says so', function () {
  return sitemaps.discover({ domain: 'kone.de' }, {}).then(function (r) {
    assert.ok(/no sitemap could be read/.test(r.error), r.error);
    assert.deepStrictEqual(r.urls, []);
  });
});

// ─── auth ──────────────────────────────────────────────────────────────────

test('23. tokens: issued, verified, tampered, expired', function () {
  var t = auth.issueToken('s3cret', 1000, 5000);
  assert.ok(auth.verifyToken(t.token, 's3cret', 2000).ok);
  assert.ok(!auth.verifyToken(t.token, 'other', 2000).ok, 'another secret');
  assert.ok(!auth.verifyToken(t.token.replace('v1.6000', 'v1.9999'), 's3cret', 2000).ok, 'a moved expiry');
  assert.ok(/expired/.test(auth.verifyToken(t.token, 's3cret', 7000).reason));
  assert.ok(!auth.verifyToken('garbage', 's3cret', 2000).ok);
  assert.ok(auth.passwordMatches('open sesame', 'open sesame'));
  assert.ok(!auth.passwordMatches('open sesam', 'open sesame'));
  assert.ok(!auth.passwordMatches('', ''), 'no password set never matches');
});

// ─── handlers ──────────────────────────────────────────────────────────────

var ENV = { WCM_PASSWORD: 'lift-and-shift', WCM_SESSION_SECRET: 'x'.repeat(40), ALLOWED_ORIGINS: 'https://wcm.example, https://wcm-helper-*-team.vercel.app' };
function app(env) {
  return handlers.createApp({ env: env || ENV, sites: sites, fetcher: fetcher, failDelayMs: 0,
    sitemapOptions: { originOf: function (h) { return 'http://' + h + ':' + PORT; } } });
}
function call(a, method, path, body, headers) {
  return a.handle({ method: method, path: path, headers: headers || {}, body: body ? JSON.stringify(body) : '', ip: '1.2.3.4' })
    .then(function (r) { r.json = r.body ? JSON.parse(r.body) : null; return r; });
}
function signIn(a) {
  return call(a, 'POST', '/api/login', { password: 'lift-and-shift' }).then(function (r) {
    return { authorization: 'Bearer ' + r.json.token };
  });
}

test('24. login: wrong password 401, right one a token; calls without it 401', function () {
  var a = app();
  return call(a, 'POST', '/api/login', { password: 'nope' }).then(function (r) {
    assert.strictEqual(r.status, 401);
    return call(a, 'POST', '/api/fetch', { url: at('/page') });
  }).then(function (r) {
    assert.strictEqual(r.status, 401, 'no token, no fetch');
    return call(a, 'POST', '/api/fetch', { url: at('/page') }, { Authorization: 'Bearer v1.99999999999999.forged' });
  }).then(function (r) {
    assert.strictEqual(r.status, 401, 'a forged token');
    return signIn(a);
  }).then(function (h) {
    return Promise.all([call(a, 'POST', '/api/fetch', { url: at('/page') }, h), call(a, 'GET', '/api/session', null, h)]);
  }).then(function (rs) {
    assert.strictEqual(rs[0].status, 200);
    assert.ok(/KONE España/.test(rs[0].json.html));
    assert.ok(rs[1].json.ok && rs[1].json.expiresAt);
  });
});

test('25. login: an unconfigured backend refuses everyone instead of running open', function () {
  var a = app({});
  return Promise.all([call(a, 'POST', '/api/login', { password: '' }), call(a, 'POST', '/api/fetch', { url: at('/page') }),
    call(a, 'GET', '/api/health')]).then(function (rs) {
    assert.deepStrictEqual(rs.map(function (r) { return r.status; }), [503, 503, 200]);
    assert.strictEqual(rs[2].json.configured, false);
  });
});

test('26. login: five wrong passwords lock that address out', function () {
  var a = app();
  var p = Promise.resolve();
  for (var i = 0; i < 5; i++) p = p.then(function () { return call(a, 'POST', '/api/login', { password: 'guess' }); });
  return p.then(function () { return call(a, 'POST', '/api/login', { password: 'lift-and-shift' }); })
    .then(function (r) { assert.strictEqual(r.status, 429); });
});

test('27. CORS: own origins and the preview pattern pass; others are refused', function () {
  var a = app();
  return Promise.all([
    call(a, 'OPTIONS', '/api/fetch', null, { Origin: 'https://wcm.example' }),
    call(a, 'GET', '/api/health', null, { Origin: 'https://wcm-helper-abc123-team.vercel.app' }),
    call(a, 'GET', '/api/health', null, { Origin: 'https://evil.vercel.app' }),
    call(a, 'GET', '/api/health', null, { Origin: 'http://localhost:3600' })
  ]).then(function (rs) {
    assert.strictEqual(rs[0].status, 204);
    assert.strictEqual(rs[0].headers['access-control-allow-origin'], 'https://wcm.example');
    assert.ok(/Authorization/.test(rs[0].headers['access-control-allow-headers']));
    assert.strictEqual(rs[1].status, 200);
    assert.strictEqual(rs[2].status, 403);
    assert.strictEqual(rs[3].status, 200, 'local development');
  });
});

test('28. routes: discover refuses a non-KONE site; link-status caps the batch; unknown routes 404', function () {
  var a = app();
  return signIn(a).then(function (h) {
    var many = []; for (var i = 0; i < 41; i++) many.push(at('/page?' + i));
    return Promise.all([
      call(a, 'POST', '/api/discover', { site: { domain: 'evil.com' } }, h),
      call(a, 'POST', '/api/discover', { site: { domain: 'kone.es' }, perSiteLimit: 3 }, h),
      call(a, 'POST', '/api/link-status', { urls: many }, h),
      call(a, 'POST', '/api/link-status', { urls: [at('/page'), at('/missing')] }, h),
      call(a, 'GET', '/api/nothing', null, h),
      a.handle({ method: 'POST', path: '/api/fetch', headers: h, body: '{not json', ip: 'x' })
    ]);
  }).then(function (rs) {
    assert.strictEqual(rs[0].status, 400);
    assert.strictEqual(rs[1].json.urls.length, 3);
    assert.strictEqual(rs[2].status, 400);
    assert.deepStrictEqual(rs[3].json.results.map(function (r) { return r.verdict; }), ['ok', 'dead']);
    assert.strictEqual(rs[4].status, 404);
    assert.strictEqual(rs[5].status, 400);
  });
});

test('29. a fetch refused by the guard is a 200 carrying verdict "refused", so the UI can say why', function () {
  var a = app();
  return signIn(a).then(function (h) { return call(a, 'POST', '/api/fetch', { url: 'https://www.google.com/' }, h); })
    .then(function (r) {
      assert.strictEqual(r.status, 200);
      assert.strictEqual(r.json.verdict, 'refused');
      assert.ok(/not a KONE site/.test(r.json.reason));
    });
});

server.listen(0, '127.0.0.1', function () {
  PORT = server.address().port;
  fetcher = fetcherLib.createFetcher({ bases: bases, resolve: localResolve, allowPrivate: true, allowPorts: [PORT],
    limits: { headersMs: 600, totalMs: 1200, maxHtmlBytes: 2000 } });
  sitemaps = sitemapLib.createSitemaps(fetcher, { originOf: function (h) { return 'http://' + h + ':' + PORT; } });
  runAll().then(function () {
    server.close();
    if (server.closeAllConnections) server.closeAllConnections();
    console.log('\n' + passed + ' passed, ' + failed + ' failed');
    process.exit(failed === 0 ? 0 : 1);
  });
});

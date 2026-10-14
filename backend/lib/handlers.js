// handlers.js — the backend's routes, as one pure function.
//
// handle({ method, path, headers, body, ip }) → { status, headers, body }
//
// No framework and no transport: api/index.js (Vercel) and server.js (plain
// Node) both translate their request into this shape and write the answer
// back. That keeps every rule — CORS, the password, the guard — in one
// place, and lets the tests drive it without a socket.

'use strict';

var auth = require('./auth');
var guard = require('./guard');
var fetcherLib = require('./fetcher');
var sitemapLib = require('./sitemap');

var VERSION = '1';
var MAX_BODY = 64 * 1024;
var LINK_BATCH = 40;
var LINK_CONCURRENCY = 10;

// ALLOWED_ORIGINS is a comma list. "*" inside an entry stands for one run of
// host-name characters, so a Vercel preview pattern such as
// https://wcm-helper-*-nit-repos-projects.vercel.app covers every preview
// build without opening the backend to every vercel.app site.
function originMatcher(list) {
  var res = String(list || '').split(',').map(function (s) { return s.trim().replace(/\/$/, ''); }).filter(Boolean)
    .map(function (o) {
      return new RegExp('^' + o.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]+') + '$', 'i');
    });
  return function (origin) { return res.some(function (re) { return re.test(origin); }); };
}

function mapLimit(items, limit, fn) {
  var out = new Array(items.length), i = 0;
  function worker() {
    if (i >= items.length) return Promise.resolve();
    var idx = i++;
    return Promise.resolve(fn(items[idx], idx)).then(function (v) { out[idx] = v; return worker(); });
  }
  var workers = [];
  for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(worker());
  return Promise.all(workers).then(function () { return out; });
}

function createApp(options) {
  options = options || {};
  var env = options.env || {};
  var now = options.now || Date.now;
  var failDelayMs = options.failDelayMs == null ? 1000 : options.failDelayMs;
  var bases = guard.koneBases(options.sites);
  var fetcher = options.fetcher || fetcherLib.createFetcher({ bases: bases });
  var sitemaps = sitemapLib.createSitemaps(fetcher, options.sitemapOptions);
  var throttle = auth.createThrottle({ now: now });
  var allowedOrigin = originMatcher(['http://localhost:3600', 'http://127.0.0.1:3600', env.ALLOWED_ORIGINS].filter(Boolean).join(','));
  var configured = !!(env.WCM_PASSWORD && env.WCM_SESSION_SECRET);

  function reply(status, body, extra) {
    return { status: status, headers: Object.assign({ 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store' }, extra || {}), body: JSON.stringify(body) };
  }
  function problem(status, detail) { return reply(status, { error: detail }); }

  function parseBody(req) {
    var raw = req.body == null ? '' : String(req.body);
    if (raw.length > MAX_BODY) return { error: problem(413, 'request too large') };
    if (!raw) return { value: {} };
    try { return { value: JSON.parse(raw) }; } catch (e) { return { error: problem(400, 'the request body is not JSON') }; }
  }

  function bearer(req) {
    var h = req.headers.authorization || '';
    var m = /^Bearer\s+(\S+)$/i.exec(h);
    return m ? m[1] : null;
  }

  var routes = {
    'GET health': function () {
      return reply(200, { ok: true, version: VERSION, configured: configured, sites: bases.length });
    },

    'POST login': function (req, body) {
      if (!configured) return problem(503, 'the backend has no password set (WCM_PASSWORD, WCM_SESSION_SECRET), so nobody can sign in');
      var key = req.ip || 'unknown';
      if (throttle.blocked(key)) return problem(429, 'too many wrong passwords — wait ten minutes and try again');
      if (!auth.passwordMatches(String(body.password || ''), env.WCM_PASSWORD)) {
        throttle.fail(key);
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(problem(401, 'wrong password')); }, failDelayMs);
        });
      }
      throttle.clear(key);
      return reply(200, auth.issueToken(env.WCM_SESSION_SECRET, now()));
    },

    'GET session': function (req, body, session) {
      return reply(200, { ok: true, expiresAt: session.expiresAt });
    },

    'POST fetch': function (req, body) {
      if (!body.url) return problem(400, 'give a url');
      return fetcher.fetchPage(String(body.url)).then(function (r) { return reply(200, r); });
    },

    'POST discover': function (req, body) {
      var site = body.site || {};
      if (!site.domain) return problem(400, 'give a site: { domain, langPath }');
      if (!guard.isKoneHost(site.domain, bases)) return problem(400, site.domain + ' is not a KONE site in config/sites.json');
      return sitemaps.discover(site, { perSiteLimit: body.perSiteLimit, pathPrefix: body.pathPrefix })
        .then(function (r) { return reply(200, r); });
    },

    'POST sitemap': function (req, body) {
      if (!body.url) return problem(400, 'give a sitemap url');
      return sitemaps.single(String(body.url), { perSiteLimit: body.perSiteLimit })
        .then(function (r) { return reply(200, r); });
    },

    'POST link-status': function (req, body) {
      var urls = Array.isArray(body.urls) ? body.urls.map(String) : null;
      if (!urls) return problem(400, 'give urls: [...]');
      if (urls.length > LINK_BATCH) return problem(400, 'at most ' + LINK_BATCH + ' links per request');
      return mapLimit(urls, LINK_CONCURRENCY, function (u) { return fetcher.checkLink(u); })
        .then(function (results) { return reply(200, { results: results }); });
    }
  };

  function handle(req) {
    var headers = {};
    Object.keys(req.headers || {}).forEach(function (k) { headers[k.toLowerCase()] = req.headers[k]; });
    req = Object.assign({}, req, { headers: headers });

    var origin = headers.origin;
    var cors = {};
    if (origin) {
      if (!allowedOrigin(origin)) return Promise.resolve(problem(403, 'calls from ' + origin + ' are not accepted'));
      cors = { 'access-control-allow-origin': origin, 'vary': 'Origin',
        'access-control-allow-headers': 'Authorization, Content-Type',
        'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-max-age': '600' };
    }
    function withCors(res) { res.headers = Object.assign({}, res.headers, cors); return res; }

    if (req.method === 'OPTIONS') return Promise.resolve(withCors({ status: 204, headers: {}, body: '' }));

    var name = String(req.path || '').split('?')[0].replace(/^\/+(api\/+)?/, '').replace(/\/+$/, '');
    var route = routes[req.method + ' ' + name];
    if (!route) return Promise.resolve(withCors(problem(404, 'no such endpoint: ' + req.method + ' /api/' + name)));

    var parsed = req.method === 'POST' ? parseBody(req) : { value: {} };
    if (parsed.error) return Promise.resolve(withCors(parsed.error));

    var session = null;
    if (name !== 'health' && name !== 'login') {
      if (!configured) return Promise.resolve(withCors(problem(503, 'the backend has no password set, so it refuses every call')));
      session = auth.verifyToken(bearer(req), env.WCM_SESSION_SECRET, now());
      if (!session.ok) return Promise.resolve(withCors(problem(401, session.reason)));
    }

    return Promise.resolve()
      .then(function () { return route(req, parsed.value, session); })
      .catch(function (e) { return problem(500, 'the backend failed: ' + (e && e.message || e)); })
      .then(withCors);
  }

  return { handle: handle };
}

module.exports = { createApp: createApp, originMatcher: originMatcher, mapLimit: mapLimit };

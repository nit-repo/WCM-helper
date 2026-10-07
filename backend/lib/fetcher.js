// fetcher.js — one request at a time, every hop through the guard.
//
// fetchPage   a KONE page, with its body, redirect chain and certificate
// fetchText   robots.txt or a sitemap from a KONE host (body only parsed here)
// checkLink   any public URL, status only — the body is never read
//
// Every result carries a verdict, kept apart on purpose:
//   ok          answered 2xx
//   dead        404, 410 or 5xx — the page is genuinely broken
//   unverified  no usable answer: blocked, timed out, rate-limited, or behind
//               a login. Never counted as broken, never as fine.
//   refused     the guard said no, and why
//
// Node core only. Certificates are read, not enforced: an expired or
// mismatched certificate on a KONE site is a finding to report, and the page
// behind it is still worth checking, so the request completes and the
// certificate's state travels with the result.

'use strict';

var http = require('http');
var https = require('https');
var zlib = require('zlib');
var guard = require('./guard');

var USER_AGENT = 'WCM-Helper-QA/1.0 (KONE web content QA; status and page checks)';

var DEFAULTS = {
  headersMs: 10000,
  totalMs: 15000,
  maxRedirects: 5,
  maxHtmlBytes: 4 * 1024 * 1024,   // Vercel's response limit is 4.5 MB
  maxXmlBytes: 15 * 1024 * 1024
};

var ERRORS = {
  ETIMEDOUT: 'timed out',
  ENOTFOUND: 'the host does not resolve',
  EAI_AGAIN: 'the host could not be resolved just now',
  ECONNREFUSED: 'the server refused the connection',
  ECONNRESET: 'the connection was reset',
  EHOSTUNREACH: 'the host is unreachable',
  EPROTO: 'the TLS handshake failed'
};

function isPreviewHost(host) { return /^preview(-[a-z]+)?\./i.test(String(host || '')); }

function looksLikeLogin(url) {
  return /(^|[\/.?=_-])(login|logon|signin|sign-in|sso|adfs|okta|saml|oauth2?|authorize)([\/.?=_-]|$)/i.test(url.hostname + url.pathname + url.search) ||
    /login\.microsoftonline\.com$/i.test(url.hostname);
}

// What a certificate says, in the terms a QA finding needs.
function tlsSummary(cert, authorized, authError, now) {
  if (!cert || !cert.valid_to) {
    return { valid: false, validTo: null, daysLeft: null, issuer: null, error: authError ? String(authError) : 'no certificate presented' };
  }
  var to = new Date(cert.valid_to);
  var days = isNaN(to) ? null : Math.floor((to.getTime() - (now || Date.now())) / 86400000);
  var issuer = cert.issuer ? (cert.issuer.O || cert.issuer.CN || null) : null;
  return {
    valid: !!authorized && days !== null && days >= 0,
    validTo: isNaN(to) ? null : to.toISOString(),
    daysLeft: days,
    issuer: issuer,
    error: authorized ? (days !== null && days < 0 ? 'CERT_HAS_EXPIRED' : null) : String(authError || 'not trusted')
  };
}

function verdictOf(status, url) {
  if (status >= 200 && status < 300) return { verdict: 'ok', reason: 'answered ' + status };
  if (status === 404 || status === 410 || status >= 500) return { verdict: 'dead', reason: 'answered ' + status };
  if (status === 401 || status === 403 || status === 407) {
    return isPreviewHost(url.hostname)
      ? { verdict: 'unverified', reason: 'behind login (' + status + ') — capture it with the bookmarklet instead' }
      : { verdict: 'unverified', reason: 'the server refused the request (' + status + ') — possibly blocking automated checks' };
  }
  if (status === 429) return { verdict: 'unverified', reason: 'rate-limited (429) — try again later' };
  if (status >= 300 && status < 400) return { verdict: 'unverified', reason: 'redirect (' + status + ') with no usable Location' };
  return { verdict: 'unverified', reason: 'answered ' + status };
}

function createFetcher(options) {
  options = options || {};
  var cfg = Object.assign({}, DEFAULTS, options.limits || {});
  var bases = options.bases || [];
  var allowPorts = options.allowPorts || [80, 443];
  var lookup = guard.vettedLookup({ resolve: options.resolve, allowPrivate: options.allowPrivate });
  var now = options.now || Date.now;

  // One hop. Resolves, never rejects: failures come back as { error }.
  function hop(url, o) {
    return new Promise(function (resolve) {
      var lib = url.protocol === 'https:' ? https : http;
      var done = false, req = null, timers = [];
      function finish(result) {
        if (done) return;
        done = true;
        timers.forEach(clearTimeout);
        resolve(result);
      }
      function fail(code, message) {
        if (req) req.destroy();
        finish({ error: { code: code, message: message } });
      }
      var headersTimer = setTimeout(function () { fail('ETIMEDOUT', 'no answer within ' + Math.round(cfg.headersMs / 1000) + ' s'); }, cfg.headersMs);
      timers.push(headersTimer);
      timers.push(setTimeout(function () { fail('ETIMEDOUT', 'not finished within ' + Math.round(o.totalMs / 1000) + ' s'); }, o.totalMs));

      req = lib.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: o.method,
        lookup: lookup,
        servername: url.hostname,
        rejectUnauthorized: false,
        agent: false,
        headers: {
          'user-agent': USER_AGENT,
          'accept': o.accept,
          'accept-encoding': 'gzip, deflate, br',
          'accept-language': '*'
        }
      }, function (res) {
        clearTimeout(headersTimer);
        var tls = null;
        if (url.protocol === 'https:' && res.socket && res.socket.getPeerCertificate) {
          tls = tlsSummary(res.socket.getPeerCertificate(), res.socket.authorized, res.socket.authorizationError, now());
        }
        var base = { status: res.statusCode, headers: res.headers, tls: tls, body: null, truncated: false };
        var ct = String(res.headers['content-type'] || '').toLowerCase();
        if (!o.wantBody || !o.wantsType(ct) || (res.statusCode >= 300 && res.statusCode < 400)) {
          finish(base);
          return res.destroy();
        }
        var stream = res;
        var enc = String(res.headers['content-encoding'] || '').toLowerCase().trim();
        if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        var chunks = [], size = 0;
        stream.on('data', function (c) {
          size += c.length;
          if (size > o.maxBytes) {
            base.truncated = true;
            finish(base);
            return res.destroy();
          }
          chunks.push(c);
        });
        stream.on('end', function () { base.body = Buffer.concat(chunks); finish(base); });
        stream.on('error', function (e) { fail(e.code || 'EDECODE', 'the response could not be decoded'); });
        res.on('aborted', function () { fail('ECONNRESET', 'the connection closed mid-response'); });
      });
      req.on('error', function (e) { fail(e.code || 'EREQUEST', e.message); });
      req.end();
    });
  }

  function errorResult(err) {
    if (err.code === 'EPRIVATE') return { verdict: 'refused', reason: err.message };
    return { verdict: 'unverified', reason: ERRORS[err.code] ? ERRORS[err.code] + (err.code === 'ETIMEDOUT' ? ' — ' + err.message : '') : err.message };
  }

  // Follow redirects by hand, re-checking every hop.
  function walk(raw, o) {
    var started = now();
    var checked = guard.checkUrl(raw, { koneOnly: o.koneOnly, bases: bases, allowPorts: allowPorts });
    var out = { url: String(raw || ''), finalUrl: null, status: null, verdict: null, reason: null,
      redirects: [], contentType: null, bytes: 0, ms: 0, tls: null, body: null, truncated: false };
    if (!checked.ok) return Promise.resolve(Object.assign(out, { verdict: 'refused', reason: checked.reason }));
    var current = checked.url;

    function step(n) {
      return hop(current, o).then(function (r) {
        out.finalUrl = current.href;
        out.ms = now() - started;
        if (r.error) return Object.assign(out, errorResult(r.error));
        out.status = r.status;
        if (r.tls) out.tls = r.tls;
        var loc = r.headers.location;
        if (r.status >= 300 && r.status < 400 && loc) {
          var next;
          try { next = new URL(loc, current); } catch (e) {
            return Object.assign(out, { verdict: 'unverified', reason: 'redirects to an unreadable Location: ' + loc });
          }
          out.redirects.push({ url: current.href, status: r.status, to: next.href });
          if (n >= cfg.maxRedirects) {
            return Object.assign(out, { verdict: 'unverified', reason: 'more than ' + cfg.maxRedirects + ' redirects' });
          }
          var again = guard.checkUrl(next.href, { koneOnly: o.koneOnly, bases: bases, allowPorts: allowPorts });
          if (!again.ok) {
            out.finalUrl = next.href;
            return Object.assign(out, { verdict: 'refused', reason: 'redirects to ' + next.href + ' — ' + again.reason });
          }
          if (looksLikeLogin(next)) {
            out.finalUrl = next.href;
            return Object.assign(out, { verdict: 'unverified', reason: 'redirects to a login page — capture it with the bookmarklet instead' });
          }
          current = again.url;
          return step(n + 1);
        }
        Object.assign(out, verdictOf(r.status, current));
        out.contentType = r.headers['content-type'] || null;
        out.truncated = r.truncated;
        if (r.body) { out.body = r.body; out.bytes = r.body.length; }
        return out;
      });
    }
    return step(0);
  }

  function fetchPage(raw) {
    return walk(raw, {
      koneOnly: true, method: 'GET', wantBody: true, totalMs: cfg.totalMs, maxBytes: cfg.maxHtmlBytes,
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      wantsType: function (ct) { return /html|xhtml/.test(ct); }
    }).then(function (r) {
      var html = null;
      if (r.verdict === 'ok') {
        if (r.truncated) {
          r.verdict = 'unverified';
          r.reason = 'the page is larger than ' + Math.round(cfg.maxHtmlBytes / 1048576) + ' MB, so it was not read';
        } else if (!r.body) {
          r.verdict = 'unverified';
          r.reason = 'not an HTML page (' + (r.contentType || 'no content type') + ')';
        } else {
          html = r.body.toString('utf8');
        }
      }
      delete r.body; delete r.truncated;
      r.html = html;
      return r;
    });
  }

  // robots.txt and sitemaps. A .xml.gz sitemap is often served as a gzip
  // file rather than gzip-encoded, so the body is unpacked by its magic bytes.
  function fetchText(raw) {
    return walk(raw, {
      koneOnly: true, method: 'GET', wantBody: true, totalMs: cfg.totalMs, maxBytes: cfg.maxXmlBytes,
      accept: 'application/xml,text/xml,text/plain;q=0.9,*/*;q=0.5',
      wantsType: function (ct) { return !/html|image|video|audio|font/.test(ct); }
    }).then(function (r) {
      var text = null;
      if (r.verdict === 'ok' && r.body && !r.truncated) {
        var buf = r.body;
        if (buf[0] === 0x1f && buf[1] === 0x8b) {
          try { buf = zlib.gunzipSync(buf, { maxOutputLength: cfg.maxXmlBytes }); } catch (e) { buf = null; }
        }
        text = buf ? buf.toString('utf8') : null;
      }
      if (r.verdict === 'ok' && text === null) {
        r.verdict = 'unverified';
        r.reason = r.truncated ? 'larger than ' + Math.round(cfg.maxXmlBytes / 1048576) + ' MB' : 'no readable text body';
      }
      delete r.body; delete r.truncated;
      r.text = text;
      return r;
    });
  }

  // Status only. HEAD first; servers that do not answer HEAD properly get a
  // GET whose body is never read.
  function checkLink(raw) {
    var base = { koneOnly: false, wantBody: false, totalMs: Math.min(cfg.totalMs, 8000), maxBytes: 0,
      accept: '*/*', wantsType: function () { return false; } };
    return walk(raw, Object.assign({ method: 'HEAD' }, base)).then(function (r) {
      if ([400, 403, 405, 501].indexOf(r.status) === -1 && !(r.verdict === 'unverified' && r.status === null && /reset|closed/.test(r.reason || ''))) return r;
      return walk(raw, Object.assign({ method: 'GET' }, base));
    }).then(function (r) {
      return { url: r.url, finalUrl: r.finalUrl, status: r.status, verdict: r.verdict, reason: r.reason,
        redirects: r.redirects.length, tlsError: r.tls && !r.tls.valid ? r.tls.error : null };
    });
  }

  return { fetchPage: fetchPage, fetchText: fetchText, checkLink: checkLink, bases: bases };
}

module.exports = {
  createFetcher: createFetcher,
  tlsSummary: tlsSummary,
  verdictOf: verdictOf,
  looksLikeLogin: looksLikeLogin,
  isPreviewHost: isPreviewHost,
  USER_AGENT: USER_AGENT
};

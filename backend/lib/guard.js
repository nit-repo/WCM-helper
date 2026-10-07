// guard.js — what the backend is allowed to fetch.
//
// Two rules, checked on every hop of every request:
//
//   1. Page bodies come only from KONE. A host is KONE when it is one of the
//      domains in config/sites.json (or kone.com), or a subdomain of one —
//      www., preview., preview-training. A look-alike (kone.es.evil.com,
//      notkone.es) is not.
//   2. Nothing private, ever. A host name is resolved first, and refused if
//      any of its addresses is loopback, private, link-local, CGNAT,
//      multicast or unspecified. The socket then connects to the address
//      that was checked, not to a second lookup, so a DNS answer that
//      changes between the check and the connect cannot slip past it.
//
// Only http and https, only ports 80 and 443, no credentials in the URL, no
// bare IP addresses. Every refusal carries the reason, in words.

'use strict';

var dns = require('dns');
var net = require('net');


// The base domains page bodies may come from: every market's domain, and the
// global site. Read from the same registry the browser uses, so adding a
// market to config/sites.json is what makes it crawlable.
function koneBases(sites) {
  var bases = { 'kone.com': true };
  var countries = (sites && sites.countries) || {};
  Object.keys(countries).forEach(function (k) {
    var d = String(countries[k].domain || '').toLowerCase().trim();
    if (d) bases[d] = true;
  });
  return Object.keys(bases).sort();
}

function isKoneHost(host, bases) {
  host = String(host || '').toLowerCase().replace(/\.$/, '');
  return bases.some(function (b) { return host === b || host.slice(-(b.length + 1)) === '.' + b; });
}

// Parse and vet a URL's shape. Returns { ok, url, reason }.
function checkUrl(raw, options) {
  options = options || {};
  var ports = (options.allowPorts || [80, 443]).map(String).concat(['']);
  var url;
  try { url = new URL(String(raw || '').trim()); } catch (e) {
    return { ok: false, reason: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'only http and https URLs are fetched, not ' + url.protocol.replace(':', '') };
  }
  if (url.username || url.password) return { ok: false, reason: 'URLs carrying a user name or password are refused' };
  if (ports.indexOf(url.port) === -1) return { ok: false, reason: 'only ports 80 and 443 are fetched, not ' + url.port };
  var host = url.hostname.replace(/^\[|\]$/g, '');
  if (!host) return { ok: false, reason: 'the URL has no host' };
  if (net.isIP(host)) return { ok: false, reason: 'a bare IP address is refused — use the site\'s host name' };
  if (options.koneOnly && !isKoneHost(host, options.bases || [])) {
    return { ok: false, reason: host + ' is not a KONE site in config/sites.json, so its page is not fetched' };
  }
  return { ok: true, url: url };
}

// ─── ADDRESSES ─────────────────────────────────────────────────────────────

function v4Parts(ip) {
  var p = ip.split('.').map(Number);
  return p.length === 4 && p.every(function (n) { return n >= 0 && n <= 255; }) ? p : null;
}

function privateV4(ip) {
  var p = v4Parts(ip);
  if (!p) return true; // unreadable: refuse rather than guess
  var a = p[0], b = p[1];
  return a === 0 ||                                  // "this network"
    a === 10 ||                                      // private
    a === 127 ||                                     // loopback
    (a === 100 && b >= 64 && b <= 127) ||            // CGNAT
    (a === 169 && b === 254) ||                      // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||             // private
    (a === 192 && b === 0 && p[2] === 0) ||          // IETF protocol assignments
    (a === 192 && b === 168) ||                      // private
    (a === 198 && (b === 18 || b === 19)) ||         // benchmarking
    a >= 224;                                        // multicast, reserved, broadcast
}

// Expand an IPv6 address to eight 16-bit groups.
function v6Groups(ip) {
  ip = ip.toLowerCase().split('%')[0];
  var tail = null;
  var m = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
  if (m) {
    var p = v4Parts(m[2]);
    if (!p) return null;
    tail = [(p[0] << 8) | p[1], (p[2] << 8) | p[3]];
    ip = m[1].replace(/:$/, '') || ':';
    if (ip === ':') ip = '::';
  }
  var halves = ip.split('::');
  if (halves.length > 2) return null;
  function groups(s) { return s ? s.split(':').map(function (g) { return parseInt(g, 16); }) : []; }
  var left = groups(halves[0]), right = halves.length === 2 ? groups(halves[1]) : [];
  if (tail) right = right.concat(tail);
  var fill = 8 - left.length - right.length;
  if (halves.length === 1 && fill !== 0) return null;
  if (fill < 0) return null;
  var out = left.concat(new Array(fill).fill(0), right);
  return out.length === 8 && out.every(function (g) { return g >= 0 && g <= 0xffff; }) ? out : null;
}

function privateV6(ip) {
  var g = v6Groups(ip);
  if (!g) return true;
  var allZero = g.slice(0, 7).every(function (x) { return x === 0; });
  if (allZero && (g[7] === 0 || g[7] === 1)) return true;           // :: and ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d): judge the v4 inside.
  if (g.slice(0, 5).every(function (x) { return x === 0; }) && (g[5] === 0xffff || g[5] === 0)) {
    return privateV4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.'));
  }
  if (g[0] === 0x64 && g[1] === 0xff9b) {                            // NAT64
    return privateV4([g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join('.'));
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true;                      // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;                      // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true;                      // fec0::/10 site-local
  if ((g[0] & 0xff00) === 0xff00) return true;                      // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true;              // documentation
  return false;
}

function isPrivateAddress(ip) {
  var kind = net.isIP(ip);
  if (kind === 4) return privateV4(ip);
  if (kind === 6) return privateV6(ip);
  return true;
}

// A lookup function for http.request: resolves, refuses private addresses,
// and hands back only the vetted ones, so the connection goes where the
// check looked. `resolve` is injectable for tests; `allowPrivate` exists only
// so the tests can point a KONE host name at a local server.
function vettedLookup(options) {
  options = options || {};
  var resolve = options.resolve || function (host, cb) { dns.lookup(host, { all: true, verbatim: true }, cb); };
  return function (hostname, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    resolve(hostname, function (err, addrs) {
      if (err) return cb(err);
      addrs = (addrs || []).map(function (a) { return typeof a === 'string' ? { address: a, family: net.isIP(a) } : a; });
      if (!addrs.length) return cb(Object.assign(new Error(hostname + ' does not resolve'), { code: 'ENOTFOUND' }));
      if (!options.allowPrivate) {
        var bad = addrs.filter(function (a) { return isPrivateAddress(a.address); })[0];
        if (bad) {
          return cb(Object.assign(new Error(hostname + ' resolves to a private address (' + bad.address + '), which is never fetched'),
            { code: 'EPRIVATE' }));
        }
      }
      if (opts && opts.all) return cb(null, addrs);
      cb(null, addrs[0].address, addrs[0].family);
    });
  };
}

module.exports = {
  koneBases: koneBases,
  isKoneHost: isKoneHost,
  checkUrl: checkUrl,
  isPrivateAddress: isPrivateAddress,
  vettedLookup: vettedLookup
};

// sitemap.js — which URLs a site says it has.
//
// A site's sitemaps are named in its robots.txt (Sitemap: lines); failing
// that, /sitemap.xml is tried. A sitemap index is followed down to its
// sitemaps, at most two levels and fifty files. What comes back is filtered
// to the site itself — the same host, the market's language path when the
// domain carries two languages (kone.be/fr/ vs kone.be/nl/), and an optional
// path prefix — and to what robots.txt allows a crawler to read. URLs left
// out are counted, never silently dropped.
//
// Parsing is regex over <loc>, the same "read markup as data, never run it"
// stance as the rest of the tool.

'use strict';

var MAX_FILES = 50;
var MAX_URLS = 20000;
var TIME_BUDGET_MS = 40000;

function decodeXml(s) {
  return String(s).replace(/&(amp|lt|gt|quot|apos|#(\d+)|#x([0-9a-f]+));/gi, function (m, name, dec, hex) {
    if (dec) return String.fromCharCode(parseInt(dec, 10));
    if (hex) return String.fromCharCode(parseInt(hex, 16));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
  });
}

function stripCdata(s) { return String(s).replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim(); }

// <loc> values, split by whether they sit in a <sitemap> (an index entry) or
// a <url> (a page).
function readSitemapXml(xml) {
  xml = String(xml || '');
  var isIndex = /<sitemapindex[\s>]/i.test(xml);
  var re = isIndex ? /<sitemap\b[^>]*>[\s\S]*?<loc\b[^>]*>([\s\S]*?)<\/loc>/gi : /<url\b[^>]*>[\s\S]*?<loc\b[^>]*>([\s\S]*?)<\/loc>/gi;
  var locs = [], m;
  while ((m = re.exec(xml)) !== null) {
    var v = decodeXml(stripCdata(m[1]));
    if (v) locs.push(v);
  }
  return { isIndex: isIndex, locs: locs, isSitemap: isIndex || /<urlset[\s>]/i.test(xml) };
}

// The rules robots.txt sets for every crawler (User-agent: *), and the
// sitemaps it names. A group naming several agents counts when * is one.
function readRobots(text) {
  var lines = String(text || '').split(/\r?\n/);
  var sitemaps = [], rules = [], agents = [], inGroup = false, sawRule = false;
  lines.forEach(function (raw) {
    var line = raw.replace(/#.*$/, '').trim();
    var m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) return;
    var key = m[1].toLowerCase(), value = m[2].trim();
    if (key === 'sitemap') { if (value) sitemaps.push(value); return; }
    if (key === 'user-agent') {
      if (sawRule) { agents = []; sawRule = false; }
      agents.push(value.toLowerCase());
      inGroup = agents.indexOf('*') !== -1;
      return;
    }
    if (key === 'allow' || key === 'disallow') {
      sawRule = true;
      if (inGroup && (value || key === 'allow')) rules.push({ allow: key === 'allow', path: value });
    }
  });
  return { sitemaps: sitemaps, rules: rules };
}

function ruleRegex(path) {
  var anchored = /\$$/.test(path);
  var body = (anchored ? path.slice(0, -1) : path).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

// The longest matching rule wins; on a tie, Allow does (as Google reads it).
function robotsAllows(path, rules) {
  var best = null;
  (rules || []).forEach(function (r) {
    if (!r.path) return;
    if (!ruleRegex(r.path).test(path)) return;
    if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
  });
  return !best || best.allow;
}

function bareHost(h) { return String(h || '').toLowerCase().replace(/^www\./, ''); }

function underPath(pathname, prefix) {
  if (!prefix) return true;
  var p = '/' + String(prefix).replace(/^\/+|\/+$/g, '').toLowerCase();
  if (p === '/') return true;
  var path = pathname.toLowerCase();
  return path === p || path.indexOf(p + '/') === 0 || path.indexOf(p + '.') === 0;
}

// A path prefix may be typed with or without the language segment:
// /new-buildings/ and /fr/new-buildings/ both mean the same on kone.be/fr.
function withinPrefix(pathname, langPath, prefix) {
  if (underPath(pathname, prefix)) return true;
  if (!langPath) return false;
  var rest = pathname.slice(langPath.length + 1) || '/';
  return underPath(rest, prefix);
}

function createSitemaps(fetcher, options) {
  options = options || {};
  var budget = options.timeBudgetMs || TIME_BUDGET_MS;
  var now = options.now || Date.now;
  // Where a host's robots.txt and sitemap live. Always https on a real site;
  // injectable so the tests can point it at a local server.
  var originOf = options.originOf || function (host) { return 'https://' + host; };

  // Walk sitemap URLs (and indexes) breadth-first, a few at a time.
  function walk(start, keepUrl) {
    var started = now();
    var queue = start.map(function (u) { return { url: u, depth: 0 }; });
    var seenFiles = {}, read = [], failed = [], urls = [], seenUrls = {}, partial = false;
    function next() {
      if (!queue.length) return Promise.resolve();
      if (read.length + failed.length >= MAX_FILES || urls.length >= MAX_URLS || now() - started > budget) {
        partial = true;
        return Promise.resolve();
      }
      var batch = queue.splice(0, 4).filter(function (q) { return !seenFiles[q.url] && (seenFiles[q.url] = true); });
      return Promise.all(batch.map(function (q) {
        return fetcher.fetchText(q.url).then(function (r) {
          if (r.verdict !== 'ok') { failed.push({ url: q.url, reason: r.reason }); return; }
          var sm = readSitemapXml(r.text);
          if (!sm.isSitemap) { failed.push({ url: q.url, reason: 'not a sitemap' }); return; }
          read.push(q.url);
          if (sm.isIndex) {
            if (q.depth >= 2) return;
            sm.locs.forEach(function (u) { queue.push({ url: u, depth: q.depth + 1 }); });
            return;
          }
          sm.locs.forEach(function (u) {
            if (seenUrls[u] || urls.length >= MAX_URLS) return;
            seenUrls[u] = true;
            urls.push(u);
          });
        });
      })).then(next);
    }
    return next().then(function () {
      return { read: read, failed: failed, urls: urls, partial: partial || queue.length > 0 };
    });
  }

  // One site from the registry: { domain, langPath } plus the run's options.
  function discover(site, opts) {
    opts = opts || {};
    var domain = bareHost(site && site.domain);
    var langPath = site && site.langPath ? String(site.langPath) : '';
    var limit = Math.max(0, parseInt(opts.perSiteLimit, 10) || 0);
    var hosts = ['www.' + domain, domain];
    var result = { site: domain + (langPath ? '/' + langPath : ''), domain: domain, langPath: langPath || null,
      host: null, sitemaps: [], available: 0, urls: [], excluded: { robots: 0, otherHost: 0, outsidePath: 0 },
      partial: false, error: null };
    if (!domain) { result.error = 'no domain given'; return Promise.resolve(result); }

    // robots.txt on www. first, the bare domain second.
    function robotsFrom(i) {
      if (i >= hosts.length) return Promise.resolve(null);
      return fetcher.fetchText(originOf(hosts[i]) + '/robots.txt').then(function (r) {
        if (r.verdict === 'refused') return { refused: r.reason };
        if (r.verdict === 'ok') return { host: new URL(r.finalUrl).hostname, robots: readRobots(r.text) };
        return robotsFrom(i + 1);
      });
    }

    return robotsFrom(0).then(function (found) {
      if (found && found.refused) { result.error = found.refused; return result; }
      var robots = found ? found.robots : { sitemaps: [], rules: [] };
      result.host = found ? found.host : 'www.' + domain;
      var start = robots.sitemaps.length ? robots.sitemaps
        : found ? [originOf(result.host) + '/sitemap.xml']
        : hosts.map(function (h) { return originOf(h) + '/sitemap.xml'; });
      return walk(start).then(function (w) {
        result.sitemaps = w.read;
        result.partial = w.partial;
        if (!w.read.length) {
          result.error = 'no sitemap could be read' + (w.failed.length ? ' — ' + w.failed[0].url + ': ' + w.failed[0].reason : '');
          return result;
        }
        var kept = [];
        w.urls.forEach(function (u) {
          var url;
          try { url = new URL(u); } catch (e) { result.excluded.otherHost++; return; }
          if (bareHost(url.hostname) !== domain) { result.excluded.otherHost++; return; }
          if (!underPath(url.pathname, langPath) || !withinPrefix(url.pathname, langPath, opts.pathPrefix)) {
            result.excluded.outsidePath++;
            return;
          }
          if (!robotsAllows(url.pathname + url.search, robots.rules)) { result.excluded.robots++; return; }
          kept.push(url.href);
        });
        result.available = kept.length;
        result.urls = limit ? kept.slice(0, limit) : kept;
        return result;
      });
    });
  }

  // One sitemap URL, as given. Still KONE-only — fetchText enforces that.
  function single(url, opts) {
    opts = opts || {};
    var limit = Math.max(0, parseInt(opts.perSiteLimit, 10) || 0);
    return walk([String(url || '').trim()]).then(function (w) {
      if (!w.read.length) {
        return { sitemap: url, urls: [], available: 0, partial: false,
          error: 'the sitemap could not be read' + (w.failed.length ? ' — ' + w.failed[0].reason : '') };
      }
      return { sitemap: url, sitemaps: w.read, available: w.urls.length,
        urls: limit ? w.urls.slice(0, limit) : w.urls, partial: w.partial, error: null };
    });
  }

  return { discover: discover, single: single };
}

module.exports = {
  createSitemaps: createSitemaps,
  readSitemapXml: readSitemapXml,
  readRobots: readRobots,
  robotsAllows: robotsAllows,
  underPath: underPath
};

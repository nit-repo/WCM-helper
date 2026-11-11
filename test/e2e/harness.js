// test/e2e/harness.js — everything the browser tests need, on localhost.
//
//   :3600  the tool itself (serve.js — same response headers as the deployed site)
//   :3700  the real backend (backend/lib/handlers.js), password "open-the-doors"
//   :3710  a stand-in for the KONE sites the backend fetches
//
// The backend is the shipped code with one test-only change: its fetcher may
// reach 127.0.0.1 on the fake site's port, and resolves every KONE host
// there. Nothing here is reachable from, or reaches, the internet.
//
// The fake sites serve the repo's real page fixtures where one exists
// (kone.ae, kone.bh, kone.com/en-us) and small made-up pages otherwise.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const handlers = require(path.join(REPO, 'backend/lib/handlers'));
const fetcherLib = require(path.join(REPO, 'backend/lib/fetcher'));
const guard = require(path.join(REPO, 'backend/lib/guard'));
const staticSite = require(path.join(REPO, 'serve.js'));
const sites = require(path.join(REPO, 'config/sites.json'));

const PORTS = { tool: 3600, backend: 3700, fake: 3710 };
const PASSWORD = 'open-the-doors';

const fixture = name => fs.readFileSync(path.join(REPO, 'test/fixtures', name), 'utf8');
const base = host => 'http://' + host + ':' + PORTS.fake;

function page(title, body, extra, lang) {
  return '<!DOCTYPE html><html lang="' + (lang || 'es') + '"><head><title>' + title + '</title>' + (extra || '') +
    '</head><body><main>' + body + '</main></body></html>';
}
const DD = '<script>var digitalData = { page : { pageInfo : {"FormAssemblyId": "758", "pageID": "1", "indexOptions": "INDEX", "followLinksOptions": "FOLLOW"} } };</script>';
const canonical = url => '<link rel="canonical" href="' + url + '">';

// Made-up Spanish pages: a clean one, links that work and do not, a page with
// several defects, and a title carrying another market's site name.
const ES = {
  '/': page('Inicio | KONE España', '<h1>Ascensores</h1><a href="/contacto/">Contacto</a> <a href="/roto/">Roto</a>', canonical('https://www.kone.es/') + DD),
  '/contacto/': page('Contacto | KONE España', '<h1>Contacto</h1><a href="http://external.example:' + PORTS.fake + '/ok">Fuera</a> ' +
    '<a href="http://external.example:' + PORTS.fake + '/gone">Fuera roto</a> <a href="/roto/">Roto</a>', canonical('https://www.kone.es/contacto/') + DD),
  '/titulo/': page('Titulo', '<h1>Uno</h1><h1>Dos</h1><a href="/">click here</a>',
    canonical('https://www.kone.es/titulo/') + '<script>var digitalData = { page : { pageInfo : {"FormAssemblyId": "924"} } };</script>'),
  '/india/': page('Pagina | KONE India', '<h1>India</h1>', canonical('https://www.kone.es/india/') + DD)
};

function sitemapXml(host, paths) {
  return '<?xml version="1.0" encoding="UTF-8"?><urlset>' + paths.map(p => '<url><loc>' + base(host) + p + '</loc></url>').join('') + '</urlset>';
}

function fakeSites(req, res) {
  const host = String(req.headers.host).split(':')[0];
  const url = req.url;
  const send = (status, type, body, headers) => {
    res.writeHead(status, Object.assign({ 'content-type': type }, headers || {}));
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const html = body => send(200, 'text/html; charset=utf-8', body);
  const robots = h => send(200, 'text/plain', 'Sitemap: ' + base(h) + '/sitemap.xml');

  if (host === 'external.example') return url === '/ok' ? html('ok') : send(404, 'text/html', 'no');
  if (host === 'preview.kone.es') return send(401, 'text/html', 'login');

  if (host === 'www.kone.es') {
    if (url === '/robots.txt') return send(200, 'text/plain', 'User-agent: *\nDisallow: /privado/\nSitemap: ' + base(host) + '/sitemap.xml');
    if (url === '/sitemap.xml') return send(200, 'application/xml', sitemapXml(host, ['/', '/contacto/', '/titulo/', '/india/', '/roto/', '/redir/', '/privado/x/']));
    if (url === '/redir/') return send(301, 'text/html', '', { location: '/contacto/' });
    // /cadena/4/ → 3 → 2 → 1 → /contacto/: four redirects, one more than allowed.
    const hop = /^\/cadena\/(\d)\/$/.exec(url);
    if (hop) return send(+hop[1] % 2 ? 302 : 301, 'text/html', '', { location: +hop[1] > 1 ? '/cadena/' + (hop[1] - 1) + '/' : '/contacto/' });
    if (url === '/bucle/') return send(302, 'text/html', '', { location: '/bucle2/' });
    if (url === '/bucle2/') return send(302, 'text/html', '', { location: '/bucle/' });
    if (url === '/lento/') return void setTimeout(() => html(ES['/contacto/']), 900);
    if (ES[url]) return html(ES[url]);
    return send(404, 'text/html', 'no');
  }

  // The real Bahrain builders page and the real kone.bh sitemap.
  if (host === 'www.kone.bh') {
    if (url === '/robots.txt') return robots(host);
    if (url === '/sitemap.xml') {
      const urls = fixture('kone-bh-sitemap.txt').split('\n').filter(l => /^https/.test(l));
      return send(200, 'application/xml', '<urlset>' + urls.map(u => '<url><loc>' + u.replace('https://www.kone.bh', base(host)) + '</loc></url>').join('') + '</urlset>');
    }
    if (url === '/en/new-buildings/elevators/builders/') return html(fixture('kone-bh-builders.html'));
    return html(page('Page - KONE Bahrain', '<h1>Page</h1><p>Text.</p>', canonical('https://www.kone.bh' + url), 'en'));
  }

  // The real UAE page carrying a FormAssembly form (1491).
  if (host === 'www.kone.ae') {
    if (url === '/modernization/elevator-modernization.html') return html(fixture('kone-ae-elevator-modernization.html'));
    return send(404, 'text/html', 'no');
  }

  // kone.com as it is: the root robots.txt and sitemap are the corporate
  // site's; KONE US and KONE India keep their own under their paths. The US
  // contact page is the real one.
  if (host === 'www.kone.com') {
    if (url === '/robots.txt') return robots(host);
    if (url === '/sitemap.xml') return send(200, 'application/xml', sitemapXml(host, ['/global/en.html', '/global/en/about.html']));
    if (url === '/en-us/sitemap.xml') return send(200, 'application/xml', sitemapXml(host, ['/en-us.html', '/en-us/contact.html']));
    if (url === '/en-in/sitemap.xml') return send(200, 'application/xml', sitemapXml(host, ['/en-in.html', '/en-in/contact.html']));
    if (url === '/en-us/contact.html') return html(fixture('kone-com-en-us-contact.html'));
    if (url === '/en-us.html') return html(page('KONE | We shape the future of cities', '<h1>KONE US</h1><a href="/en-us/contact.html">Contact us</a>', canonical('https://www.kone.com/en-us.html'), 'en'));
    if (url === '/en-in.html' || url === '/en-in/contact.html') return html(page('Contact - KONE India', '<h1>KONE India</h1>', canonical('https://www.kone.com' + url), 'en'));
    return send(404, 'text/html', 'no');
  }

  if (host === 'www.kone.it' || host === 'www.kone.pt') {
    if (url === '/robots.txt') return robots(host);
    if (url === '/sitemap.xml') return send(200, 'application/xml', sitemapXml(host, ['/a/']));
    return html(page('Page | KONE', '<h1>Page</h1>', canonical('https://' + host + url)));
  }

  if (host === 'www.kone.be') {
    if (url === '/robots.txt') return robots(host);
    if (url === '/sitemap.xml') return send(200, 'application/xml', sitemapXml(host, ['/fr/a/', '/nl/b/']));
    return html(page('Page | KONE Belgique', '<h1>BE</h1>', canonical('https://www.kone.be' + url), 'fr'));
  }

  send(404, 'text/plain', 'unknown host');
}

// Every KONE host the tests use, and the one external host, live on 127.0.0.1.
function resolve(host, cb) {
  if (/(^|\.)kone\.(es|be|de|bh|ae|com|it|pt)$/.test(host) || host === 'external.example') return cb(null, [{ address: '127.0.0.1', family: 4 }]);
  cb(Object.assign(new Error('not found'), { code: 'ENOTFOUND' }));
}

function listen(server, port) {
  return new Promise((ok, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', ok); });
}

async function start() {
  const fetcher = fetcherLib.createFetcher({ bases: guard.koneBases(sites), resolve, allowPrivate: true, allowPorts: [PORTS.fake] });
  const app = handlers.createApp({
    env: { WCM_PASSWORD: PASSWORD, WCM_SESSION_SECRET: 'z'.repeat(40) },
    sites, fetcher, failDelayMs: 50, sitemapOptions: { originOf: base }
  });
  const backend = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      app.handle({ method: req.method, path: req.url, headers: req.headers, body: Buffer.concat(chunks).toString(), ip: '1' })
        .then(o => { res.writeHead(o.status, o.headers); res.end(o.body); });
    });
  });
  const fake = http.createServer(fakeSites);
  const tool = staticSite.create();
  await Promise.all([listen(fake, PORTS.fake), listen(backend, PORTS.backend), listen(tool, PORTS.tool)]);
  return {
    stop: () => Promise.all([fake, backend, tool].map(s => new Promise(done => { s.closeAllConnections && s.closeAllConnections(); s.close(done); })))
  };
}

module.exports = {
  start, PORTS, PASSWORD,
  toolUrl: 'http://localhost:' + PORTS.tool,
  backendUrl: 'http://localhost:' + PORTS.backend,
  site: (host, p) => base(host) + (p || '/')
};

if (require.main === module) start().then(() => console.log('Harness up: tool ' + module.exports.toolUrl + ', backend ' + module.exports.backendUrl));

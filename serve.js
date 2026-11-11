// serve.js — static host for the analyser. Node core only, no dependencies.
//
// The app fetches its config JSONs at runtime, which the browser blocks over
// file://, so it needs to be served rather than opened from disk. That is the
// only reason this file exists — there is no backend.
//
// It sends the same response headers the deployed site does (read from
// vercel.json), so the Content-Security-Policy is exercised locally and by
// the browser tests, not discovered in production.
//
// Run: npm start   (PORT env var to override 3600)

var http = require('http');
var fs = require('fs');
var path = require('path');

var ROOT = __dirname;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8'
};

// The deployed site's headers, with one local allowance: the backend runs on
// another localhost port in development (config/backend.json's devUrl).
function siteHeaders() {
  var out = {};
  try {
    var cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    (cfg.headers || []).forEach(function (rule) {
      if (rule.source !== '/(.*)') return;
      rule.headers.forEach(function (h) { out[h.key] = h.value; });
    });
  } catch (e) { /* no vercel.json: serve without them */ }
  var csp = out['Content-Security-Policy'];
  if (csp) out['Content-Security-Policy'] = csp.replace(/connect-src ([^;]*)/, 'connect-src $1 http://localhost:* http://127.0.0.1:*');
  return out;
}

function create() {
  var headers = siteHeaders();
  return http.createServer(function (req, res) {
    var requested = decodeURIComponent(req.url.split('?')[0]);
    if (requested === '/') requested = '/index.html';

    var file = path.join(ROOT, requested);
    // The server is local-only, but a traversal out of ROOT is still a bug worth
    // refusing rather than relying on nobody trying it.
    if (path.relative(ROOT, file).split(path.sep)[0] === '..') {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }

    fs.readFile(file, function (err, data) {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, Object.assign({}, headers, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' }));
      res.end(data);
    });
  });
}

module.exports = { create: create, siteHeaders: siteHeaders };

if (require.main === module) {
  var PORT = process.env.PORT || 3600;
  create().listen(PORT, function () {
    console.log('WCM Brief Analyser running at http://localhost:' + PORT);
  });
}

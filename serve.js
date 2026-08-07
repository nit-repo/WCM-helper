// serve.js — static host for the analyser. Node core only, no dependencies.
//
// The app fetches its config JSONs at runtime, which the browser blocks over
// file://, so it needs to be served rather than opened from disk. That is the
// only reason this file exists — there is no backend.
//
// Run: npm start   (PORT env var to override 3600)

var http = require('http');
var fs = require('fs');
var path = require('path');

var PORT = process.env.PORT || 3600;
var ROOT = __dirname;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8'
};

var server = http.createServer(function (req, res) {
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log('WCM Brief Analyser running at http://localhost:' + PORT);
});

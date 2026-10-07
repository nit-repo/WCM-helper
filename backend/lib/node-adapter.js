// node-adapter.js — turn a Node request into handlers.js's shape and back.
// Shared by api/index.js (Vercel) and server.js (plain Node).

'use strict';

var handlers = require('./handlers');

// The site registry the browser uses, read from the repo itself so the two
// can never disagree about which hosts are KONE. A plain require, so
// Vercel's bundler traces it in from outside the backend folder.
function loadSites() {
  return require('../../config/sites.json');
}

function readBody(req, max) {
  // Vercel may have read and parsed the body already.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') return Promise.resolve(req.body);
    if (Buffer.isBuffer(req.body)) return Promise.resolve(req.body.toString('utf8'));
    return Promise.resolve(req.body == null ? '' : JSON.stringify(req.body));
  }
  return new Promise(function (resolve, reject) {
    var chunks = [], size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('request too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

function clientIp(req) {
  var fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function createNodeHandler(options) {
  options = options || {};
  var app = handlers.createApp({ env: options.env || process.env, sites: options.sites || loadSites() });
  return function (req, res) {
    readBody(req, 64 * 1024 + 1)
      .then(function (body) {
        return app.handle({ method: req.method, path: req.url, headers: req.headers, body: body, ip: clientIp(req) });
      }, function (e) {
        return { status: e.status || 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: e.message }) };
      })
      .then(function (out) {
        res.writeHead(out.status, out.headers);
        res.end(out.body);
      });
  };
}

module.exports = { createNodeHandler: createNodeHandler, loadSites: loadSites };

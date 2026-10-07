// server.js — the same backend as a plain Node server, for local use or any
// host that runs Node. Same routes, same rules as the Vercel function.
//
// Run:  WCM_PASSWORD=... WCM_SESSION_SECRET=... node backend/server.js
//       (PORT to override 3700; ALLOWED_ORIGINS for anything beyond localhost:3600)

'use strict';

var http = require('http');
var adapter = require('./lib/node-adapter');

var PORT = process.env.PORT || 3700;

if (!process.env.WCM_PASSWORD || !process.env.WCM_SESSION_SECRET) {
  console.warn('WCM_PASSWORD and WCM_SESSION_SECRET are not both set — every sign-in will be refused.');
}

http.createServer(adapter.createNodeHandler()).listen(PORT, function () {
  console.log('WCM Helper backend on http://localhost:' + PORT + '/api/health');
});

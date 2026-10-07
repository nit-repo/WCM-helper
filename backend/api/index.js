// The Vercel function. backend/vercel.json rewrites every /api/* path here;
// the route is read from the original URL. Everything else lives in lib/.
'use strict';

module.exports = require('../lib/node-adapter').createNodeHandler();

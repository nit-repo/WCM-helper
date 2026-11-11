// scripts/set-version.js — the one place the build string is changed.
//
// Every script tag carries ?v=<build> to bust the browser cache, and app.js
// reads its own tag to show the build in the sidebar. A release changes that
// string on every tag in every page; this does it in one go.
//
// Run: npm run version:set -- 2026-11-11a
//      npm run version:set            (prints the current build)

'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PAGES = ['index.html', 'login.html', 'bookmarklet.html'];
var TAG = /(<script\b[^>]*\bsrc="[^"?]+\?v=)([^"&]*)(")/g;

function versionsIn(html) {
  var out = [], m;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(html)) !== null) if (out.indexOf(m[2]) === -1) out.push(m[2]);
  return out;
}

function current() {
  var all = [];
  PAGES.forEach(function (p) {
    versionsIn(fs.readFileSync(path.join(ROOT, p), 'utf8')).forEach(function (v) { if (all.indexOf(v) === -1) all.push(v); });
  });
  return all;
}

function set(version) {
  if (!/^[\w.-]+$/.test(version)) throw new Error('a build string is letters, digits, dots and dashes — got "' + version + '"');
  var changed = 0;
  PAGES.forEach(function (p) {
    var file = path.join(ROOT, p);
    var html = fs.readFileSync(file, 'utf8');
    var next = html.replace(TAG, function (all, a, old, c) { changed++; return a + version + c; });
    if (next !== html) fs.writeFileSync(file, next);
  });
  return changed;
}

module.exports = { PAGES: PAGES, versionsIn: versionsIn, current: current, set: set };

if (require.main === module) {
  var wanted = process.argv[2];
  if (!wanted) {
    console.log('Current build: ' + current().join(', '));
  } else {
    var n = set(wanted);
    console.log('Build set to ' + wanted + ' on ' + n + ' script tags in ' + PAGES.join(', ') + '.');
  }
}

// auth.js — one password, no user names.
//
// The password lives only in the backend's environment (WCM_PASSWORD). A
// correct one is exchanged for a signed token: its expiry and an HMAC of it
// under WCM_SESSION_SECRET. Nothing is stored server-side, so it works the
// same on a serverless function that forgets everything between calls.
//
// If either variable is missing the backend refuses every login rather than
// running open — an unconfigured deployment must never be a public fetcher.

'use strict';

var crypto = require('crypto');

var TTL_MS = 12 * 60 * 60 * 1000;

function digest(s) { return crypto.createHash('sha256').update(String(s), 'utf8').digest(); }

// Constant-time, and length-blind: both sides are hashed to the same length first.
function passwordMatches(given, expected) {
  if (!expected) return false;
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', String(secret)).update(payload).digest('base64url');
}

function issueToken(secret, now, ttl) {
  var exp = (now || Date.now()) + (ttl || TTL_MS);
  var payload = 'v1.' + exp;
  return { token: payload + '.' + sign(payload, secret), expiresAt: new Date(exp).toISOString() };
}

function verifyToken(token, secret, now) {
  if (!secret || typeof token !== 'string') return { ok: false, reason: 'no session' };
  var parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1' || !/^\d+$/.test(parts[1])) return { ok: false, reason: 'not a session token' };
  var expected = Buffer.from(sign(parts[0] + '.' + parts[1], secret));
  var given = Buffer.from(parts[2]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { ok: false, reason: 'session not recognised' };
  var exp = Number(parts[1]);
  if (exp <= (now || Date.now())) return { ok: false, reason: 'session expired — sign in again' };
  return { ok: true, expiresAt: new Date(exp).toISOString() };
}

// Best effort on a serverless host — each instance keeps its own count — but
// it turns a scripted guess-a-minute into something slow and visible.
function createThrottle(options) {
  options = options || {};
  var max = options.max || 5, windowMs = options.windowMs || 10 * 60 * 1000;
  var now = options.now || Date.now;
  var seen = {};
  return {
    blocked: function (key) {
      var e = seen[key];
      if (e && now() > e.resetAt) { delete seen[key]; return false; }
      return !!e && e.count >= max;
    },
    fail: function (key) {
      var e = seen[key];
      if (!e || now() > e.resetAt) e = seen[key] = { count: 0, resetAt: now() + windowMs };
      e.count++;
    },
    clear: function (key) { delete seen[key]; }
  };
}

module.exports = {
  passwordMatches: passwordMatches,
  issueToken: issueToken,
  verifyToken: verifyToken,
  createThrottle: createThrottle,
  TTL_MS: TTL_MS
};

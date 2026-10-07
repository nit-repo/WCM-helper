/* backend-client.js — WCM Helper's one way to talk to its backend.
 *
 * The backend (backend/ in this repo, deployed on its own) is the only thing
 * that ever fetches a URL. This file finds it, signs in to it with the
 * password, keeps the session token, and wraps its five calls. A 401 from
 * any of them means the session is gone, and the page goes back to sign-in.
 *
 * config/backend.json says where the backend is. With no url there, the tool
 * runs as it always has — paste and bookmarklet only — and nothing here
 * gates anything.
 *
 * Runs in the browser only (window.WcmBackend).
 */
(function (root) {
  'use strict';

  var TOKEN_KEY = 'wcm_helper_session';

  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }
  function getToken() {
    try {
      var raw = store() && store().getItem(TOKEN_KEY);
      if (!raw) return null;
      var t = JSON.parse(raw);
      if (!t || !t.token || Date.parse(t.expiresAt) <= Date.now()) return null;
      return t;
    } catch (e) { return null; }
  }
  function setToken(t) { try { if (store()) store().setItem(TOKEN_KEY, JSON.stringify(t)); } catch (e) { /* private window */ } }
  function clearToken() { try { if (store()) store().removeItem(TOKEN_KEY); } catch (e) { /* nothing to clear */ } }

  function isLocal() { return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname); }

  function create(cfg) {
    cfg = cfg || {};
    var base = String((isLocal() && cfg.devUrl) || cfg.url || '').replace(/\/+$/, '');
    var enabled = !!base;

    function toLogin() {
      var here = location.pathname.split('/').pop() || 'index.html';
      location.replace('login.html?next=' + encodeURIComponent(here));
    }

    function call(method, path, body, options) {
      options = options || {};
      var headers = { 'Content-Type': 'application/json' };
      var t = getToken();
      if (t && !options.anonymous) headers.Authorization = 'Bearer ' + t.token;
      return fetch(base + '/api/' + path, {
        method: method, headers: headers, body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit', cache: 'no-store'
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (json) {
          if (res.status === 401 && !options.anonymous) {
            clearToken();
            if (!options.noRedirect) toLogin();
          }
          if (!res.ok) {
            var err = new Error(json.error || ('the backend answered ' + res.status));
            err.status = res.status;
            throw err;
          }
          return json;
        });
      }, function () {
        var err = new Error('the backend at ' + base + ' is not answering');
        err.offline = true;
        throw err;
      });
    }

    return {
      enabled: enabled,
      base: base,
      signedIn: function () { return !!getToken(); },
      login: function (password) {
        return call('POST', 'login', { password: password }, { anonymous: true }).then(function (t) { setToken(t); return t; });
      },
      // Resolves { ok } — false with a reason when there is no live session.
      session: function () {
        if (!getToken()) return Promise.resolve({ ok: false, reason: 'not signed in' });
        return call('GET', 'session', null, { noRedirect: true }).then(function (r) { return { ok: true, expiresAt: r.expiresAt }; },
          function (e) { return { ok: false, reason: e.message, offline: !!e.offline }; });
      },
      signOut: function () { clearToken(); toLogin(); },
      toLogin: toLogin,
      fetchPage: function (url) { return call('POST', 'fetch', { url: url }); },
      discover: function (site, opts) {
        opts = opts || {};
        return call('POST', 'discover', { site: site, perSiteLimit: opts.perSiteLimit, pathPrefix: opts.pathPrefix });
      },
      sitemap: function (url, opts) { return call('POST', 'sitemap', { url: url, perSiteLimit: (opts || {}).perSiteLimit }); },
      linkStatus: function (urls) { return call('POST', 'link-status', { urls: urls }); }
    };
  }

  // Read config/backend.json and build the client. A missing or broken file
  // means no backend — the tool still works, without live fetching.
  function load(version) {
    return fetch('config/backend.json' + (version ? '?v=' + encodeURIComponent(version) : ''), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(create);
  }

  root.WcmBackend = { create: create, load: load };
}(typeof self !== 'undefined' ? self : this));

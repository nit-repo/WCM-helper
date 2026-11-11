/* login.js — the sign-in page's one job: trade the password for a session.
 *
 * A file of its own rather than an inline script: the site's
 * Content-Security-Policy runs scripts from this origin only.
 */
/* global WcmBackend */
(function () {
  'use strict';
  var form = document.getElementById('login-form');
  var input = document.getElementById('password');
  var btn = document.getElementById('login-btn');
  var error = document.getElementById('login-error');

  // Only ever back to a page of this tool — never to an address handed in
  // through the query string.
  var next = new URLSearchParams(location.search).get('next') || 'index.html';
  if (!/^[a-z0-9_-]+\.html$/i.test(next)) next = 'index.html';

  WcmBackend.load().then(function (client) {
    if (!client.enabled) { location.replace(next); return; }
    client.session().then(function (s) {
      if (s.ok) { location.replace(next); return; }
      if (s.offline) error.textContent = s.reason.charAt(0).toUpperCase() + s.reason.slice(1) + '.';
      btn.disabled = false;
    });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      btn.disabled = true;
      error.textContent = '';
      client.login(input.value).then(function () { location.replace(next); }, function (err) {
        error.textContent = err.status === 401 ? 'Wrong password.' : err.message.charAt(0).toUpperCase() + err.message.slice(1) + '.';
        btn.disabled = false;
        input.select();
      });
    });
  });
}());

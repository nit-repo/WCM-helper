/* gate.js — hides the tool until app.js has checked the sign-in.
 *
 * Loaded first, in <head>, so the page never flashes up before bouncing to
 * login.html. A file of its own rather than an inline script: the site's
 * Content-Security-Policy runs scripts from this origin only.
 */
document.documentElement.className += ' gating';

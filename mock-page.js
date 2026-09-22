/* mock-page.js — draws the page a page-model.js model describes.
 *
 * Takes the neutral model build()/buildFromPage() already produced and
 * turns it into one HTML string — used both for the live preview (inside
 * a sandboxed iframe) and for the exported file, so what a reviewer sees
 * is exactly what gets downloaded.
 *
 * Every value that reaches the output is escaped. Every href is validated
 * to http:, https: or a relative path before it is ever written as a live
 * anchor — anything else renders as inert text instead. No <img src> is
 * ever emitted, for any asset, including one that carries a real URL: an
 * off-origin image request is exactly what index.html's "zero external
 * requests" rule forbids, so an asset renders as a labelled placeholder
 * box instead, never a fetch.
 *
 * The page this produces resembles the structure of a real KONE landing
 * page — a hero band, numbered cards, a step flow, an accordion, a dark
 * contact band — without pretending to reproduce the production design.
 * Every color and radius it uses is one of the tokens index.html's own
 * :root already defines, redeclared inside this document's own <style>
 * since the two are separate documents (this one lives inside an iframe's
 * srcdoc and never touches index.html's CSS).
 *
 * Runs in the browser (window.BriefMockPage) and in Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BriefMockPage = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ─── SAFETY ──────────────────────────────────────────────────────────────

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Only http:, https: and a relative path (no scheme at all) are ever
  // written as a live href. A protocol-relative //host is rejected along
  // with javascript:, data:, vbscript: and every other scheme — anything
  // this cannot vouch for renders as inert text instead of a live anchor.
  function safeHref(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return null;
    if (/^\/\//.test(s)) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^[a-z][a-z0-9+.\-]*:/i.test(s)) return null;
    return s;
  }

  function link(label, href, cls) {
    var text = esc(label || href || 'Link');
    var safe = safeHref(href);
    if (safe) return '<a class="' + cls + '" href="' + esc(safe) + '">' + text + '</a>';
    // A rejected or missing href still shows the label, just never as a
    // live anchor — the review outline is what surfaces the problem, this
    // is only the last line of defence against it reaching the DOM.
    return '<span class="' + cls + ' mock-link-inert">' + text + '</span>';
  }

  // ─── SMALL BUILDING BLOCKS ───────────────────────────────────────────────

  function tag(c) {
    if (!c) return '';
    return '<span class="mock-tag mock-tag-' + esc(c.confidence) + '">' +
      esc(c.type) + ' · ' + esc(c.confidence) + ' confidence</span>';
  }

  function placeholderImage(img) {
    if (!img) return '';
    return '<div class="mock-image">' +
      '<span class="mock-image-glyph" aria-hidden="true">▦</span>' +
      '<span class="mock-image-name">' + esc(img.asset || 'untitled asset') + '</span>' +
      (img.alt ? '<span class="mock-image-alt">' + esc(img.alt) + '</span>' : '') +
      '</div>';
  }

  function heading(text, level) {
    return '<' + level + ' class="mock-heading">' + esc(text) + '</' + level + '>';
  }

  function paragraphs(list) {
    return (list || []).map(function (p) { return '<p class="mock-body">' + esc(p) + '</p>'; }).join('');
  }

  // ─── PER-TYPE RENDERERS ──────────────────────────────────────────────────
  // Each returns the section's inner HTML; the caller wraps it in the band
  // and applies the shared heading-level bookkeeping.

  function renderHero(c, level) {
    return '<div class="mock-band mock-band-blue mock-hero">' +
      (c.subtitle ? '<p class="mock-kicker">' + esc(c.subtitle) + '</p>' : '') +
      (c.heading ? heading(c.heading, level) : '') +
      paragraphs(c.body) +
      (c.links.length ? '<div class="mock-cta-row">' +
        c.links.map(function (l) { return link(l.label, l.href, 'mock-btn'); }).join('') + '</div>' : '') +
      placeholderImage(c.image) +
      '</div>';
  }

  function renderContent(c, level) {
    return '<div class="mock-band mock-band-white mock-content">' +
      (c.heading ? heading(c.heading, level) : '') +
      paragraphs(c.body) +
      placeholderImage(c.image) +
      '</div>';
  }

  function renderCards(c, level) {
    return '<div class="mock-band mock-band-sand mock-cards">' +
      (c.heading ? heading(c.heading, level) : '') +
      paragraphs(c.body) +
      '<div class="mock-card-grid">' +
      c.items.map(function (it, i) {
        return '<div class="mock-card">' +
          '<span class="mock-card-num">' + (i + 1) + '</span>' +
          '<h3 class="mock-card-title">' + esc(it.title || '') + '</h3>' +
          '<p class="mock-card-body">' + esc(it.body || '') + '</p>' +
          '</div>';
      }).join('') + '</div></div>';
  }

  function renderSteps(c, level) {
    return '<div class="mock-band mock-band-gray mock-steps">' +
      (c.heading ? heading(c.heading, level) : '') +
      '<div class="mock-step-row">' +
      c.items.map(function (it, i) {
        return '<div class="mock-step">' +
          '<span class="mock-step-num">' + (i + 1) + '</span>' +
          '<h3 class="mock-step-title">' + esc(it.title || '') + '</h3>' +
          '<p class="mock-step-body">' + esc(it.body || '') + '</p>' +
          '</div>';
      }).join('') + '</div></div>';
  }

  function renderTable(c, level) {
    return '<div class="mock-band mock-band-black mock-table">' +
      (c.heading ? heading(c.heading, level) : '') +
      '<table class="mock-tbl"><tbody>' +
      c.items.map(function (it) {
        return '<tr><td>' + esc(it.title || '') + '</td><td>' + esc(it.body || '') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function renderAccordion(c, level) {
    return '<div class="mock-band mock-band-white mock-accordion">' +
      (c.heading ? heading(c.heading, level) : '') +
      c.items.map(function (it) {
        return '<details class="mock-faq"><summary>' + esc(it.question || '') + '</summary>' +
          '<p>' + esc(it.answer || '') + '</p></details>';
      }).join('') + '</div>';
  }

  function renderCta(c) {
    return '<div class="mock-band mock-band-sand mock-cta">' +
      (c.links.length ? c.links.map(function (l) { return link(l.label, l.href, 'mock-link'); }).join('') : '') +
      '</div>';
  }

  function renderImageComponent(c, level) {
    return '<div class="mock-band mock-band-white mock-image-block">' +
      (c.heading ? heading(c.heading, level) : '') +
      placeholderImage(c.image) +
      '</div>';
  }

  function renderGeneric(c, level) {
    return '<div class="mock-band mock-band-white mock-generic">' +
      '<p class="mock-generic-flag">Unreviewed — ' + esc(c.why) + '</p>' +
      (c.heading ? heading(c.heading, level) : '') +
      paragraphs(c.body) +
      '</div>';
  }

  var RENDERERS = {
    hero: renderHero, content: renderContent, cards: renderCards, steps: renderSteps,
    table: renderTable, accordion: renderAccordion, cta: renderCta,
    image: renderImageComponent, generic: renderGeneric
  };

  // ─── PAGE ASSEMBLY ───────────────────────────────────────────────────────

  function renderComponent(c, level, showLabels) {
    var fn = RENDERERS[c.type] || renderGeneric;
    var inner = fn(c, level);
    if (!showLabels) return '<section class="mock-section" data-mock-id="' + esc(c.id) + '">' + inner + '</section>';
    return '<section class="mock-section" data-mock-id="' + esc(c.id) + '">' + tag(c) + inner + '</section>';
  }

  function renderPageHead(page) {
    return '<div class="mock-pagehead">' +
      '<p class="mock-pagehead-path">' + esc(page.path || 'No URL declared') + '</p>' +
      (page.title ? '<p class="mock-pagehead-title">' + esc(page.title) + '</p>' : '') +
      '</div>';
  }

  var CSS = [
    ':root{--kone-blue:#1450F5;--blue-20:#D0DCFD;--white:#FFFFFF;--black:#141414;--sand:#F3EEE6;',
    '--black-60:#727272;--black-40:#A1A1A1;--black-20:#D0D0D0;--hairline:#E6E6E6;--red:#FF5F28;',
    '--amber:#A1681D;--amber-bg:#FFF6E9;--green:#087827;--green-bg:#E8FBF1;--radius-md:8px;',
    '--font-primary:Inter,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;',
    '--font-secondary:"KONE Information",Inter,system-ui,Arial,sans-serif;}',
    '*{box-sizing:border-box;}',
    'body{margin:0;font-family:var(--font-primary);color:var(--black);background:var(--white);line-height:1.55;}',
    'main{max-width:960px;margin:0 auto;}',
    '.mock-pagehead{padding:14px 24px;background:var(--sand);border-bottom:1px solid var(--hairline);}',
    '.mock-pagehead-path{margin:0;font-size:11px;color:var(--black-60);word-break:break-all;}',
    '.mock-pagehead-title{margin:4px 0 0;font-size:13px;color:var(--black);}',
    '.mock-section{position:relative;}',
    '.mock-tag{position:absolute;top:10px;right:14px;font-family:var(--font-secondary);font-size:10px;',
    'text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;border-radius:4px;background:rgba(255,255,255,.85);color:var(--black-60);z-index:2;}',
    '.mock-tag-high{color:var(--green);}.mock-tag-medium{color:var(--amber);}.mock-tag-low{color:var(--red);}',
    '.mock-band{padding:36px 24px;}',
    '.mock-band-white{background:var(--white);}',
    '.mock-band-sand{background:var(--sand);}',
    '.mock-band-gray{background:#F7F7F6;}',
    '.mock-band-blue{background:var(--kone-blue);color:var(--white);}',
    '.mock-band-black{background:var(--black);color:var(--white);}',
    '.mock-heading{margin:0 0 12px;font-weight:400;letter-spacing:-.01em;font-size:26px;line-height:1.2;}',
    '.mock-hero .mock-heading{font-size:32px;}',
    '.mock-kicker{margin:0 0 10px;font-family:var(--font-secondary);text-transform:uppercase;letter-spacing:.08em;font-size:11px;color:rgba(255,255,255,.7);}',
    '.mock-body{margin:0 0 12px;font-size:14.5px;line-height:1.6;max-width:640px;}',
    '.mock-band-blue .mock-body{color:rgba(255,255,255,.85);}',
    '.mock-cta-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px;}',
    '.mock-btn{display:inline-block;background:var(--white);color:var(--kone-blue);padding:11px 20px;border-radius:var(--radius-md);text-decoration:none;font-size:13.5px;}',
    '.mock-card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:20px;}',
    '.mock-card{background:var(--white);border:1px solid var(--hairline);border-radius:var(--radius-md);padding:18px;}',
    '.mock-card-num{display:inline-block;font-family:var(--font-secondary);font-size:12px;color:var(--kone-blue);margin-bottom:8px;}',
    '.mock-card-title{margin:0 0 6px;font-size:14.5px;font-weight:600;}',
    '.mock-card-body{margin:0;font-size:13px;color:var(--black-60);line-height:1.5;}',
    '.mock-step-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:18px;margin-top:20px;}',
    '.mock-step-num{display:flex;align-items:center;justify-content:center;width:32px;height:32px;background:var(--kone-blue);color:var(--white);border-radius:var(--radius-md);font-size:13px;margin-bottom:10px;}',
    '.mock-step-title{margin:0 0 6px;font-size:14px;font-weight:600;}',
    '.mock-step-body{margin:0;font-size:12.5px;color:var(--black-60);line-height:1.5;}',
    '.mock-tbl{width:100%;border-collapse:collapse;margin-top:16px;}',
    '.mock-tbl td{padding:10px 14px;font-size:13px;border-bottom:1px solid rgba(255,255,255,.15);color:rgba(255,255,255,.85);}',
    '.mock-tbl td:first-child{color:var(--white);width:40%;}',
    '.mock-faq{background:var(--white);border:1px solid var(--hairline);border-radius:var(--radius-md);padding:12px 16px;margin-top:8px;}',
    '.mock-faq summary{cursor:pointer;font-size:14px;}',
    '.mock-faq p{margin:8px 0 0;font-size:13px;color:var(--black-60);line-height:1.55;}',
    '.mock-cta{display:flex;gap:12px;flex-wrap:wrap;}',
    '.mock-link{color:var(--kone-blue);font-size:13px;text-decoration:none;border:1px solid var(--hairline);background:var(--white);padding:8px 16px;border-radius:var(--radius-md);}',
    '.mock-link-inert{color:var(--black-40);border:1px dashed var(--black-20);padding:8px 16px;border-radius:var(--radius-md);font-size:13px;}',
    '.mock-image{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;',
    'border:1px dashed var(--black-20);border-radius:var(--radius-md);padding:28px;margin-top:16px;background:rgba(0,0,0,.02);color:var(--black-60);}',
    '.mock-image-glyph{font-size:22px;color:var(--black-40);}',
    '.mock-image-name{font-size:12px;font-weight:600;}',
    '.mock-image-alt{font-size:11px;color:var(--black-40);}',
    '.mock-generic{border-left:4px solid var(--amber);}',
    '.mock-generic-flag{margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:var(--amber);}',
    '@media(max-width:640px){.mock-band{padding:24px 18px;}.mock-heading{font-size:22px;}.mock-hero .mock-heading{font-size:26px;}}'
  ].join('');

  // model.components -> HTML string + the manifest object embedded in it.
  // options.labels (default true) toggles the type/confidence tag shown on
  // each section — off for a clean export meant to actually show someone.
  function render(model, options) {
    options = options || {};
    var showLabels = options.labels !== false;
    var usedH1 = false;

    var body = model.components.map(function (c) {
      var level = (!usedH1 && c.heading) ? 'h1' : 'h2';
      if (level === 'h1') usedH1 = true;
      return renderComponent(c, level, showLabels);
    }).join('');

    if (!usedH1 && model.page.title) {
      body = heading(model.page.title, 'h1') + body;
    }

    var manifest = {
      generatedAt: new Date().toISOString(),
      origin: model.origin, orientation: model.orientation, market: model.market,
      page: model.page, components: model.components, unresolved: model.unresolved
    };
    var manifestJson = JSON.stringify(manifest).replace(/<\/script/gi, '<\\/script');

    var html = '<!doctype html><html><head><meta charset="utf-8">' +
      '<title>' + esc(model.page.title || 'Untitled page') + '</title>' +
      (model.page.description ? '<meta name="description" content="' + esc(model.page.description) + '">' : '') +
      (model.page.path ? '<link rel="canonical" href="' + esc(model.page.path) + '">' : '') +
      '<style>' + CSS + '</style></head><body>' +
      renderPageHead(model.page) +
      '<main>' + body + '</main>' +
      '<script type="application/json" id="wcm-mock-manifest">' + manifestJson + '</' + 'script>' +
      '</body></html>';

    return { html: html, manifest: manifest };
  }

  function create() {
    return { render: render, safeHref: safeHref, esc: esc };
  }

  return { create: create };
}));

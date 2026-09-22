// test/mock-page.test.js — drawing the page a page-model.js model describes.
// Run: npm test
//
// The failure that matters here is not a wrong pixel — it is a script that
// runs, a link that fires, or a request that leaves the browser. Most cases
// assert on what must NOT reach the output, not on what it looks like.

var assert = require('assert');
var MockPage = require('../mock-page.js');

var mp = MockPage.create();

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + e.message); }
}

// ─── FIXTURES ────────────────────────────────────────────────────────────
// A minimal page-model.js-shaped model, built by hand rather than requiring
// page-model.js — this file tests the renderer in isolation.

function component(overrides) {
  return Object.assign({
    id: 'c1', type: 'content', confidence: 'medium', why: 'test fixture',
    heading: 'A heading', subtitle: null, body: ['Some body copy.'],
    items: [], image: null, links: [], sourceRows: [1], sourceModule: null, warnings: []
  }, overrides || {});
}

// Structural assertions must look only at what actually rendered — the
// <style> block statically defines every mock-card/mock-tag/etc. class
// name regardless of what the model contains, and the manifest carries
// raw (JSON-escaped, not HTML-escaped) text by design, so a substring
// search across the whole document would flag both as false positives.
function mainOnly(html) {
  var m = /<main>([\s\S]*)<\/main>/.exec(html);
  return m ? m[1] : '';
}

function model(components, pageOverrides) {
  return {
    market: null, orientation: 'labelled', origin: 'brief',
    page: Object.assign({ title: 'A Page', description: 'A description', path: '/a-page/', keywords: null,
      template: { type: 'landing', confidence: 'medium', why: 'test' } }, pageOverrides || {}),
    components: components, unresolved: []
  };
}

// ─── SAFETY ──────────────────────────────────────────────────────────────

test('1. a script tag in a heading reaches the output escaped, never executes', function () {
  var m = model([component({ heading: '<script>alert(1)</script>' })]);
  var body = mainOnly(mp.render(m).html);
  assert.ok(!/<script>alert/.test(body), body);
  assert.ok(body.indexOf('&lt;script&gt;alert(1)&lt;/script&gt;') !== -1, body);
});

test('2. an onerror-carrying string in body copy is escaped, not attribute-injected', function () {
  var m = model([component({ body: ['"><img src=x onerror=alert(1)>'] })]);
  var body = mainOnly(mp.render(m).html);
  assert.ok(!/<img/.test(body), body);
  assert.ok(body.indexOf('&quot;&gt;') !== -1 || body.indexOf('&gt;&lt;img') !== -1, body);
});

test('3. a javascript: href never becomes a live anchor', function () {
  var m = model([component({ type: 'cta', links: [{ label: 'Click me', href: 'javascript:alert(1)' }] })]);
  var out = mp.render(m).html;
  assert.ok(!/href="javascript:/i.test(out), out);
  assert.ok(/class="mock-link mock-link-inert"/.test(out), out);
});

test('4. a data: href never becomes a live anchor', function () {
  var m = model([component({ type: 'cta', links: [{ label: 'X', href: 'data:text/html,<script>1</script>' }] })]);
  var out = mp.render(m).html;
  assert.ok(!/href="data:/i.test(out), out);
});

test('5. a protocol-relative //host href is rejected too', function () {
  var m = model([component({ type: 'cta', links: [{ label: 'X', href: '//evil.example.com/x' }] })]);
  var out = mp.render(m).html;
  assert.ok(!/href="\/\//.test(out), out);
});

test('6. an https href survives as a live anchor', function () {
  var m = model([component({ type: 'cta', links: [{ label: 'X', href: 'https://www.kone.com/x' }] })]);
  var out = mp.render(m).html;
  assert.ok(/href="https:\/\/www\.kone\.com\/x"/.test(out), out);
});

test('7. a relative href survives as a live anchor', function () {
  var m = model([component({ type: 'cta', links: [{ label: 'X', href: '/studio/tool/' }] })]);
  var out = mp.render(m).html;
  assert.ok(/href="\/studio\/tool\/"/.test(out), out);
});

test('8. no <img src is ever emitted, even for an image carrying a real URL', function () {
  var m = model([component({ type: 'image', heading: null, image: { asset: 'https://cdn.example.com/hero.jpg', alt: 'A hero image' } })]);
  var out = mp.render(m).html;
  assert.ok(!/<img[\s>]/i.test(out), out);
  assert.ok(out.indexOf('mock-image') !== -1, out);
});

test('9. a missing image asset still renders a labelled placeholder, not a gap', function () {
  var m = model([component({ type: 'image', heading: null, image: { asset: null, alt: null } })]);
  var out = mp.render(m).html;
  assert.ok(/mock-image-name/.test(out), out);
  assert.ok(out.indexOf('untitled asset') !== -1, out);
});

test('10. an opaque asset name (a raw hash) still renders, named plainly', function () {
  var m = model([component({ type: 'image', heading: null, image: { asset: 'a1b2c3d4e5f6a1b2c3d4e5f6', alt: null } })]);
  var out = mp.render(m).html;
  assert.ok(out.indexOf('a1b2c3d4e5f6a1b2c3d4e5f6') !== -1, out);
});

test('11. the </script boundary inside the manifest JSON cannot close the real script tag', function () {
  var m = model([component({ heading: 'Ends with </script> right here' })]);
  var out = mp.render(m).html;
  var manifestBlock = out.slice(out.indexOf('id="wcm-mock-manifest"'));
  assert.ok(manifestBlock.indexOf('<\\/script') !== -1 || !/<\/script>[\s\S]*<\/script>/.test(manifestBlock.slice(0, 40)), out);
  // The document must still parse as exactly one manifest script block.
  assert.strictEqual((out.match(/<script type="application\/json"/g) || []).length, 1, out);
});

// ─── DETERMINISM AND STRUCTURE ─────────────────────────────────────────────

test('12. the same model renders byte-identical HTML twice, except generatedAt', function () {
  var m = model([component({ heading: 'Stable' })]);
  var a = mp.render(m).html.replace(/"generatedAt":"[^"]*"/, '');
  var b = mp.render(m).html.replace(/"generatedAt":"[^"]*"/, '');
  assert.strictEqual(a, b);
});

test('13. the manifest embedded in the export parses back out to the model\'s own components', function () {
  var comps = [component({ id: 'c9', type: 'hero', heading: 'Hero heading' })];
  var m = model(comps);
  var result = mp.render(m);
  var manifestMatch = /<script type="application\/json" id="wcm-mock-manifest">([\s\S]*?)<\/script>/.exec(result.html);
  assert.ok(manifestMatch, result.html);
  var parsed = JSON.parse(manifestMatch[1].replace(/<\\\/script/g, '</script'));
  assert.strictEqual(parsed.components[0].id, 'c9');
  assert.strictEqual(parsed.components[0].heading, 'Hero heading');
  assert.deepStrictEqual(parsed.components, result.manifest.components);
});

test('14. exactly one <h1> is ever emitted, even with several headed components', function () {
  var m = model([component({ id: 'c1', heading: 'First' }), component({ id: 'c2', heading: 'Second' })]);
  var out = mp.render(m).html;
  assert.strictEqual((out.match(/<h1\b/g) || []).length, 1, out);
});

test('15. page.title becomes the <h1> when no component has a heading at all', function () {
  var m = model([component({ heading: null, body: ['Just body copy, no heading on this one.'] })], { title: 'Fallback Title' });
  var out = mp.render(m).html;
  assert.strictEqual((out.match(/<h1\b/g) || []).length, 1, out);
  assert.ok(/<h1[^>]*>Fallback Title<\/h1>/.test(out), out);
});

test('16. <title>, meta description and canonical link reflect page metadata', function () {
  var out = mp.render(model([component()])).html;
  assert.ok(/<title>A Page<\/title>/.test(out), out);
  assert.ok(/<meta name="description" content="A description">/.test(out), out);
  assert.ok(/<link rel="canonical" href="\/a-page\/">/.test(out), out);
});

test('17. the whole body sits inside a single <main>, for readPage\'s region detection', function () {
  var out = mp.render(model([component()])).html;
  assert.strictEqual((out.match(/<main>/g) || []).length, 1, out);
});

test('18. no external request is ever written — no http(s) src, no external stylesheet or script src', function () {
  var m = model([component({ type: 'image', image: { asset: 'https://cdn.example.com/x.jpg' } }),
    component({ id: 'c2', type: 'cta', links: [{ label: 'X', href: 'https://www.kone.com/x' }] })]);
  var out = mp.render(m).html;
  assert.ok(!/<link\b[^>]*rel="stylesheet"/i.test(out), out);
  assert.ok(!/<script\b[^>]*\ssrc=/i.test(out), out);
  assert.ok(!/\ssrc="https?:/i.test(out), out);
});

// ─── PER-TYPE RENDERING ─────────────────────────────────────────────────

test('19. a hero renders its heading, body and CTA row', function () {
  var m = model([component({ type: 'hero', heading: 'Big headline', subtitle: 'A kicker', body: ['Intro copy.'],
    links: [{ label: 'Learn more', href: '/learn/' }] })]);
  var out = mp.render(m).html;
  assert.ok(/mock-hero/.test(out));
  assert.ok(/Big headline/.test(out));
  assert.ok(/Learn more/.test(out));
});

test('20. cards render one numbered card per item', function () {
  var m = model([component({ type: 'cards', items: [{ title: 'One', body: 'First' }, { title: 'Two', body: 'Second' }] })]);
  var body = mainOnly(mp.render(m).html);
  assert.strictEqual((body.match(/<div class="mock-card">/g) || []).length, 2, body);
});

test('21. an accordion renders a <details>/<summary> per Q&A, needing no script', function () {
  var m = model([component({ type: 'accordion', heading: 'FAQ', items: [
    { question: 'Is it safe?', answer: 'Yes.' }, { question: 'How much?', answer: 'Ask us.' }
  ] })]);
  var out = mp.render(m).html;
  assert.strictEqual((out.match(/<details class="mock-faq">/g) || []).length, 2, out);
  assert.ok(/Is it safe\?/.test(out));
});

test('22. a generic component is visibly labelled unreviewed, never passed off as designed', function () {
  var m = model([component({ type: 'generic', why: 'no component signal in these rows' })]);
  var out = mp.render(m).html;
  assert.ok(/Unreviewed/.test(out), out);
  assert.ok(/no component signal in these rows/.test(out), out);
});

test('23. labels toggle off for a clean export', function () {
  var m = model([component({ type: 'hero', heading: 'X' })]);
  var withLabels = mainOnly(mp.render(m, { labels: true }).html);
  var clean = mainOnly(mp.render(m, { labels: false }).html);
  assert.ok(/<span class="mock-tag/.test(withLabels), withLabels);
  assert.ok(!/<span class="mock-tag/.test(clean), clean);
});

test('24. a form component renders generic placeholder fields, visibly not brief-sourced', function () {
  var m = model([component({ type: 'form', heading: 'Talk to us', body: ['Tell us about your project.'],
    links: [{ label: 'Send request', href: null }] })]);
  var body = mainOnly(mp.render(m).html);
  assert.strictEqual((body.match(/mock-form-field"/g) || []).length, 4, body);
  assert.ok(/Name/.test(body) && /Phone/.test(body) && /Email/.test(body) && /Message/.test(body), body);
  assert.ok(/not sourced from the brief/.test(body), body);
  assert.ok(/Send request/.test(body), body);
});

test('25. a form component never emits a real <input> or <form> element', function () {
  var m = model([component({ type: 'form', heading: 'Talk to us' })]);
  var body = mainOnly(mp.render(m).html);
  assert.ok(!/<input\b/i.test(body), body);
  assert.ok(!/<form\b/i.test(body), body);
});

test('26. a value-highlights component renders items distinctly from a plain cards component', function () {
  var m = model([
    component({ id: 'c1', type: 'cards', items: [{ title: 'A', body: 'a' }, { title: 'B', body: 'b' }] }),
    component({ id: 'c2', type: 'value-highlights', heading: 'Value highlights',
      items: [{ title: 'C', body: 'c' }, { title: 'D', body: 'd' }] })
  ]);
  var body = mainOnly(mp.render(m).html);
  assert.strictEqual((body.match(/<div class="mock-card">/g) || []).length, 2, body);
  assert.strictEqual((body.match(/<div class="mock-vh">/g) || []).length, 2, body);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed === 0 ? 0 : 1);

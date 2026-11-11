// Sign-in: the tool sits behind the backend's password once a backend is set.
'use strict';

module.exports = async function (t) {
  const page = await t.page();

  await page.goto(t.harness.toolUrl + '/index.html');
  await page.waitForURL(u => /\/login\.html$/.test(u.pathname));
  t.check('without a session, the tool sends you to the sign-in page', /next=index\.html/.test(page.url()), page.url());

  await page.waitForFunction(() => !document.getElementById('login-btn').disabled);
  await page.fill('#password', 'not-the-password');
  await page.click('#login-btn');
  await page.waitForFunction(() => document.getElementById('login-error').textContent !== '');
  t.check('a wrong password says so and stays on the page', await page.textContent('#login-error') === 'Wrong password.' && /login\.html/.test(page.url()),
    await page.textContent('#login-error'));

  await page.fill('#password', t.harness.PASSWORD);
  await page.click('#login-btn');
  await page.waitForURL(u => /\/index\.html$/.test(u.pathname));
  await t.ready(page);
  t.check('the right password opens the tool, with Sign out showing', await page.isVisible('#signout-btn'));
  const build = await page.textContent('#build-tag');
  t.check('the sidebar shows the build read from the script tag', /\d{4}-\d{2}-\d{2}/.test(build), build);

  await page.reload();
  await t.ready(page);
  t.check('the session survives a reload', /\/index\.html$/.test(new URL(page.url()).pathname));

  await page.click('#signout-btn');
  await page.waitForURL(u => /\/login\.html$/.test(u.pathname));
  t.check('Sign out returns to the sign-in page', true);
  await page.goto(t.harness.toolUrl + '/index.html');
  await page.waitForURL(u => /\/login\.html$/.test(u.pathname));
  t.check('and the tool is closed again afterwards', true);
};

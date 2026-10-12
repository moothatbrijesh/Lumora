// Run only against the local development app. Cleans up its own fictional users.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../backend/.env'), quiet: true });

(async () => {
  assert.ok(process.env.DATABASE_URL, 'Configure backend/.env before running browser tests.');
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname), 'Browser smoke tests require a local development database.');
  const browser = await chromium.launch({
    executablePath: process.env.LUMORA_BROWSER_EXECUTABLE || undefined,
    headless: true,
  });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 3000 });
  const suffix = randomUUID();
  const email = `browser-${suffix}@example.invalid`;
  const secondEmail = `second-${suffix}@example.invalid`;
  const password = `Test-only phrase ${randomUUID()}`;
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    const activeText = text => page.getByText(text, { exact: true }).and(page.locator(':not([aria-hidden="true"] *)'));
    const tab = name => page.getByRole('tab', { name, exact: true });
    await page.goto('http://localhost:8081', { waitUntil: 'networkidle' });
    assert.equal(await page.getByRole('tab').count(), 0);
    await page.getByLabel('Your name', { exact: true }).fill('Browser Explorer');
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password', { exact: true }).fill('wrong');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByText('Your passwords do not match.').waitFor();
    await page.getByLabel('Confirm password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome, Browser Explorer.' }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 5);
    for (const [name, heading, cardTitle] of [['Chat', 'A space to talk it through.', 'Your AI companion'], ['Journal', 'Your story, in your words.', 'Your journal is taking shape'], ['Goals', 'Grow at your own pace.', 'Make room for a goal']]) {
      await tab(name).click();
      await page.getByRole('heading', { name: heading, exact: true }).waitFor();
      assert.equal(await tab(name).getAttribute('aria-selected'), 'true');
      await page.getByRole('heading', { name: cardTitle, exact: true }).locator('..').getByText('Coming soon', { exact: true }).waitFor();
      assert.equal(await page.getByRole('textbox').count(), 0);
    }
    await tab('Home').click();
    await page.getByRole('button', { name: 'Check in with yourself', exact: true }).click();
    await page.getByRole('heading', { name: 'How are you feeling?', exact: true }).waitFor();
    await page.getByRole('link', { name: /back/i }).click();
    await page.getByRole('button', { name: 'See your journey', exact: true }).click();
    await page.getByRole('heading', { name: 'Growth takes many forms.', exact: true }).waitFor();
    await page.getByRole('link', { name: /back/i }).click();
    await page.getByRole('button', { name: 'Make space to reflect', exact: true }).click();
    await page.getByRole('heading', { name: 'Your story, in your words.', exact: true }).waitFor();
    await tab('Profile').click();
    await page.getByRole('heading', { name: 'Browser Explorer', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Check my session', exact: true }).click();
    await activeText('Your session is active.').waitFor();
    await page.getByRole('button', { name: 'Check connection', exact: true }).click();
    await page.getByText('Lumora is connected and ready.').waitFor();
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await page.route('**/auth/logout', route => route.abort());
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await activeText('Could not sign out securely. Check your connection and try again.').waitFor();
    await tab('Profile').waitFor();
    await page.unroute('**/auth/logout');
    await page.evaluate(() => history.pushState({}, '', location.href));
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 0);
    await page.goBack();
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 0);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill('This is not the correct password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByText('Email or password is incorrect.').waitFor();
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome, Browser Explorer.' }).waitFor();
    if (process.env.LUMORA_SCREENSHOT_PATH) await page.screenshot({ path: process.env.LUMORA_SCREENSHOT_PATH });
    // Exercise small-phone and desktop widths without horizontal overflow.
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.getByRole('tab').count(), 5);
      for (const name of ['Home', 'Chat', 'Journal', 'Goals', 'Profile']) {
        const label = await tab(name).getByText(name, { exact: true }).boundingBox();
        assert.ok(label && label.y + label.height <= 844, `${name} label must fit inside the viewport`);
      }
    }
    await tab('Profile').click();
    await pool.query("UPDATE auth_sessions SET created_at = now() - interval '2 days', expires_at = now() - interval '1 day' WHERE user_id = (SELECT id FROM users WHERE email = $1)", [email]);
    await page.getByRole('button', { name: 'Check my session', exact: true }).click();
    await page.getByText('Your session has ended. Please sign in again.').waitFor();
    assert.equal(await page.getByRole('tab').count(), 0);
    const second = await fetch('http://127.0.0.1:3000/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: secondEmail, password, displayName: 'Second Explorer' }) });
    assert.equal(second.status, 201);
    await page.getByLabel('Email', { exact: true }).fill(secondEmail);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome, Second Explorer.' }).waitFor();
    assert.equal(await page.getByText('Welcome, Browser Explorer.', { exact: true }).count(), 0);
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: 'Begin your journey', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: registration/login, all five tabs, Mood/Progress and Back, honest feature placeholders, profile/readiness, logout failure/retry, Back after logout, expiry, account switching, browser reload, responsive widths, no runtime errors.');
  } finally {
    await browser.close();
    await pool.query('DELETE FROM users WHERE email = ANY($1::text[])', [[email, secondEmail]]);
    await pool.end();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

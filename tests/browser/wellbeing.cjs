// Real UI and database, with an isolated schema and test-only AI provider.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

(async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'tests/chat-browser-server.ts'], {
    cwd: path.resolve(__dirname, '../../backend'), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let browser;
  try {
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test server startup timed out. Start db-test and configure TEST_DATABASE_URL.')), 20000);
      child.once('message', message => { clearTimeout(timer); resolve(`http://127.0.0.1:${message.port}`); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test server exited with code ${code}`)); });
    });
    const contexts = async () => { const next = once(child, 'message'); child.send('contexts'); return (await next)[0].contexts; };
    browser = await chromium.launch({ executablePath: process.env.LUMORA_BROWSER_EXECUTABLE || undefined });
    const errors = [];
    const writes = [];
    let dropMoodReply = false;
    let failPreferencesSave = false;
    const createPage = async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Dubai' });
      const page = await context.newPage();
      page.setDefaultTimeout(20000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route(/http:\/\/(localhost|127\.0\.0\.1):3000\//, async route => {
        const source = new URL(route.request().url());
        if (failPreferencesSave && source.pathname === '/preferences' && route.request().method() === 'PUT') {
          failPreferencesSave = false;
          await route.fulfill({ status: 503, json: { error: 'Test-only unavailable preferences save.' } });
          return;
        }
        const result = await route.fetch({ url: origin + source.pathname + source.search });
        if (source.pathname === '/moods/today' && route.request().method() === 'PUT' && result.ok()) {
          writes.push((await result.json()).entry);
          // Lose one response after the real write, exercising a safe save retry.
          if (dropMoodReply) { dropMoodReply = false; await route.abort(); return; }
        }
        await route.fulfill({ response: result });
      });
      await page.goto('http://localhost:8081', { waitUntil: 'networkidle' });
      return page;
    };
    const password = 'Test-only memorable phrase 456';
    const register = async (page, name, email) => {
      await page.getByLabel('Your name', { exact: true }).fill(name);
      await page.getByLabel('Email', { exact: true }).fill(email);
      await page.getByLabel('Password', { exact: true }).fill(password);
      await page.getByLabel('Confirm password', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Create account', exact: true }).click();
      await page.getByRole('heading', { name: `Welcome, ${name}.`, exact: true }).waitFor();
    };
    const tab = (page, name) => page.getByRole('tab', { name, exact: true });
    const back = page => page.getByRole('link', { name: /back/i }).click();
    const openMood = async page => {
      await tab(page, 'Home').click();
      await page.getByRole('button', { name: 'Check in with yourself', exact: true }).click();
      await page.getByLabel('A note about your mood', { exact: true }).waitFor();
    };
    const openPreferences = async page => {
      await tab(page, 'Profile').click();
      await page.getByRole('button', { name: 'Faith and worldview', exact: true }).click();
      await page.getByRole('button', { name: 'Prefer not to say', exact: true }).waitFor();
    };
    const preferenceSwitch = page => page.getByRole('switch', { name: 'Use my preference in chat', exact: true });
    const savePreferences = async page => {
      await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
      await page.getByText('Preferences saved.', { exact: true }).waitFor();
    };
    const sendChat = async (page, message, expectedContext) => {
      await tab(page, 'Chat').click();
      const input = page.getByLabel('Message to Lumora', { exact: true });
      await input.fill(message);
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[aria-label="Message to Lumora"]')?.value === '');
      assert.deepEqual((await contexts()).at(-1), expectedContext);
    };

    const page = await createPage();
    await register(page, 'Wellbeing Explorer', 'wellbeing@example.invalid');
    await openMood(page);
    const note = page.getByLabel('A note about your mood', { exact: true });
    assert.equal(await page.getByRole('radio').count(), 5);
    assert.equal(await page.getByRole('button', { name: 'Save check-in', exact: true }).isDisabled(), true);
    await page.getByRole('radio', { name: 'Good', exact: true }).click();
    await note.fill('A fictional walk helped me feel grounded.');
    await page.getByRole('button', { name: 'Save check-in', exact: true }).click();
    await page.getByText('Your check-in is saved.', { exact: true }).waitFor();
    await page.getByText('A fictional walk helped me feel grounded.', { exact: true }).and(page.locator('div')).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Update check-in', exact: true }).isDisabled(), true);
    await page.getByRole('radio', { name: 'Great', exact: true }).click();
    const updatedNote = 'A fictional conversation made this day brighter.';
    await note.fill(updatedNote);
    dropMoodReply = true;
    await page.getByRole('button', { name: 'Update check-in', exact: true }).click();
    await page.getByText(/Your draft is kept\./).waitFor();
    assert.equal(await note.inputValue(), updatedNote);
    assert.equal(await page.getByRole('radio', { name: 'Great', exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Update check-in', exact: true }).click();
    await page.getByText('Your check-in is saved.', { exact: true }).waitFor();
    assert.equal(writes.length, 3);
    assert.equal(new Set(writes.map(entry => entry.id)).size, 1, 'Save/update/retry must keep one entry for this day.');
    assert.equal(writes.at(-1).score, 5);
    await back(page);
    await openMood(page);
    assert.equal(await note.inputValue(), updatedNote);
    assert.equal(await page.getByText(updatedNote, { exact: true }).and(page.locator('div')).count(), 1, 'History contains the updated daily entry once.');
    if (process.env.LUMORA_MOOD_SCREENSHOT_PATH) await page.screenshot({ path: process.env.LUMORA_MOOD_SCREENSHOT_PATH });
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await back(page);

    await openPreferences(page);
    assert.equal(await page.getByRole('button', { name: 'Prefer not to say', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await preferenceSwitch(page).isChecked(), false);
    assert.equal(await preferenceSwitch(page).isDisabled(), true);
    await page.getByRole('button', { name: 'Hindu', exact: true }).click();
    assert.equal(await preferenceSwitch(page).isChecked(), false, 'Selecting a faith must not enable sharing.');
    failPreferencesSave = true;
    await page.getByRole('button', { name: 'Save preferences', exact: true }).click();
    await page.getByText(/Your choices are kept here\. Try saving again\./).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Hindu', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await preferenceSwitch(page).isChecked(), false);
    await savePreferences(page);
    await back(page);
    await sendChat(page, 'A fictional reflection before opting in.', {});
    await openPreferences(page);
    assert.equal(await page.getByRole('button', { name: 'Hindu', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await preferenceSwitch(page).isChecked(), false);
    await preferenceSwitch(page).click();
    await savePreferences(page);
    await page.setViewportSize({ width: 390, height: 844 });
    if (process.env.LUMORA_PREFERENCES_SCREENSHOT_PATH) await page.screenshot({ path: process.env.LUMORA_PREFERENCES_SCREENSHOT_PATH });
    await back(page);
    await sendChat(page, 'A fictional reflection after opting in.', { faith: 'hindu' });
    await openPreferences(page);
    assert.equal(await preferenceSwitch(page).isChecked(), true, 'Saved opt-in persists after reopening.');
    await preferenceSwitch(page).click();
    await savePreferences(page);
    await back(page);
    await sendChat(page, 'A fictional reflection after switching off.', {});
    await openPreferences(page);
    await page.getByRole('button', { name: 'No religion', exact: true }).click();
    await preferenceSwitch(page).click();
    await savePreferences(page);
    await back(page);
    await sendChat(page, 'A fictional reflection with secular guidance.', { faith: 'none' });
    await openPreferences(page);
    await page.getByRole('button', { name: 'Prefer not to say', exact: true }).click();
    assert.equal(await preferenceSwitch(page).isChecked(), false);
    await savePreferences(page);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    }
    await back(page);
    await sendChat(page, 'A fictional reflection after clearing my choice.', {});

    const second = await createPage();
    await register(second, 'Another Explorer', 'another@example.invalid');
    await openMood(second);
    assert.equal(await second.getByLabel('A note about your mood', { exact: true }).inputValue(), '');
    await second.getByText('Your story starts with one check-in. Your saved moods will appear here.', { exact: true }).waitFor();
    assert.equal(await second.getByText(updatedNote, { exact: true }).count(), 0);
    await back(second);
    await openPreferences(second);
    assert.equal(await second.getByRole('button', { name: 'Prefer not to say', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await preferenceSwitch(second).isChecked(), false);
    await second.getByRole('button', { name: 'Sikh', exact: true }).click();
    await preferenceSwitch(second).click();
    await savePreferences(second);
    await back(second);
    await sendChat(second, 'Another account has a different saved preference.', { faith: 'sikh' });
    await openPreferences(page);
    assert.equal(await page.getByRole('button', { name: 'Prefer not to say', exact: true }).getAttribute('aria-pressed'), 'true', 'Another account cannot change the first account.');
    await back(page);
    await tab(page, 'Profile').click();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.getByRole('heading', { name: 'Welcome back', exact: true }).waitFor();
    await page.getByLabel('Email', { exact: true }).fill('wellbeing@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await openMood(page);
    assert.equal(await note.inputValue(), updatedNote, 'Mood persists after signing in again.');
    assert.deepEqual(errors, []);
    console.log('PASS: daily mood save/update, lost-response retry, one entry per day, history and sign-in persistence, account isolation, responsive screens, optional faith selection, explicit opt-in, secular guidance, switch-off/clear, and provider context. Test-only AI provider; no live AI calls.');
  } finally {
    await browser?.close();
    const stopped = once(child, 'exit'); child.kill('SIGTERM');
    if (child.exitCode === null) await stopped;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

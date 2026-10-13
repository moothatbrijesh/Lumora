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
    const calls = async () => { const next = once(child, 'message'); child.send('calls'); return (await next)[0].calls; };
    browser = await chromium.launch({ executablePath: process.env.LUMORA_BROWSER_EXECUTABLE || undefined });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.setDefaultTimeout(20000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    let dropReply = false;
    let statusMode = 'missing';
    let statusProvider = 'gemini';
    let releaseInitialStatus;
    const initialStatus = new Promise(resolve => { releaseInitialStatus = resolve; });
    await page.route(/http:\/\/(localhost|127\.0\.0\.1):3000\//, async route => {
      const source = new URL(route.request().url());
      if (source.pathname === '/chat/status') {
        await initialStatus;
        if (statusMode === 'error') {
          await route.fulfill({ status: 503, json: { message: 'Test-only unavailable chat status.' } });
        } else {
          await route.fulfill({ json: { configured: statusMode === 'ready', provider: statusProvider, maxMessageLength: 4000 } });
        }
        return;
      }
      const result = await route.fetch({ url: origin + source.pathname + source.search, timeout: 60000 });
      if (dropReply && route.request().method() === 'POST' && source.pathname.endsWith('/messages')) {
        dropReply = false; await route.abort();
      } else await route.fulfill({ response: result });
    });
    await page.goto('http://localhost:8081', { waitUntil: 'networkidle' });
    await page.getByLabel('Your name', { exact: true }).fill('Chat Explorer');
    await page.getByLabel('Email', { exact: true }).fill('chat@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('Test-only memorable phrase 456');
    await page.getByLabel('Confirm password', { exact: true }).fill('Test-only memorable phrase 456');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
    await page.getByRole('tab', { name: 'Chat', exact: true }).click();
    const input = page.getByLabel('Message to Lumora', { exact: true });
    await input.waitFor();
    await page.getByLabel('Loading conversations', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check chat again', exact: true }).count(), 0, 'Do not show a missing-key warning while status is still loading.');
    releaseInitialStatus();
    await page.getByText(/AI replies are unavailable until Gemini \(Google\) is configured/).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Message to Lumora"]')?.disabled && !document.querySelector('[aria-label="Message to Lumora"]')?.readOnly);
    await page.getByText(/Your message and recent conversation history go to Gemini \(Google\)/).waitFor();
    await page.getByText(/If this project uses Gemini’s free tier/).waitFor();
    await input.fill('A draft while the provider is not configured.');
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: 'New conversation', exact: true }).isDisabled(), true, 'Switching conversations must not discard a draft.');
    assert.equal(await calls(), 0);
    await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    assert.equal(await input.evaluate(element => element === document.activeElement), true, 'New conversation focuses the editable composer even without a key.');
    await page.getByRole('button', { name: 'Help me plan a manageable goal.', exact: true }).click();
    assert.equal(await input.inputValue(), 'Help me plan a manageable goal.');
    await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
    statusMode = 'error';
    await page.getByRole('button', { name: 'Check chat again', exact: true }).click();
    await page.getByText('Chat could not load. Check your connection and try again.', { exact: true }).waitFor();
    await input.fill('Keep this draft when readiness recovers.');
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true);
    statusMode = 'missing';
    statusProvider = 'openai';
    await page.getByRole('button', { name: 'Check chat again', exact: true }).click();
    await page.getByText(/Your message and recent conversation history go to OpenAI/).waitFor();
    assert.equal(await page.getByText(/If this project uses Gemini’s free tier/).count(), 0);
    assert.equal(await input.inputValue(), 'Keep this draft when readiness recovers.');
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true);
    statusMode = 'ready';
    statusProvider = 'gemini';
    await page.getByRole('button', { name: 'Check chat again', exact: true }).click();
    await page.getByText(/Your message and recent conversation history go to Gemini \(Google\)/).waitFor();
    await page.waitForFunction(() => !document.querySelector('[aria-label="Message to Lumora"]')?.readOnly);
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), false);
    await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
    await input.fill('Test a recoverable provider failure.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText(/Your draft is kept/).waitFor();
    assert.equal(await input.inputValue(), 'Test a recoverable provider failure.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const fixture = 'TEST FIXTURE: Choose one manageable step. This is not a live AI reply.';
    await page.getByText(fixture, { exact: true }).waitFor();
    assert.equal(await calls(), 2);
    assert.equal(await input.inputValue(), '');
    dropReply = true;
    await input.fill('Recover a response lost after saving.');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.getByText(/Your draft is kept/).waitFor();
    assert.equal(await calls(), 3);
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await page.waitForFunction(text => [...document.querySelectorAll('div')].filter(el => el.childElementCount === 0 && el.textContent === text).length === 2, fixture);
    assert.equal(await calls(), 3);
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    assert.equal(await page.getByText(fixture, { exact: true }).count(), 0);
    assert.equal(await input.evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Open conversation: Test a recoverable provider failure.', exact: true }).click();
    await page.getByText('Recover a response lost after saving.', { exact: true }).waitFor();
    assert.equal(await page.getByText(fixture, { exact: true }).count(), 2);
    if (process.env.LUMORA_SCREENSHOT_PATH) await page.screenshot({ path: process.env.LUMORA_SCREENSHOT_PATH });
    await page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click();
    assert.equal(await page.getByText(fixture, { exact: true }).count(), 2);
    await page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await page.getByRole('heading', { name: 'What’s on your mind?', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: /^Open conversation:/ }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS: real chat UI and database with test-only provider; provider disclosure, unavailable/readiness recovery, editable drafts, new-chat focus, retry, lost-response deduplication, history, deletion/cancel, and no runtime errors. No live AI calls made.');
  } finally {
    await browser?.close();
    const stopped = once(child, 'exit'); child.kill('SIGTERM');
    if (child.exitCode === null) await stopped;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

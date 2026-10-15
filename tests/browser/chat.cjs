const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const path = require('node:path');

const phoneSizes = [
  { width: 390, height: 844, minHistory: 140 },
  { width: 390, height: 600, minHistory: 140 },
  { width: 320, height: 568, minHistory: 140 },
  // A reduced browser viewport exercises the space available when a keyboard is open.
  // Native keyboard behavior still needs a separate device check.
  { width: 390, height: 420, minHistory: 100 },
];

function inside(rect, container, description) {
  assert.ok(rect && container, `${description}: both elements have a rendered box.`);
  assert.ok(rect.width > 0 && rect.height > 0, `${description}: the element has usable dimensions.`);
  assert.ok(rect.x >= container.x - 1 && rect.y >= container.y - 1 &&
    rect.x + rect.width <= container.x + container.width + 1 &&
    rect.y + rect.height <= container.y + container.height + 1,
  `${description}: ${JSON.stringify(rect)} must fit inside ${JSON.stringify(container)}.`);
}

async function checkPhoneLayout(page, size, state) {
  await page.setViewportSize({ width: size.width, height: size.height });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const label = `${size.width}×${size.height}, ${state}`;
  const viewport = { x: 0, y: 0, width: size.width, height: size.height };
  const history = await page.getByTestId('chat-history').boundingBox();
  const composer = await page.getByTestId('chat-composer').boundingBox();
  const input = await page.getByLabel('Message to Lumora', { exact: true }).boundingBox();
  const send = await page.getByRole('button', { name: 'Send message', exact: true }).boundingBox();
  inside(history, viewport, `${label}: conversation area`);
  inside(composer, viewport, `${label}: composer`);
  inside(input, composer, `${label}: text input`);
  inside(send, composer, `${label}: Send button`);
  assert.ok(history.height >= size.minHistory, `${label}: conversation area needs at least ${size.minHistory}px; got ${history.height}px.`);
  assert.ok(input.height >= 44 && send.height >= 44, `${label}: text input and Send button remain usable.`);
  assert.ok(history.y + history.height <= composer.y + 1, `${label}: composer must not cover conversation content.`);
  const overlapWidth = Math.max(0, Math.min(input.x + input.width, send.x + send.width) - Math.max(input.x, send.x));
  const overlapHeight = Math.max(0, Math.min(input.y + input.height, send.y + send.height) - Math.max(input.y, send.y));
  assert.ok(overlapWidth * overlapHeight <= 1, `${label}: Send button must not overlap the text input.`);
  const homeTab = await page.getByRole('tab', { name: 'Home', exact: true }).boundingBox();
  assert.ok(composer.y + composer.height <= homeTab.y + 1, `${label}: composer must remain above navigation.`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${label}: no horizontal page overflow.`);
  if (state === 'empty' || state === 'long draft') {
    const heading = await page.getByRole('heading', { name: 'What’s on your mind?', exact: true }).boundingBox();
    inside(heading, history, `${label}: opening prompt must not scroll out of view`);
  }
}

async function checkProviderDisclosure(page, provider) {
  await page.getByRole('button', { name: 'About AI chat', exact: true }).click();
  await page.getByText(`Your message and recent conversation history go to ${provider} for replies. Conversations are saved to your account; you can delete them.`, { exact: true }).waitFor();
  if (provider === 'Gemini (Google)') await page.getByText(/If this project uses Gemini’s free tier/).waitFor();
  else assert.equal(await page.getByText(/If this project uses Gemini’s free tier/).count(), 0);
  await page.getByRole('button', { name: 'Close chat panel', exact: true }).click();
  await page.getByRole('button', { name: 'Close chat panel', exact: true }).waitFor({ state: 'hidden' });
}

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
    await checkProviderDisclosure(page, 'Gemini (Google)');
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
    await checkProviderDisclosure(page, 'OpenAI');
    assert.equal(await input.inputValue(), 'Keep this draft when readiness recovers.');
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), true);
    statusMode = 'ready';
    statusProvider = 'gemini';
    await page.getByRole('button', { name: 'Check chat again', exact: true }).click();
    await checkProviderDisclosure(page, 'Gemini (Google)');
    await page.waitForFunction(() => !document.querySelector('[aria-label="Message to Lumora"]')?.readOnly);
    assert.equal(await page.getByRole('button', { name: 'Send message', exact: true }).isDisabled(), false);
    await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
    for (const size of phoneSizes) {
      await checkPhoneLayout(page, size, 'empty');
      if (process.env.LUMORA_SCREENSHOT_PATH && (size.height === 600 || size.width === 320)) {
        const screenshot = path.parse(process.env.LUMORA_SCREENSHOT_PATH);
        await page.screenshot({ path: path.join(screenshot.dir, `${screenshot.name}-empty-${size.width}x${size.height}${screenshot.ext}`) });
      }
    }
    const longDraft = 'A multiline draft should leave space to read the conversation.\n'.repeat(45);
    await input.fill(longDraft);
    for (const size of phoneSizes) {
      await checkPhoneLayout(page, size, 'long draft');
      inside(await page.getByRole('button', { name: 'Clear draft', exact: true }).boundingBox(),
        await page.getByTestId('chat-composer').boundingBox(), `${size.width}×${size.height}: clear action stays visible`);
      assert.equal(await input.inputValue(), longDraft, 'Resizing the viewport preserves the complete draft.');
    }
    await page.getByRole('button', { name: 'Clear draft', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 600 });
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
    await checkPhoneLayout(page, phoneSizes[1], 'saved conversation');
    await page.waitForFunction(text => {
      const replies = [...document.querySelectorAll('div')].filter(el => el.childElementCount === 0 && el.textContent === text);
      const lastReply = replies.at(-1)?.getBoundingClientRect();
      const history = document.querySelector('[data-testid="chat-history"]')?.getBoundingClientRect();
      return lastReply && history && lastReply.bottom <= history.bottom + 1 && lastReply.bottom > history.top + 20;
    }, fixture);
    await page.getByRole('button', { name: 'New conversation', exact: true }).click();
    assert.equal(await page.getByText(fixture, { exact: true }).count(), 0);
    assert.equal(await input.evaluate(element => element === document.activeElement), true);
    await checkPhoneLayout(page, phoneSizes[1], 'empty');
    await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
    await page.getByRole('button', { name: 'Open conversation: Test a recoverable provider failure.', exact: true }).click();
    await page.getByRole('button', { name: 'Close chat panel', exact: true }).waitFor({ state: 'hidden' });
    await page.getByText('Recover a response lost after saving.', { exact: true }).waitFor();
    assert.equal(await page.getByText(fixture, { exact: true }).count(), 2);
    if (process.env.LUMORA_SCREENSHOT_PATH) await page.screenshot({ path: process.env.LUMORA_SCREENSHOT_PATH });
    await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
    await page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Cancel deletion', exact: true }).click();
    assert.equal(await page.getByText(fixture, { exact: true }).count(), 2);
    await page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
    await page.getByRole('button', { name: 'Delete permanently', exact: true }).click();
    await page.getByRole('button', { name: 'Close chat panel', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('heading', { name: 'What’s on your mind?', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Conversation history', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: /^Open conversation:/ }).count(), 0);
    await page.getByRole('button', { name: 'Close chat panel', exact: true }).click();
    await page.getByRole('button', { name: 'Close chat panel', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
    console.log('PASS: real chat UI and database with test-only provider; phone layouts at 390×844, 390×600, 320×568, and 390×420; visible empty prompt and bounded long drafts; latest reply scrolling; provider disclosure, unavailable/readiness recovery, editable drafts, new-chat focus, retry, lost-response deduplication, history, deletion/cancel, and no runtime errors. No live AI calls made.');
  } finally {
    await browser?.close();
    const stopped = once(child, 'exit'); child.kill('SIGTERM');
    if (child.exitCode === null) await stopped;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

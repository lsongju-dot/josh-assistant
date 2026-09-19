const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/송주/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async () => {
  const server = await chromium.launchServer({ headless: true });
  const browser = await chromium.connect(server.wsEndpoint());
  try {
    const context = await browser.newContext();
    await context.route('https://**/*', r => r.abort());
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let paidCalls = 0;
    page.on('request', r => { if (/functions\/v1|openai.com/.test(r.url())) paidCalls++; });
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    await page.locator('[data-brief-example="fashion"]').click();
    assert.equal(await page.locator('#quickQuoteResult').isHidden(), true);
    assert.match(await page.locator('#briefPrice').textContent(), /180,000/);
    await page.locator('#briefPhotos').selectOption('research');
    assert.match(await page.locator('#briefPrice').textContent(), /210,000/);
    await page.locator('#briefMinutes').fill('');
    assert.equal(await page.locator('#saveBriefButton').isDisabled(), true);
    assert.equal(await page.locator('#briefReply').inputValue(), '');
    await page.locator('#briefMinutes').fill('7');
    await page.locator('#briefReply').fill('고객에게 보낼 수정한 답장');
    await page.locator('#saveBriefButton').click();
    await page.reload();
    assert.equal(await page.locator('#briefMinutes').inputValue(), '7');
    await page.locator('#briefHistoryButton').click();
    await page.locator('#briefHistory button').first().click();
    assert.equal(await page.locator('#briefReply').inputValue(), '고객에게 보낼 수정한 답장');
    await page.locator('[data-brief-example="documentary"]').click();
    assert.match(await page.locator('#briefPrice').textContent(), /400,000/);
    await page.locator('#briefDaily').fill('4');
    assert.match(await page.locator('#briefDays').textContent(), /4시간/);
    await page.locator('#quickQuoteText').fill('https://youtu.be/OwwSfFs7E-0');
    await page.locator('#consultQuoteButton').click();
    assert.equal(await page.locator('#briefOutput').isHidden(), true);
    await page.locator('#quickQuoteText').fill('1캠 최종본 5분 원본 10분 사진 전부 제공 <img src=x onerror="alert(1)">');
    await page.locator('#consultQuoteButton').click();
    assert.equal(await page.locator('#briefRevisions').inputValue(), '1');
    assert.equal(await page.locator('#briefPhotos').inputValue(), 'provided');
    assert.equal(await page.locator('#quickQuotePanel img').count(), 0);
    await page.locator('#copyBriefReplyButton').click();
    await page.waitForFunction(() => document.getElementById('briefActionStatus').textContent.length > 0, null, { timeout: 5000 });
    assert.ok(await page.locator('#briefActionStatus').textContent());
    fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true });
    for (const width of [360, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('[data-brief-example="documentary"]').click();
      await page.locator('#briefOutput').evaluate(el => el.scrollIntoView());
      await page.waitForFunction(() => {
        const r = document.getElementById('briefOutput').getBoundingClientRect();
        return r.top >= 0 && r.top < 160;
      });
      const layout = await page.evaluate(() => {
        const controls = [...document.querySelectorAll('#briefOutput input, #briefOutput select, #briefOutput button, #briefReply')];
        return { width: document.documentElement.scrollWidth, viewport: innerWidth,
          overflow: controls.filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 1); }).map(el => el.id),
          small: controls.filter(el => el.getBoundingClientRect().height < 44).map(el => el.id) };
      });
      assert.ok(layout.width <= width, JSON.stringify(layout));
      assert.deepEqual(layout.overflow, []);
      if (width < 600) assert.deepEqual(layout.small, []);
      await page.locator('#briefOutput').screenshot({ path: path.join(__dirname, 'artifacts', `brief-${width}.png`), animations: 'disabled' });
      console.log(`PASS ${width}px free consultation`);
    }
    assert.equal(paidCalls, 0);
    const snapshot = await page.evaluate(() => captureUndoSnapshot());
    const historyCount = await page.evaluate(() => briefStorageRead(BRIEF_HISTORY_KEY, []).length);
    assert.ok(historyCount > 0);
    await page.evaluate(() => performScopedReset('quote'));
    assert.equal(await page.locator('#briefOutput').isHidden(), true);
    assert.equal(await page.evaluate(() => briefStorageRead(BRIEF_HISTORY_KEY, []).length), historyCount);
    await page.evaluate(() => performScopedReset('all'));
    assert.equal(await page.evaluate(() => briefStorageRead(BRIEF_HISTORY_KEY, []).length), 0);
    await page.evaluate(s => restoreUndoSnapshot(s), snapshot);
    assert.equal(await page.locator('#briefOutput').isVisible(), true);
    assert.equal(await page.evaluate(() => briefStorageRead(BRIEF_HISTORY_KEY, []).length), historyCount);
    const backup = await page.evaluate(() => ({ controls: currentControlState(), briefDraft: briefStorageRead(BRIEF_DRAFT_KEY, null), briefHistory: briefStorageRead(BRIEF_HISTORY_KEY, []) }));
    await page.evaluate(() => performScopedReset('all'));
    await page.evaluate(b => applyBackupPayload(b), backup);
    assert.equal(await page.locator('#briefOutput').isVisible(), true);
    assert.equal(await page.evaluate(() => briefStorageRead(BRIEF_HISTORY_KEY, []).length), historyCount);
    assert.deepEqual(errors, []);
    console.log('PASS live edits, validation, history, copy, fresh inquiries, backup, reset, undo, offline use and zero paid calls');
  } finally {
    // Keep cleanup scoped to the browser launched by this test.
    server.process().kill('SIGKILL');
  }
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });

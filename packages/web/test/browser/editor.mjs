import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium, webkit, devices } from 'playwright';

const server = await createServer({
  root: fileURLToPath(new URL('../..', import.meta.url)),
  server: { host: '127.0.0.1', port: 5187, strictPort: true },
});
await server.listen();
const errors = [];

async function assertVisible(page, selector) {
  const result = await page.locator(selector).evaluate(element => {
    const box = element.getBoundingClientRect();
    const visual = window.visualViewport;
    const top = Math.max(visual?.offsetTop ?? 0, document.querySelector('.topbar').getBoundingClientRect().bottom);
    const bottom = Math.min((visual?.offsetTop ?? 0) + (visual?.height ?? innerHeight), document.querySelector('.mode-bar').getBoundingClientRect().top);
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, limitTop: top, limitBottom: bottom,
      limitLeft: visual?.offsetLeft ?? 0, limitRight: (visual?.offsetLeft ?? 0) + (visual?.width ?? innerWidth) };
  });
  assert.ok(result.top >= result.limitTop - 1 && result.bottom <= result.limitBottom + 1, `${selector}: ${JSON.stringify(result)}`);
  assert.ok(result.left >= result.limitLeft - 1 && result.right <= result.limitRight + 1, `${selector}: ${JSON.stringify(result)}`);
}

try {
  for (const [name, engine, options] of [
    ['chromium-desktop', chromium, { viewport: { width: 1280, height: 900 } }],
    ['webkit-iphone', webkit, devices['iPhone 13']],
    ['webkit-ipad', webkit, devices['iPad (gen 7)']],
  ]) {
    const executablePath = engine === webkit ? process.env['PLAYWRIGHT_WEBKIT_EXECUTABLE'] : undefined;
    const browser = await engine.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
    try {
      const context = await browser.newContext(options);
      await context.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({ status: 404, json: { error: 'not_configured' } }));
      const page = await context.newPage();
      page.setDefaultTimeout(7000);
      page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
      await page.goto('http://127.0.0.1:5187/test/browser/editor.html');
      await page.locator('.ProseMirror > p').nth(2).click({ position: { x: 70, y: 18 } });
      // Put the selected block at the bottom, where the old menu overflowed.
      await page.locator('.main').evaluate(pane => {
        const block = document.querySelectorAll('.ProseMirror > p')[2];
        pane.scrollTop += block.getBoundingClientRect().top - (innerHeight - 180);
      });
      await page.waitForTimeout(150);
      await page.locator('.block-handle').click();
      await page.waitForTimeout(150);
      await assertVisible(page, '.block-menu');
      const artifacts = process.env['SONE_BROWSER_ARTIFACTS'];
      if (artifacts) {
        await mkdir(artifacts, { recursive: true });
        await page.screenshot({ path: path.join(artifacts, `${name}-block-menu.png`), scale: 'css' });
      }
      // The bottom of the content must be reachable inside the visible panel.
      await page.locator('.block-menu').evaluate(e => { e.scrollTop = e.scrollHeight; });
      await assertVisible(page, '.block-menu');
      await page.keyboard.press('Escape');
      if (options.hasTouch) {
        for (const button of await page.locator('.block-gutter button').all()) {
          const box = await button.boundingBox();
          assert.ok(box.width >= 44 && box.height >= 44, 'touch targets must be at least 44px');
        }
      }
      // Native DOM selection drives ProseMirror's selectionchange listener.
      await page.locator('.ProseMirror').evaluate(editor => {
        editor.focus();
        getSelection().selectAllChildren(editor);
      });
      await page.waitForTimeout(200);
      await assertVisible(page, '.selection-toolbar');
      await page.keyboard.press('ArrowRight');
      await page.locator('.ProseMirror > p').nth(2).click({ position: { x: 70, y: 18 } });
      await page.locator('.main').evaluate(pane => {
        const block = document.querySelectorAll('.ProseMirror > p')[2];
        pane.scrollTop += block.getBoundingClientRect().top - 20;
      });
      await page.waitForTimeout(150);
      await assertVisible(page, '.block-gutter');
      // Resize while a popup is open, like rotation or a smaller usable area.
      await page.locator('.block-insert').click();
      await page.waitForTimeout(150);
      await assertVisible(page, '.slash-menu');
      await page.setViewportSize({ width: 390, height: 340 });
      await page.waitForTimeout(200);
      await assertVisible(page, '.slash-menu');
      await page.keyboard.press('Escape');
      console.log(`${name}: menu, selection, handle, touch targets and resize passed`);
    } finally {
      await browser.close();
    }
  }
  assert.deepEqual(errors, [], 'no editor runtime exceptions');
} catch (error) {
  if (errors.length) console.error(errors);
  throw error;
} finally {
  await server.close();
}

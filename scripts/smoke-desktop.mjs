import { _electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

if (!process.env.DISPLAY && process.platform === 'linux') throw new Error('Set DISPLAY to an X11 desktop, or run with xvfb-run -a npm run test:desktop.');
const data = await mkdtemp(join(tmpdir(), 'pasteboard-desktop-'));
const requests = [];
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk;
  requests.push({ url: req.url, method: req.method, auth: req.headers.authorization, body: JSON.parse(raw) });
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: '你好，创作的世界。' }, finish_reason: 'stop' }] }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/v1`;
let desktop;
const output = [];
async function launch() {
  const instance = await _electron.launch({
    args: [resolve('.'), '--no-sandbox', '--disable-dev-shm-usage'],
    env: { ...process.env, PASTEBOARD_USER_DATA: data, PASTEBOARD_DISABLE_GPU: '1',
      NO_PROXY: `${process.env.NO_PROXY || ''},localhost,127.0.0.1`, no_proxy: `${process.env.no_proxy || ''},localhost,127.0.0.1` },
    timeout: 30_000,
  });
  instance.process().stderr?.on('data', chunk => output.push(chunk.toString()));
  const page = await instance.firstWindow();
  await page.waitForFunction(() => window.pasteboard?.isDesktop === true);
  await page.getByRole('heading', { name: '所有记录' }).waitFor();
  return instance;
}
async function state() { return (await desktop.firstWindow()).evaluate(() => window.pasteboard.getSnapshot()); }
async function until(predicate, message) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const current = await state(); if (predicate(current)) return current;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${message}`);
}
async function writeText(text) { await desktop.evaluate(async ({ clipboard }, value) => { await clipboard.writeText(value); }, text); }
try {
  desktop = await launch();
  let page = await desktop.firstWindow();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await desktop.evaluate(({ clipboard }) => clipboard.clear());
  await page.evaluate(() => window.pasteboard.clear(true));
  for (const [text, kind] of [
    ['Hello, creative world.', 'text'], ['https://example.com/clipboard', 'url'],
    ['C:\\Users\\Alice\\Documents\\notes.md', 'path'], ['const idea = "make it useful";', 'code'],
  ]) {
    await writeText(text);
    const current = await until(s => s.entries.some(entry => entry.content === text), `capture ${kind}`);
    assert.equal(current.entries.find(entry => entry.content === text).kind, kind);
  }
  console.log('PASS actual system clipboard: text, URL, file path, code, automatic capture');

  await desktop.evaluate(async ({ clipboard, ClipboardItem, nativeImage, app }) => {
    const image = nativeImage.createFromPath(`${app.getAppPath()}/assets/icon.png`).toPNG();
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(image)], { type: 'image/png' }) })]);
  });
  const withImage = await until(s => s.entries.some(entry => entry.kind === 'image'), 'capture original image');
  const image = withImage.entries.find(entry => entry.kind === 'image');
  assert.equal(image.image.width, 256); assert.equal(image.image.height, 256);
  await page.evaluate(id => window.pasteboard.copy(id), image.id);
  assert.equal(await desktop.evaluate(async ({ clipboard }) => clipboard.has('image/png')), true);
  const imageData = await page.evaluate(id => window.pasteboard.getImage(id), image.id);
  assert.match(imageData, /^data:image\/png;base64,/);
  console.log('PASS original-image persistence and native image copy');

  // Exercise both former limits through the real clipboard, without resizing originals.
  await page.evaluate(async () => {
    const s = await window.pasteboard.getSnapshot();
    await window.pasteboard.saveSettings({ ...s.settings, captureEnabled: false });
  });
  const largeImages = [];
  for (const dimensions of [{ width: 2200, height: 2200, noise: true }, { width: 8001, height: 5000, noise: false }]) {
    const original = await desktop.evaluate(async ({ clipboard, ClipboardItem, nativeImage }, dimensions) => {
      const bitmap = Buffer.alloc(dimensions.width * dimensions.height * 4, 255);
      if (dimensions.noise) {
        let seed = 0x12345678;
        for (let offset = 0; offset < bitmap.length; offset += 4) {
          seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
          bitmap.writeUInt32LE((seed | 0xff000000) >>> 0, offset);
        }
      }
      const image = nativeImage.createFromBitmap(bitmap, { width: dimensions.width, height: dimensions.height });
      const png = image.toPNG();
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
      return { ...dimensions, bytes: png.length };
    }, dimensions);
    if (dimensions.noise) assert(original.bytes > 12 * 1024 * 1024, 'Fixture must exceed the former 12 MB limit');
    else assert(original.width * original.height > 40_000_000, 'Fixture must exceed the former pixel limit');
    const result = await page.evaluate(() => window.pasteboard.capture());
    assert.equal(result.captured, true);
    const entry = (await state()).entries.find(entry => entry.image?.width === dimensions.width && entry.image?.height === dimensions.height);
    assert(entry, 'Original dimensions are retained');
    if (dimensions.noise) assert(entry.image.bytes > 12 * 1024 * 1024);
    largeImages.push(entry.id);
    const preview = await desktop.evaluate(({ nativeImage }, thumbnail) => nativeImage.createFromDataURL(thumbnail).getSize(), entry.image.thumbnail);
    assert(preview.width <= 400 && preview.height <= 225, 'Only the thumbnail is resized');
    if (dimensions.noise) {
      await page.evaluate(id => window.pasteboard.copy(id), entry.id);
      assert(await desktop.evaluate(async ({ clipboard }) => {
        const items = await clipboard.read();
        const png = await items.find(item => item.types.includes('image/png')).getType('image/png');
        return png.size > 12 * 1024 * 1024;
      }));
    }
  }
  console.log('PASS native capture/copy above 12 MB and capture above 40 million pixels; original sizes retained');

  const count = (await state()).entries.length;
  await desktop.evaluate(async ({ clipboard, ClipboardItem }) => {
    await clipboard.write([new ClipboardItem({ 'text/plain': 'sensitive-not-for-history',
      'electron application/osclipboard;format="org.nspasteboard.ConcealedType"': new Blob(['1']) })]);
  });
  await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await state()).entries.length, count);
  assert.equal((await state()).entries.some(entry => entry.content === 'sensitive-not-for-history'), false);
  console.log('PASS sensitive clipboard marker is excluded');

  await page.evaluate(async () => { const s = await window.pasteboard.getSnapshot(); await window.pasteboard.saveSettings({ ...s.settings, captureEnabled: false }); });
  await writeText('paused entry'); await new Promise(resolve => setTimeout(resolve, 1100));
  assert.equal((await state()).entries.some(entry => entry.content === 'paused entry'), false);
  await page.evaluate(async () => { const s = await window.pasteboard.getSnapshot(); await window.pasteboard.saveSettings({ ...s.settings, captureEnabled: true, shortcut: 'CommandOrControl+Alt+P' }); });
  await until(s => s.entries.some(entry => entry.content === 'paused entry'), 'resume capture');
  assert.equal((await state()).shortcutRegistered, true);
  assert.equal(await desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Alt+P')), true);
  assert.equal(await desktop.evaluate(({ globalShortcut }) => globalShortcut.isRegistered('CommandOrControl+Shift+V')), false);
  console.log('PASS pause, resume, and real global shortcut re-registration');

  let current = await state(); const text = current.entries.find(entry => entry.content === 'Hello, creative world.');
  await page.evaluate(async ({ id, endpoint }) => {
    await window.pasteboard.createCategory('翻译素材');
    const s = await window.pasteboard.getSnapshot();
    await window.pasteboard.assignCategory(id, s.categories[0].id);
    await window.pasteboard.pin(id);
    await window.pasteboard.saveSettings({ ...s.settings, apiEndpoint: endpoint, apiKey: 'test-only-not-a-real-key' });
  }, { id: text.id, endpoint });
  await page.getByRole('button', { name: '查看：Hello, creative world.' }).click();
  await page.getByRole('button', { name: '翻译这段内容' }).click();
  await page.getByTestId('translated-content').getByText('你好，创作的世界。').waitFor();
  assert.equal(requests.length, 1); assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].method, 'POST'); assert.equal(requests[0].auth, 'Bearer test-only-not-a-real-key');
  assert.equal(requests[0].body.messages[1].content, 'Hello, creative world.');
  assert.equal(requests[0].body.model, 'gpt-4o-mini');
  assert.equal(JSON.stringify(requests[0].body).includes('C:\\Users'), false);
  await page.getByRole('button', { name: '复制译文', exact: true }).click();
  assert.equal(await desktop.evaluate(async ({ clipboard }) => clipboard.readText()), '你好，创作的世界。');
  const persisted = await readFile(join(data, 'history.json'), 'utf8');
  assert.equal(persisted.includes('test-only-not-a-real-key'), false);
  assert.equal(JSON.stringify(await state()).includes('test-only-not-a-real-key'), false);
  await assert.rejects(() => page.evaluate(() => window.pasteboard.getImage('../history.json')));
  console.log('PASS complete translation UI → IPC → local API → persisted result → copy flow; key never exposed in history/snapshot');
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/desktop.png' });
  await page.evaluate(() => window.pasteboard.windowAction('hide'));
  assert.equal(await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await desktop.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show());
  await desktop.close(); desktop = undefined;

  desktop = await launch(); page = await desktop.firstWindow(); current = await state();
  const restored = current.entries.find(entry => entry.id === text.id);
  assert.equal(restored.pinned, true); assert.equal(restored.categoryId, current.categories[0].id);
  assert.equal(restored.translation.text, '你好，创作的世界。');
  assert.equal(current.settings.shortcut, 'CommandOrControl+Alt+P');
  assert.equal(current.entries.find(entry => entry.id === image.id).image.width, 256);
  for (const id of largeImages) assert(current.entries.some(entry => entry.id === id), 'Large original images survive restart');
  if (current.keyStorage === 'session') assert.equal(current.hasApiKey, false);
  await page.evaluate(() => window.pasteboard.clear(false));
  assert.equal((await state()).entries.length, 1);
  assert.deepEqual(await readdir(join(data, 'images')), []);
  await page.evaluate(() => window.pasteboard.clear(true)); assert.equal((await state()).entries.length, 0);
  console.log('PASS application restart restores history, originals, categories, pins, settings and translations; clear respects pins and removes image files');
  console.log('All desktop smoke checks passed.');
} catch (error) {
  console.error(output.join('').slice(-6000));
  throw error;
} finally {
  if (desktop) await desktop.close().catch(() => undefined);
  await new Promise(resolve => server.close(resolve));
  await rm(data, { recursive: true, force: true });
}

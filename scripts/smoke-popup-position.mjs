import { _electron } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const directory = await mkdtemp(join(tmpdir(), 'pasteboard-position-'));
let desktop;
try {
  const entry = join(directory, 'position.cjs');
  await build({ entryPoints: ['tests/fixtures/popup-session-main.ts'], outfile: entry, bundle: true, platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
  desktop = await _electron.launch({ args: [entry, '--no-sandbox', '--disable-dev-shm-usage'], timeout: 30_000 });
  const page = await desktop.firstWindow();
  await page.waitForFunction(() => document.title === 'Clipboard position regression fixture');
  const initial = await desktop.evaluate(() => globalThis.popupRegression.state());
  assert.equal(initial.visible, true);
  const target = { window: '812', control: '813', process: 1200, elementKey: '42-1-2', editable: true, caretLocated: true, x: 100, y: 200, width: 1, height: 20 };
  // Exercise the production session with a real native window and changing pointer/caret data.
  for (let i = 0; i < 12; i++) {
    await page.mouse.move(15 + i * 20, 25 + i * 30);
    await desktop.evaluate((_, sample) => globalThis.popupRegression.sample(sample), { ...target, x: 100 + i * 37, y: i % 2 ? 980 : 0, caretLocated: i % 3 === 0, editable: i % 2 === 0, height: i % 3 === 0 ? 20 : 0 });
  }
  await page.waitForTimeout(1100);
  const after = await desktop.evaluate(() => globalThis.popupRegression.state());
  assert.deepEqual(after, initial, 'A visible popup must not move or hide when caret sources or pointer position change');
  await desktop.evaluate(() => globalThis.popupRegression.drag());
  const dragged = await desktop.evaluate(() => globalThis.popupRegression.state());
  await desktop.evaluate((_, sample) => globalThis.popupRegression.sample(sample), { ...target, x: 900, y: 900 });
  assert.deepEqual(await desktop.evaluate(() => globalThis.popupRegression.state()), dragged, 'Background checks must not undo manual dragging');
  await desktop.evaluate(() => globalThis.popupRegression.reopen());
  const reopened = await desktop.evaluate(() => globalThis.popupRegression.state());
  assert.notDeepEqual(reopened.bounds, dragged.bounds);
  assert.equal(reopened.moves, 2, 'Only an explicit re-open may position the popup again');
  await desktop.evaluate((_, sample) => globalThis.popupRegression.sample(sample), { ...target, control: '900' });
  assert.equal((await desktop.evaluate(() => globalThis.popupRegression.state())).visible, false);
  console.log('PASS native window stays fixed during caret-source fluctuations and pointer movement, preserves manual dragging, repositions on re-open, and hides on target change.');
} finally {
  await desktop?.close().catch(() => undefined);
  await rm(directory, { recursive: true, force: true });
}

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { HistoryStore } from '../electron/store';

let directory: string;
beforeEach(() => { directory = mkdtempSync(join(tmpdir(), 'pasteboard-store-test-')); });
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe('persistent history', () => {
  it('keeps more than 1200 entries and pins in unlimited mode across restart', () => {
    const store = new HistoryStore(directory); store.addText('seed');
    const file = join(directory, 'history.json');
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    expect(raw.settings.historyLimit).toBe(0);
    expect(raw.settings.captureImages).toBe(false);
    raw.entries = Array.from({ length: 1501 }, (_, i) => ({ ...raw.entries[0], id: randomUUID(), content: `History ${i}`, hash: `hash-${i}`, pinned: i < 110 }));
    writeFileSync(file, JSON.stringify(raw));
    const reopened = new HistoryStore(directory);
    expect(reopened.entries).toHaveLength(1501);
    reopened.addText('newest');
    expect(new HistoryStore(directory).entries).toHaveLength(1502);
    expect(reopened.entries.some(entry => entry.content === 'History 1500')).toBe(true);
    reopened.updateSettings({ ...reopened.settings, historyLimit: 50 });
    expect(reopened.entries.filter(entry => !entry.pinned)).toHaveLength(50);
    expect(reopened.entries.filter(entry => entry.pinned)).toHaveLength(110);
  });
  it.each([[300, 0], [500, 500]])('migrates old capacity %s to %s without losing history', (oldLimit, expected) => {
    const store = new HistoryStore(directory); store.addText('previous version');
    const file = join(directory, 'history.json'); const raw = JSON.parse(readFileSync(file, 'utf8'));
    delete raw.settings.captureImages; raw.settings.historyLimit = oldLimit;
    writeFileSync(file, JSON.stringify(raw));
    const restored = new HistoryStore(directory);
    expect(restored.entries[0].content).toBe('previous version');
    expect(restored.settings.historyLimit).toBe(expected);
    expect(restored.settings.captureImages).toBe(false);
  });

  it('restores text, pinned state, categories, and translation after reopening', () => {
    const store = new HistoryStore(directory);
    store.addText('A quiet morning.'); const id = store.entries[0].id;
    store.togglePin(id); store.createCategory('灵感');
    store.assignCategory(id, store.categories[0].id);
    store.setTranslation(id, { text: '宁静的清晨。', language: 'zh-CN', createdAt: Date.now() });
    store.recordCopy(id);
    const reopened = new HistoryStore(directory);
    expect(reopened.entries).toEqual(store.entries);
    expect(reopened.categories).toEqual(store.categories);
    expect(reopened.entries[0].copyCount).toBe(1);
    expect(reopened.entries[0].pinned).toBe(true);
  });
  it('deduplicates while preserving identity, pins, and categories', () => {
    const store = new HistoryStore(directory);
    store.addText('keep me'); const id = store.entries[0].id;
    store.togglePin(id); store.createCategory('Keep'); store.assignCategory(id, store.categories[0].id);
    store.addText('another'); store.addText('keep me');
    expect(store.entries).toHaveLength(2); expect(store.entries[0].id).toBe(id);
    expect(store.entries[0].pinned).toBe(true); expect(store.entries[0].categoryId).toBe(store.categories[0].id);
  });
  it('enforces retention without evicting pinned records', () => {
    const store = new HistoryStore(directory);
    store.updateSettings({ ...store.settings, historyLimit: 50 });
    store.addText('pinned'); store.togglePin(store.entries[0].id);
    for (let i = 0; i < 60; i++) store.addText(`text ${i}`);
    expect(store.entries).toHaveLength(51);
    expect(store.entries.some(entry => entry.content === 'text 0')).toBe(false);
    expect(store.entries.some(entry => entry.content === 'pinned')).toBe(true);
    store.clear(false); expect(store.entries).toHaveLength(1);
    store.clear(true); expect(store.entries).toHaveLength(0);
  });
  it('persists original images and deletes files with their entries', () => {
    const store = new HistoryStore(directory); const bytes = Buffer.from('image fixture');
    store.addImage(bytes, 'data:image/png;base64,aW1hZ2U=', 10, 10);
    const id = store.entries[0].id;
    expect(new HistoryStore(directory).readImage(id)).toEqual(bytes);
    store.addImage(bytes, 'data:image/png;base64,aW1hZ2U=', 10, 10); expect(store.entries).toHaveLength(1);
    store.remove(id); expect(readdirSync(join(directory, 'images'))).toEqual([]);
    expect(() => store.readImage('../history.json')).toThrow('不存在');
  });
  it('detaches a deleted category without deleting content', () => {
    const store = new HistoryStore(directory); store.addText('hello'); store.createCategory('Work');
    const category = store.categories[0]; store.assignCategory(store.entries[0].id, category.id); store.deleteCategory(category.id);
    expect(store.entries[0].categoryId).toBeNull(); expect(store.entries[0].content).toBe('hello');
    expect(() => store.assignCategory(store.entries[0].id, category.id)).toThrow('不存在');
  });
  it('preserves corrupt history for recovery', () => {
    writeFileSync(join(directory, 'history.json'), '{broken data');
    const store = new HistoryStore(directory);
    expect(store.warning).toContain('备份'); expect(store.entries).toEqual([]);
    const backup = readdirSync(directory).find(file => file.startsWith('history.json.recovery-'))!;
    expect(readFileSync(join(directory, backup), 'utf8')).toBe('{broken data');
    store.addText('fresh start'); expect(new HistoryStore(directory).entries[0].content).toBe('fresh start');
  });
  it('preserves image files larger than 12 MB without a size cap across restarts', () => {
    const store = new HistoryStore(directory);
    const bytes = Buffer.alloc(13 * 1024 * 1024, 0x61);
    store.addImage(bytes, 'data:image/png;base64,aW1hZ2U=', 8001, 5000);
    const id = store.entries[0].id;
    const reopened = new HistoryStore(directory);
    expect(reopened.entries[0].image).toMatchObject({ width: 8001, height: 5000, bytes: bytes.length });
    expect(reopened.readImage(id).equals(bytes)).toBe(true);
    reopened.remove(id);
    expect(readdirSync(join(directory, 'images'))).toEqual([]);
  });
  it('rejects oversized text and duplicate categories while allowing more than 100 pins', () => {
    const store = new HistoryStore(directory);
    expect(store.addText('   ')).toBe(false);
    expect(() => store.addText('x'.repeat(100_001))).toThrow('100,000');
    store.createCategory('Work'); expect(() => store.createCategory(' Work ')).toThrow('已存在');
    for (let i = 0; i < 100; i++) { store.addText(`pinned ${i}`); store.togglePin(store.entries[0].id); }
    store.addText('one more'); store.togglePin(store.entries[0].id); expect(store.entries.filter(entry => entry.pinned)).toHaveLength(101);
  });
});

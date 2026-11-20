import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { classify } from '../shared/classify';
import { DEFAULT_SETTINGS, type AiResult, type Category, type ClipboardEntry, type Settings, type Translation } from '../shared/types';
import { settingsSchema } from './schema';

const entrySchema = z.object({
  id: z.string().uuid(), kind: z.enum(['text', 'image', 'url', 'path', 'code']),
  content: z.string().max(100_000), createdAt: z.number(), updatedAt: z.number(), pinned: z.boolean(),
  categoryId: z.string().uuid().nullable(), copyCount: z.number().int().nonnegative(),
  image: z.object({ thumbnail: z.string(), width: z.number().positive(), height: z.number().positive(), bytes: z.number().positive() }).optional(),
  translation: z.object({ text: z.string().max(100_000), language: z.enum(['zh-CN', 'en', 'ja', 'ko', 'de', 'fr']), createdAt: z.number(), provider: z.enum(['local', 'ai']).optional() }).optional(),
  aiResult: z.enum(['answer', 'translate']).optional(),
  hash: z.string(),
});
const dataSchema = z.object({
  version: z.literal(1), entries: z.array(entrySchema),
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string().min(1).max(24), color: z.string() })).max(30),
  settings: settingsSchema.omit({ apiKey: true, clearApiKey: true }), encryptedKey: z.string().max(20_000).optional(),
});
type StoredEntry = ClipboardEntry & { hash: string };
type Data = { version: 1; entries: StoredEntry[]; categories: Category[]; settings: Settings; encryptedKey?: string };

export class HistoryStore {
  private file: string;
  private imageDir: string;
  private data: Data;
  warning: string | null = null;
  constructor(readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.imageDir = join(directory, 'images');
    mkdirSync(this.imageDir, { recursive: true, mode: 0o700 });
    this.file = join(directory, 'history.json');
    this.data = { version: 1, entries: [], categories: [], settings: { ...DEFAULT_SETTINGS } };
    if (existsSync(this.file)) {
      try {
        const raw = JSON.parse(readFileSync(this.file, 'utf8'));
        // Upgrade the old default while preserving explicitly chosen capacities.
        if (raw.settings && raw.settings.captureImages === undefined && raw.settings.historyLimit === 300) raw.settings.historyLimit = 0;
        this.data = dataSchema.parse(raw);
      }
      catch {
        // Preserve unreadable data instead of overwriting it with an empty history.
        const backup = `${this.file}.recovery-${Date.now()}`;
        renameSync(this.file, backup);
        this.warning = '历史文件无法读取，已保留恢复备份。当前使用新的历史记录。';
      }
    }
  }
  get settings() { return { ...this.data.settings }; }
  get encryptedKey() { return this.data.encryptedKey; }
  get categories() { return this.data.categories.map(category => ({ ...category })); }
  get entries(): ClipboardEntry[] {
    return this.data.entries.map(({ hash: _, ...entry }) => ({ ...entry }));
  }
  get(id: string) { return this.data.entries.find(entry => entry.id === id); }
  private save(data = this.data) {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(data), { mode: 0o600 });
    renameSync(temp, this.file);
  }
  updateSettings(settings: Settings, keyUpdate?: { encryptedKey: string | undefined }) {
    const next = { ...this.data, settings: { ...settings }, ...keyUpdate };
    const removed = this.trimEntries(next);
    this.save(next);
    this.data = next;
    for (const entry of removed) {
      try { this.deleteImage(entry); }
      catch { this.warning = '部分超出容量的图片文件未能清理。'; }
    }
  }
  addText(content: string) {
    if (!content.trim()) return false;
    if (content.length > 100_000) throw new Error('这段文字超过 100,000 字，未保存。');
    return this.add({ content, kind: classify(content), hash: createHash('sha256').update(`text:${content}`).digest('hex') });
  }
  addAiResult(content: string, aiResult: AiResult) {
    const kind = classify(content);
    return this.add({ content, kind: kind === 'path' ? 'text' : kind, aiResult,
      hash: createHash('sha256').update(`ai:${aiResult}:${content}`).digest('hex') });
  }
  addImage(png: Buffer, thumbnail: string, width: number, height: number) {
    return this.add({ content: '', kind: 'image', hash: createHash('sha256').update(png).digest('hex'),
      image: { thumbnail, width, height, bytes: png.length } }, png);
  }
  private add(input: Pick<StoredEntry, 'content' | 'kind' | 'hash' | 'image' | 'aiResult'>, png?: Buffer) {
    const existing = this.data.entries.find(entry => entry.hash === input.hash);
    const now = Date.now();
    const entry = existing ?? { ...input, id: randomUUID(), createdAt: now, updatedAt: now, pinned: false, categoryId: null, copyCount: 0 };
    if (existing) {
      entry.updatedAt = now;
      this.data.entries = this.data.entries.filter(item => item.id !== entry.id);
    } else if (png) {
      writeFileSync(join(this.imageDir, `${entry.id}.png`), png, { mode: 0o600 });
    }
    this.data.entries.unshift(entry);
    this.prune();
    this.save();
    return entry.id;
  }
  private deleteImage(entry: StoredEntry) {
    if (entry.kind === 'image') {
      const path = join(this.imageDir, `${entry.id}.png`);
      if (existsSync(path)) unlinkSync(path);
    }
  }
  private trimEntries(data: Data) {
    const removed: StoredEntry[] = [];
    if (data.settings.historyLimit === 0) return removed;
    let count = 0;
    data.entries = data.entries.filter(entry => {
      const keep = entry.pinned || ++count <= data.settings.historyLimit;
      if (!keep) removed.push(entry);
      return keep;
    });
    return removed;
  }
  private prune() {
    for (const entry of this.trimEntries(this.data)) this.deleteImage(entry);
  }
  togglePin(id: string) {
    const entry = this.require(id);
    entry.pinned = !entry.pinned; this.prune(); this.save();
  }
  recordCopy(id: string) { this.require(id).copyCount++; this.save(); }
  remove(id: string) { const entry = this.require(id); this.deleteImage(entry); this.data.entries = this.data.entries.filter(item => item.id !== id); this.save(); }
  clear(includePinned: boolean) {
    for (const entry of [...this.data.entries]) if (includePinned || !entry.pinned) { this.deleteImage(entry); }
    this.data.entries = includePinned ? [] : this.data.entries.filter(entry => entry.pinned); this.save();
  }
  require(id: string) { const entry = this.get(id); if (!entry) throw new Error('这条记录已不存在。'); return entry; }
  readImage(id: string) { if (this.require(id).kind !== 'image') throw new Error('这条记录不是图片。'); return readFileSync(join(this.imageDir, `${id}.png`)); }
  createCategory(name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed.length > 24) throw new Error('分类名称需要 1–24 个字符。');
    if (this.data.categories.length >= 30) throw new Error('最多创建 30 个分类。');
    if (this.data.categories.some(category => category.name === trimmed)) throw new Error('这个分类名称已存在。');
    const colors = ['#a48ad4', '#66a68b', '#d5a45e', '#769ac5', '#cf8e9b'];
    this.data.categories.push({ id: randomUUID(), name: trimmed, color: colors[this.data.categories.length % colors.length] }); this.save();
  }
  deleteCategory(id: string) {
    this.data.categories = this.data.categories.filter(category => category.id !== id);
    this.data.entries.forEach(entry => { if (entry.categoryId === id) entry.categoryId = null; }); this.save();
  }
  assignCategory(id: string, categoryId: string | null) {
    if (categoryId && !this.data.categories.some(category => category.id === categoryId)) throw new Error('分类不存在。');
    this.require(id).categoryId = categoryId; this.save();
  }
  setTranslation(id: string, translation: Translation) { this.require(id).translation = translation; this.save(); }
}

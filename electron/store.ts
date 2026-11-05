import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { classify } from '../shared/classify';
import { DEFAULT_SETTINGS, type Category, type ClipboardEntry, type Settings, type Translation } from '../shared/types';
import { settingsSchema } from './schema';

const entrySchema = z.object({
  id: z.string().uuid(), kind: z.enum(['text', 'image', 'url', 'path', 'code']),
  content: z.string().max(100_000), createdAt: z.number(), updatedAt: z.number(), pinned: z.boolean(),
  categoryId: z.string().uuid().nullable(), copyCount: z.number().int().nonnegative(),
  image: z.object({ thumbnail: z.string(), width: z.number().positive(), height: z.number().positive(), bytes: z.number().positive() }).optional(),
  translation: z.object({ text: z.string().max(100_000), language: z.enum(['zh-CN', 'en', 'ja', 'ko', 'de', 'fr']), createdAt: z.number() }).optional(),
  hash: z.string(),
});
const dataSchema = z.object({
  version: z.literal(1), entries: z.array(entrySchema).max(1200),
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
      try { this.data = dataSchema.parse(JSON.parse(readFileSync(this.file, 'utf8'))); }
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
  setEncryptedKey(value?: string) { this.data.encryptedKey = value; this.save(); }
  get categories() { return this.data.categories.map(category => ({ ...category })); }
  get entries(): ClipboardEntry[] {
    return this.data.entries.map(({ hash: _, ...entry }) => ({ ...entry }));
  }
  get(id: string) { return this.data.entries.find(entry => entry.id === id); }
  private save() {
    const temp = `${this.file}.tmp`;
    writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(temp, this.file);
  }
  updateSettings(settings: Settings) { this.data.settings = { ...settings }; this.prune(); this.save(); }
  addText(content: string) {
    if (!content.trim()) return false;
    if (content.length > 100_000) throw new Error('这段文字超过 100,000 字，未保存。');
    return this.add({ content, kind: classify(content), hash: createHash('sha256').update(`text:${content}`).digest('hex') });
  }
  addImage(png: Buffer, thumbnail: string, width: number, height: number) {
    return this.add({ content: '', kind: 'image', hash: createHash('sha256').update(png).digest('hex'),
      image: { thumbnail, width, height, bytes: png.length } }, png);
  }
  private add(input: Pick<StoredEntry, 'content' | 'kind' | 'hash' | 'image'>, png?: Buffer) {
    const existing = this.data.entries.find(entry => entry.hash === input.hash);
    if (existing) {
      existing.updatedAt = Date.now();
      this.data.entries = [existing, ...this.data.entries.filter(entry => entry.id !== existing.id)];
    } else {
      const entry: StoredEntry = { ...input, id: randomUUID(), createdAt: Date.now(), updatedAt: Date.now(), pinned: false, categoryId: null, copyCount: 0 };
      if (png) writeFileSync(join(this.imageDir, `${entry.id}.png`), png, { mode: 0o600 });
      this.data.entries.unshift(entry);
    }
    this.prune(); this.save(); return true;
  }
  private deleteImage(entry: StoredEntry) {
    if (entry.kind === 'image') {
      const path = join(this.imageDir, `${entry.id}.png`);
      if (existsSync(path)) unlinkSync(path);
    }
  }
  private prune() {
    let count = 0;
    this.data.entries = this.data.entries.filter(entry => {
      const keep = entry.pinned || ++count <= this.data.settings.historyLimit;
      if (!keep) this.deleteImage(entry);
      return keep;
    });
  }
  togglePin(id: string) {
    const entry = this.require(id);
    if (!entry.pinned && this.data.entries.filter(item => item.pinned).length >= 100) throw new Error('最多置顶 100 条记录。');
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

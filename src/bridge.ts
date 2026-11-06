import { classify } from '../shared/classify';
import { LocalDictionary, type DictionaryData } from '../shared/local-dictionary';
import { DEFAULT_SETTINGS, type ClipboardBridge, type ClipboardEntry, type Snapshot } from '../shared/types';

declare global { interface Window { pasteboard?: ClipboardBridge } }

function createBrowserBridge(): ClipboardBridge {
  const key = 'pasteboard-plus-preview-v1';
  let dictionary: Promise<LocalDictionary> | undefined;
  async function getDictionary() {
    return dictionary ??= fetch('./vocabulary/typelingo.json.gz').then(async response => {
      if (!response.ok) throw new Error('本地词库加载失败。');
      const bytes = new Uint8Array(await response.arrayBuffer());
      // Static servers may already decode .gz responses via Content-Encoding.
      const data = bytes[0] === 0x1f && bytes[1] === 0x8b
        ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json() as DictionaryData
        : JSON.parse(new TextDecoder().decode(bytes)) as DictionaryData;
      return new LocalDictionary(data);
    }).catch(() => { dictionary = undefined; throw new Error('本地词库加载失败，请重试或重新打开应用。'); });
  }
  let state: Snapshot = { windowMode: 'compact', entries: [], categories: [], settings: { ...DEFAULT_SETTINGS }, hasApiKey: false, keyStorage: 'session', shortcutRegistered: false, warning: null };
  try {
    const saved = localStorage.getItem(key);
    if (saved) {
      const data = JSON.parse(saved);
      if (Array.isArray(data.entries) && Array.isArray(data.categories)) state = { ...state, entries: data.entries, categories: data.categories, settings: { ...DEFAULT_SETTINGS, ...data.settings } };
    }
  } catch { /* Start a new browser preview if local storage is unavailable. */ }
  const callbacks = new Set<(snapshot: Snapshot) => void>();
  const changed = () => {
    const { entries, categories, settings } = state;
    try { localStorage.setItem(key, JSON.stringify({ entries, categories, settings })); } catch { throw new Error('浏览器存储空间不足，请清理部分历史。'); }
    callbacks.forEach(callback => callback(structuredClone(state)));
  };
  const requireEntry = (id: string) => { const entry = state.entries.find(entry => entry.id === id); if (!entry) throw new Error('记录不存在。'); return entry; };
  const addText = (content: string) => {
    if (!content.trim()) return false;
    if (classify(content) === 'path') return false;
    if (content.length > 100_000) throw new Error('这段文字超过 100,000 字，未保存。');
    const existing = state.entries.find(entry => entry.content === content && entry.kind !== 'image');
    if (existing) { existing.updatedAt = Date.now(); state.entries = [existing, ...state.entries.filter(entry => entry.id !== existing.id)]; }
    else state.entries.unshift({ id: crypto.randomUUID(), content, kind: classify(content), createdAt: Date.now(), updatedAt: Date.now(), pinned: false, categoryId: null, copyCount: 0 });
    let count = 0;
    if (state.settings.historyLimit !== 0) state.entries = state.entries.filter(entry => entry.pinned || ++count <= state.settings.historyLimit);
    changed(); return true;
  };
  return {
    isDesktop: false, platform: /Mac/.test(navigator.platform) ? 'darwin' : 'win32',
    getSnapshot: async () => structuredClone(state),
    onChange(callback) { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
    async capture() {
      try { const captured = addText(await navigator.clipboard.readText()); return { captured, message: captured ? '已保存到浏览器预览历史' : '剪贴板中没有文字' }; }
      catch (error) { if (error instanceof Error && error.name !== 'NotAllowedError') throw error; throw new Error('浏览器未授予剪贴板权限。桌面版会自动记录文字和图片。'); }
    },
    async copy(id) {
      const entry = requireEntry(id);
      if (entry.kind === 'image') throw new Error('示例图片用于预览；实际图片复制请使用桌面版。');
      await navigator.clipboard.writeText(entry.content); entry.copyCount++; changed();
    },
    async paste(id, translated = false) { const entry = requireEntry(id);
      if (entry.kind === 'image') throw new Error('示例图片用于预览，请在桌面版中粘贴图片。');
      const text = translated ? entry.translation?.text : entry.content;
      if (!text) throw new Error('这条记录还没有译文。');
      await navigator.clipboard.writeText(text); entry.copyCount++; changed();
      return { pasted: false, message: '已复制；浏览器预览请手动粘贴到输入框' };
    },
    async copyTranslation(id) { const entry = requireEntry(id); if (entry.translation) await navigator.clipboard.writeText(entry.translation.text); },
    async pin(id) { const entry = requireEntry(id); entry.pinned = !entry.pinned; changed(); },
    async remove(id) { state.entries = state.entries.filter(entry => entry.id !== id); changed(); },
    async clear(all) { state.entries = all ? [] : state.entries.filter(entry => entry.pinned); changed(); },
    async createCategory(name) {
      const value = name.trim();
      if (!value || value.length > 24) throw new Error('分类名称需要 1–24 个字符。');
      if (state.categories.length >= 30) throw new Error('最多创建 30 个分类。');
      if (state.categories.some(category => category.name === value)) throw new Error('这个分类名称已存在。');
      state.categories.push({ id: crypto.randomUUID(), name: value, color: ['#a48ad4', '#66a68b', '#d5a45e', '#769ac5'][state.categories.length % 4] }); changed();
    },
    async deleteCategory(id) { state.categories = state.categories.filter(category => category.id !== id); state.entries.forEach(entry => { if (entry.categoryId === id) entry.categoryId = null; }); changed(); },
    async assignCategory(id, categoryId) { requireEntry(id).categoryId = categoryId; changed(); },
    async saveSettings(input) {
      const { apiKey, clearApiKey, ...settings } = input;
      if (apiKey || clearApiKey) throw new Error('API 密钥请在桌面版中配置。浏览器预览不会保存密钥或发送翻译请求。');
      state.settings = settings;
      changed();
    },
    async translate(id, target) {
      if (state.settings.translationMode === 'ai') throw new Error('AI API 请在桌面版中配置，浏览器预览不会发送内容。');
      const entry = requireEntry(id);
      if (entry.kind === 'image') throw new Error('图片暂不支持 OCR 翻译。');
      const result = (await getDictionary()).lookup(entry.content, target, state.settings.sourceLanguage);
      if (!result) throw new Error('本地词库未命中，或该词条有歧义。可在桌面设置中配置 AI API。');
      entry.translation = result; changed(); return result;
    },
    async getImage(id) { return requireEntry(id).image?.thumbnail || ''; },
    async windowAction() { /* No operating system window in the browser preview. */ },
    async setWindowMode(mode) { state.windowMode = mode; changed(); },
    async loadExamples() {
      if (state.entries.length) throw new Error('请先清空预览历史，再载入示例。');
      const categoryId = crypto.randomUUID();
      state.categories = [{ id: categoryId, name: '工作灵感', color: '#a48ad4' }, { id: crypto.randomUUID(), name: '稍后阅读', color: '#66a68b' }];
      const examples = [
        { content: 'Design is how it feels.\n\nGreat tools get out of the way, so you can stay in the flow. Make room for the little things that inspire you.', pinned: true, categoryId },
        { content: 'https://www.figma.com/community', pinned: true },
        { content: '周五的灵感清单\n\n把复杂留给工具，把简单留给自己。\n试着让每一次复制，都成为下一次创作的起点。', categoryId },
        { content: 'const ideas = clipboard.history\n  .filter(item => item.isInspiring)\n  .map(item => makeSomethingGreat(item));' },
        { content: 'C:\\Users\\Designer\\Documents\\Projects\\Brand Guidelines.pdf' },
        { content: 'https://www.notion.so/product', categoryId: state.categories[1].id },
        { content: 'less, but better.\n让工作流少一点打断，多一点从容。' },
        { content: '/Users/designer/Downloads/moodboard-2026.png' },
      ];
      state.entries = examples.map((example, index): ClipboardEntry => ({ id: crypto.randomUUID(), content: example.content, kind: classify(example.content), pinned: example.pinned || false, categoryId: example.categoryId || null, createdAt: Date.now() - index * 240_000, updatedAt: Date.now() - index * 240_000, copyCount: 0 }));
      const art = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="#b5c3c7"/><stop offset="1" stop-color="#e2d6bd"/></linearGradient><linearGradient id="m" x2="0" y2="1"><stop stop-color="#6b7f72"/><stop offset="1" stop-color="#314e45"/></linearGradient></defs><rect width="800" height="500" fill="url(#s)"/><circle cx="585" cy="146" r="54" fill="#f3ddaf"/><path d="M0 330L145 180L265 300L395 120L600 340L710 190L800 290V500H0Z" fill="#8d9d93"/><path d="M0 405L180 275L300 365L510 215L800 450V500H0Z" fill="url(#m)"/><path d="M0 450Q200 340 410 440T800 400V500H0Z" fill="#29463c"/><text x="35" y="465" fill="#d8e0d5" font-family="sans-serif" font-size="13" letter-spacing="5">A MOMENT OF STILLNESS</text></svg>`;
      const thumbnail = `data:image/svg+xml;base64,${btoa(art)}`;
      state.entries.splice(2, 0, { id: crypto.randomUUID(), kind: 'image', content: '', pinned: false, categoryId, createdAt: Date.now() - 300_000, updatedAt: Date.now() - 300_000, copyCount: 0, image: { thumbnail, width: 800, height: 500, bytes: art.length } });
      changed();
    },
  };
}

export const bridge = window.pasteboard || createBrowserBridge();

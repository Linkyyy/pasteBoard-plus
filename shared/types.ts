export const KINDS = ['text', 'image', 'url', 'path', 'code'] as const;
export type ContentKind = (typeof KINDS)[number];
export type Language = 'zh-CN' | 'en' | 'ja' | 'ko' | 'de' | 'fr';
export const LANGUAGES: Record<Language, string> = {
  'zh-CN': '简体中文', en: '英语', ja: '日语', ko: '韩语', de: '德语', fr: '法语',
};
export const CLIPBOARD_AI_MODES = ['off', 'answer', 'translate'] as const;
export type ClipboardAiMode = (typeof CLIPBOARD_AI_MODES)[number];
export type AiResult = Exclude<ClipboardAiMode, 'off'>;
export const AI_MODE_LABELS: Record<ClipboardAiMode, string> = { off: '关闭', answer: '作答', translate: '翻译' };
export const AI_PROVIDERS = {
  openai: { name: 'OpenAI', apiEndpoint: 'https://api.openai.com/v1', apiModel: 'gpt-4o-mini' },
  deepseek: { name: 'DeepSeek', apiEndpoint: 'https://api.deepseek.com/v1', apiModel: 'deepseek-chat' },
};
export function apiBaseUrl(endpoint: string) {
  return endpoint.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
}

export interface Translation { text: string; language: Language; createdAt: number; provider?: 'local' | 'ai' }
export interface ClipboardEntry {
  id: string;
  kind: ContentKind;
  content: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  categoryId: string | null;
  copyCount: number;
  image?: { thumbnail: string; width: number; height: number; bytes: number };
  translation?: Translation;
  aiResult?: AiResult;
}
export interface Category { id: string; name: string; color: string }
export interface Settings {
  shortcut: string;
  historyLimit: number;
  captureEnabled: boolean;
  captureImages: boolean;
  apiEndpoint: string;
  apiModel: string;
  targetLanguage: Language;
  sourceLanguage: 'auto' | 'zh-CN' | 'en' | 'ja';
  translationMode: 'auto' | 'local' | 'ai';
  clipboardAiMode: ClipboardAiMode;
  fontSize: 14 | 16 | 18;
  autoPaste: boolean;
}
export interface SettingsInput extends Settings { apiKey?: string; clearApiKey?: boolean }
export interface Snapshot {
  windowMode: 'compact' | 'manager';
  entries: ClipboardEntry[];
  categories: Category[];
  settings: Settings;
  hasApiKey: boolean;
  keyStorage: 'secure' | 'session';
  shortcutRegistered: boolean;
  warning: string | null;
  clipboardAi?: { state: 'working' } | { state: 'ready'; entryId: string; clipboardUpdated: boolean } | { state: 'error'; message: string };
  insertion?: { supported: boolean; hasTarget: boolean; caretLocated: boolean; message: string | null };
}
export interface ClipboardBridge {
  platform: string;
  isDesktop: boolean;
  getSnapshot(): Promise<Snapshot>;
  onChange(callback: (snapshot: Snapshot) => void): () => void;
  capture(): Promise<{ captured: boolean; message: string }>;
  copy(id: string, hide?: boolean): Promise<void>;
  copyTranslation(id: string): Promise<void>;
  paste(id: string, translated?: boolean): Promise<{ pasted: boolean; message: string }>;
  pin(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  clear(includePinned: boolean): Promise<void>;
  createCategory(name: string): Promise<void>;
  deleteCategory(id: string): Promise<void>;
  assignCategory(id: string, categoryId: string | null): Promise<void>;
  saveSettings(settings: SettingsInput): Promise<void>;
  translate(id: string, language: Language): Promise<Translation>;
  getImage(id: string): Promise<string>;
  windowAction(action: 'minimize' | 'maximize' | 'hide' | 'quit'): Promise<void>;
  setWindowMode(mode: 'compact' | 'manager'): Promise<void>;
  loadExamples?(): Promise<void>;
}
export const DEFAULT_SETTINGS: Settings = {
  shortcut: 'CommandOrControl+Shift+V', historyLimit: 0, captureEnabled: true, captureImages: false,
  apiEndpoint: AI_PROVIDERS.openai.apiEndpoint, apiModel: AI_PROVIDERS.openai.apiModel, targetLanguage: 'zh-CN',
  sourceLanguage: 'auto', translationMode: 'auto', clipboardAiMode: 'off', fontSize: 16, autoPaste: true,
};

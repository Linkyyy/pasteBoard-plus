export const KINDS = ['text', 'image', 'url', 'path', 'code'] as const;
export type ContentKind = (typeof KINDS)[number];
export type Language = 'zh-CN' | 'en' | 'ja' | 'ko' | 'de' | 'fr';
export const LANGUAGES: Record<Language, string> = {
  'zh-CN': '简体中文', en: '英语', ja: '日语', ko: '韩语', de: '德语', fr: '法语',
};
export interface Translation { text: string; language: Language; createdAt: number }
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
}
export interface ClipboardBridge {
  platform: string;
  isDesktop: boolean;
  getSnapshot(): Promise<Snapshot>;
  onChange(callback: (snapshot: Snapshot) => void): () => void;
  capture(): Promise<{ captured: boolean; message: string }>;
  copy(id: string, hide?: boolean): Promise<void>;
  copyTranslation(id: string): Promise<void>;
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
  apiEndpoint: 'https://api.openai.com/v1', apiModel: 'gpt-4o-mini', targetLanguage: 'zh-CN',
};

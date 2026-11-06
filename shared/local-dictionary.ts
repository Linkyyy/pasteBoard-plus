import type { Language, Translation } from './types';

export type DictionaryLanguage = 'zh' | 'en' | 'ja';
export type SourceLanguage = 'auto' | 'zh-CN' | 'en' | 'ja';
export interface DictionaryData {
  entries: [DictionaryLanguage, DictionaryLanguage, string, string][];
  ambiguous: [DictionaryLanguage, DictionaryLanguage, string][];
  count: number;
}
const normalized = (text: string, source: string) => source === 'en' ? text.trim().normalize('NFC').toLowerCase() : text.trim().normalize('NFC');
const key = (from: string, to: string, text: string) => `${from}\0${to}\0${normalized(text, from)}`;

export class LocalDictionary {
  private index = new Map<string, string>();
  private ambiguous = new Set<string>();
  readonly count: number;
  constructor(data: DictionaryData) {
    this.count = data.count;
    for (const [from, to, text] of data.ambiguous) this.ambiguous.add(key(from, to, text));
    for (const [from, to, text, translated] of data.entries) {
      const id = key(from, to, text);
      if (this.ambiguous.has(id)) continue;
      const previous = this.index.get(id);
      if (previous && previous !== translated) { this.index.delete(id); this.ambiguous.add(id); }
      else this.index.set(id, translated);
    }
  }
  lookup(text: string, target: Language, source: SourceLanguage = 'auto'): Translation | null {
    if (!['zh-CN', 'en', 'ja'].includes(target)) return null;
    const to = target === 'zh-CN' ? 'zh' : target;
    const from = source === 'zh-CN' ? 'zh' : source;
    if (from === to) return { text, language: target, createdAt: Date.now(), provider: 'local' };
    const sources: DictionaryLanguage[] = from !== 'auto' ? [from] : /[ぁ-んァ-ヶ]/u.test(text) ? ['ja'] : /[\p{Script=Han}]/u.test(text) ? ['zh', 'ja'] : ['en'];
    const results = sources.filter(language => language !== to).map(language => this.index.get(key(language, to, text))).filter((result): result is string => Boolean(result));
    const unique = [...new Set(results)];
    if (unique.length > 1) throw new Error('本地词库存在多种解释，请在设置中指定原文语言后重试。');
    return unique.length === 1 ? { text: unique[0], language: target, createdAt: Date.now(), provider: 'local' } : null;
  }
}

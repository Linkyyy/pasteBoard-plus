import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { LocalDictionary, type DictionaryData } from '../shared/local-dictionary';
import type { Language, Settings, Translation } from '../shared/types';
import { translateText, type TranslationFetch } from './translate';

export class TranslationService {
  private dictionary?: LocalDictionary;
  constructor(private dictionaryFile: string) {}
  private local() { return this.dictionary ??= new LocalDictionary(JSON.parse(gunzipSync(readFileSync(this.dictionaryFile)).toString()) as DictionaryData); }
  async translate(text: string, target: Language, settings: Settings, apiKey: string, request?: TranslationFetch): Promise<Translation> {
    if (!text.trim()) throw new Error('没有可以翻译的文字。');
    if (settings.translationMode === 'ai' && !apiKey) throw new Error('请先在设置中配置 AI API 密钥，或选择自动 / 本地词库模式。');
    if (apiKey && settings.translationMode !== 'local') return { ...await translateText(text, target, settings, apiKey, request), provider: 'ai' };
    const result = this.local().lookup(text, target, settings.sourceLanguage);
    if (result) return result;
    throw new Error('本地词库未命中，或该词条有歧义。可检查原文语言，或在设置中配置 AI API 翻译词库以外的内容。');
  }
}

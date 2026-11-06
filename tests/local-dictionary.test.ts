import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { LocalDictionary, type DictionaryData } from '../shared/local-dictionary';
import { TranslationService } from '../electron/translation-service';
import { DEFAULT_SETTINGS, type Language } from '../shared/types';
import type { TranslationFetch } from '../electron/translate';

const path = resolve('public/vocabulary/typelingo.json.gz');
const data: DictionaryData = JSON.parse(gunzipSync(readFileSync(path)).toString());
const dictionary = new LocalDictionary(data);
describe('user-supplied TypeLingo dictionary', () => {
  it('imports the actual 32,159 six-direction records and 2,441 conflicts', () => {
    expect(data.entries).toHaveLength(32159); expect(data.ambiguous).toHaveLength(2441);
    expect(new Set(data.entries.map(([from, to]) => `${from}->${to}`)).size).toBe(6);
  });
  it.each([
    ['面包', 'en', 'bread'], ['面包', 'ja', 'パン'], ['bread', 'zh-CN', '面包'],
    ['bread', 'ja', 'パン'], ['パン', 'zh-CN', '面包'], ['パン', 'en', 'bread'],
  ])('translates %s to %s offline', (text, target, translated) => {
    expect(dictionary.lookup(text, target as Language)).toMatchObject({ text: translated, provider: 'local', language: target });
  });
  it('handles trimmed and capitalized English without silently resolving ambiguity', () => {
    expect(dictionary.lookup(' Bread ', 'ja')?.text).toBe('パン');
    expect(dictionary.lookup('粥', 'ja', 'zh-CN')).toBeNull();
    expect(dictionary.lookup('not a dictionary sentence 123', 'zh-CN')).toBeNull();
  });
  it('blocks conflicting source languages instead of guessing', () => {
    const sample = new LocalDictionary({ count: 2, ambiguous: [], entries: [['zh', 'en', '相同', 'A'], ['ja', 'en', '相同', 'B']] });
    expect(() => sample.lookup('相同', 'en')).toThrow('原文');
    expect(sample.lookup('相同', 'en', 'ja')?.text).toBe('B');
  });
});
describe('translation routing', () => {
  it('uses local data without an API key and makes no network call', async () => {
    const fetch = vi.fn<TranslationFetch>();
    const service = new TranslationService(path);
    await expect(service.translate('bread', 'ja', DEFAULT_SETTINGS, '', fetch)).resolves.toMatchObject({ text: 'パン', provider: 'local' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the configured API in automatic mode and marks its provider', async () => {
    const fetch = vi.fn<TranslationFetch>().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ choices: [{ message: { content: 'AI 译文' }, finish_reason: 'stop' }] }) });
    const result = await new TranslationService(path).translate('bread', 'zh-CN', DEFAULT_SETTINGS, 'test-key', fetch);
    expect(result).toMatchObject({ text: 'AI 译文', provider: 'ai' }); expect(fetch).toHaveBeenCalledOnce();
  });
  it('local-only mode never sends content even when a key exists', async () => {
    const fetch = vi.fn<TranslationFetch>();
    const service = new TranslationService(path);
    await expect(service.translate('bread', 'zh-CN', { ...DEFAULT_SETTINGS, translationMode: 'local' }, 'test-key', fetch)).resolves.toMatchObject({ text: '面包' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reports missing entries, unsupported offline languages and unconfigured AI', async () => {
    const service = new TranslationService(path);
    await expect(service.translate('unknown phrase 123', 'ja', DEFAULT_SETTINGS, '')).rejects.toThrow('未命中');
    await expect(service.translate('bread', 'de', DEFAULT_SETTINGS, '')).rejects.toThrow('未命中');
    await expect(service.translate('bread', 'ja', { ...DEFAULT_SETTINGS, translationMode: 'ai' }, '')).rejects.toThrow('密钥');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { translateText, type TranslationFetch } from '../electron/translate';
import { endpointSchema, settingsSchema } from '../electron/schema';
import { DEFAULT_SETTINGS } from '../shared/types';

function response(status: number, body: unknown) { return { ok: status >= 200 && status < 300, status, text: async () => typeof body === 'string' ? body : JSON.stringify(body) }; }
describe('AI translation', () => {
  it('sends only the selected text, model and target language to the configured provider', async () => {
    const request = vi.fn<TranslationFetch>().mockResolvedValue(response(200, { choices: [{ message: { content: '你好，世界。' }, finish_reason: 'stop' }] }));
    const result = await translateText('Hello, world.', 'zh-CN', { ...DEFAULT_SETTINGS, apiEndpoint: 'https://example.org/v1/' }, 'test-key', request);
    expect(result.text).toBe('你好，世界。'); expect(result.language).toBe('zh-CN');
    const [url, init] = request.mock.calls[0];
    expect(url).toBe('https://example.org/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const payload = JSON.parse(init.body);
    expect(payload.messages[1]).toEqual({ role: 'user', content: 'Hello, world.' });
    expect(payload.messages[0].content).toContain('简体中文');
    expect(payload).not.toHaveProperty('history'); expect(init.redirect).toBe('error');
  });
  it.each([401,403,404,429,500])('reports HTTP %s without revealing provider bodies or secrets', async status => {
    const request: TranslationFetch = async () => response(status, { error: 'secret provider internals' });
    await expect(translateText('hello', 'ja', DEFAULT_SETTINGS, 'test-key', request)).rejects.toThrow(/密钥|权限|接口|额度|不可用/);
  });
  it('handles malformed responses, empty outputs, and truncated translations', async () => {
    for (const body of ['<html>broken</html>', { choices: [] }, { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }]) {
      await expect(translateText('hello', 'en', DEFAULT_SETTINGS, 'test-key', async () => response(200, body))).rejects.toThrow(/无法识别|有效译文|截断/);
    }
  });
  it('does not call the provider without a key or for overlong content', async () => {
    const request = vi.fn<TranslationFetch>();
    await expect(translateText('hello', 'en', DEFAULT_SETTINGS, '', request)).rejects.toThrow('密钥');
    await expect(translateText('x'.repeat(20_001), 'en', DEFAULT_SETTINGS, 'test-key', request)).rejects.toThrow('20,000');
    expect(request).not.toHaveBeenCalled();
  });
  it('reports network and timeout failures clearly', async () => {
    await expect(translateText('hello', 'en', DEFAULT_SETTINGS, 'test-key', async () => { throw new Error('internal'); })).rejects.toThrow('无法连接');
    await expect(translateText('hello', 'en', DEFAULT_SETTINGS, 'test-key', async () => { throw new DOMException('timeout', 'TimeoutError'); })).rejects.toThrow('超时');
  });
});
describe('settings validation', () => {
  it.each(['https://api.openai.com/v1', 'http://localhost:8000/v1', 'http://127.0.0.1:1234/v1'])('accepts supported API address %s', value => expect(endpointSchema.safeParse(value).success).toBe(true));
  it.each(['http://example.com/v1', 'file:///tmp/key', 'https://user:password@example.com/v1', 'https://api.example.com/v1?key=secret'])('rejects unsafe API address %s', value => expect(endpointSchema.safeParse(value).success).toBe(false));
  it('validates shortcut syntax and history bounds', () => {
    expect(settingsSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, shortcut: 'V' }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...DEFAULT_SETTINGS, historyLimit: -1 }).success).toBe(false);
  });
});

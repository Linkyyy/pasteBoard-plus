import { z } from 'zod';
export const idSchema = z.string().uuid();
export const languageSchema = z.enum(['zh-CN', 'en', 'ja', 'ko', 'de', 'fr']);
export const endpointSchema = z.string().trim().url().max(500).refine(value => {
  const url = new URL(value);
  return !url.username && !url.password && !url.search && !url.hash
    && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)));
}, 'API 地址必须使用 HTTPS；本地服务可以使用 HTTP。请勿在地址中包含密钥或查询参数。');
export const settingsSchema = z.object({
  shortcut: z.string().min(3).max(80).regex(/^(?:(?:CommandOrControl|Control|Command|Alt|Option|Shift|Super)\+){1,4}(?:[A-Z0-9]|Space|F(?:[1-9]|1[0-9]|2[0-4]))$/, '请选择包含修饰键的有效快捷键'),
  historyLimit: z.number().int().nonnegative().safe(), captureEnabled: z.boolean(), captureImages: z.boolean().default(false),
  apiEndpoint: endpointSchema, apiModel: z.string().trim().min(1).max(100), targetLanguage: languageSchema,
  apiKey: z.string().trim().max(2048).optional(), clearApiKey: z.boolean().optional(),
  sourceLanguage: z.enum(['auto', 'zh-CN', 'en', 'ja']).default('auto'),
  translationMode: z.enum(['auto', 'local', 'ai']).default('auto'),
  fontSize: z.union([z.literal(14), z.literal(16), z.literal(18)]).default(16),
  autoPaste: z.boolean().default(true),
});

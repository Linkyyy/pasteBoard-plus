import type { ContentKind } from './types';

export function classify(text: string): ContentKind {
  const value = text.trim();
  const lines = value.split(/\r?\n/).filter(Boolean);
  const isPath = (line: string) => /^(?:[a-zA-Z]:[\\/]|\\\\[^\\]+\\|\/(?:[^/\s]+\/)*[^\s]*|~\/|file:\/\/)/.test(line.trim().replace(/^"(.*)"$/, '$1'));
  if (lines.length && lines.every(isPath)) return 'path';
  if (lines.length && lines.every(line => {
    try { return ['http:', 'https:'].includes(new URL(line.trim()).protocol); } catch { return false; }
  })) return 'url';
  if (/^(?:\s*(?:const|let|var|import|export|function|class|interface|def|from|SELECT|CREATE TABLE)\s|\s*<\/?[a-zA-Z][^>]*>|\s*\{\s*"[^"\n]+"\s*:)/m.test(value)
    || /^```/.test(value)) return 'code';
  return 'text';
}

export function titleOf(content: string, kind: ContentKind): string {
  if (kind === 'image') return '剪贴板图片';
  if (kind === 'url') {
    try { return new URL(content.trim().split('\n')[0]).hostname.replace(/^www\./, ''); } catch { /* use text */ }
  }
  if (kind === 'path') return content.trim().split(/[\\/]/).filter(Boolean).at(-1) || content;
  return content.trim().split('\n').find(Boolean)?.slice(0, 80) || '空白文本';
}

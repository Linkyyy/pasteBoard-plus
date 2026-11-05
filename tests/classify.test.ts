import { describe, expect, it } from 'vitest';
import { classify, titleOf } from '../shared/classify';

describe('automatic clipboard classification', () => {
  it.each([
    ['a small idea', 'text'], ['你好，世界。', 'text'],
    ['https://example.com/hello?q=1', 'url'], ['http://localhost:3000\nhttps://example.org', 'url'],
    ['Read https://example.org later', 'text'], ['javascript:alert(1)', 'text'],
    ['C:\\Users\\Alice\\My Documents\\report.pdf', 'path'], ['"C:\\My Files\\report.pdf"', 'path'],
    ['\\\\server\\share\\report.pdf', 'path'], ['/Users/alice/file.txt', 'path'],
    ['~/Downloads/example.png', 'path'], ['file:///C:/Users/Alice/image.png', 'path'],
    ['const answer = 42;\nconsole.log(answer);', 'code'], ['{"name":"clipboard"}', 'code'],
    ['def translate(text):\n    return text', 'code'], ['今天安排：\n1. 写文档\n2. 开会', 'text'],
  ])('classifies %s as %s', (value, expected) => expect(classify(value)).toBe(expected));
  it('derives useful titles without opening URLs', () => {
    expect(titleOf('https://www.example.com/private/path', 'url')).toBe('example.com');
    expect(titleOf('C:\\Folder\\document.pdf', 'path')).toBe('document.pdf');
    expect(titleOf('First line\nSecond line', 'text')).toBe('First line');
  });
});

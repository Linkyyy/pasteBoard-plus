import { describe, expect, it, vi } from 'vitest';
import { WindowsFocus, type FocusContext } from '../electron/windows-focus';
import { hasFocusTarget } from '../shared/focus-target';

const chromium: FocusContext = { window: '812', control: '813', process: 1200, elementKey: '', editable: false, caretLocated: false, x: 0, y: 0, width: 0, height: 0 };
describe('Windows targets without editable accessibility patterns', () => {
  it('retains a captured keyboard target even when no caret/Edit pattern is exposed', () => {
    expect(hasFocusTarget(chromium)).toBe(true);
    expect(hasFocusTarget({ ...chromium, control: '0', elementKey: '42-1-2' })).toBe(true);
  });
  it('rejects missing windows and identities instead of sending paste blindly', () => {
    expect(hasFocusTarget(null)).toBe(false);
    expect(hasFocusTarget({ ...chromium, window: '0' })).toBe(false);
    expect(hasFocusTarget({ ...chromium, control: '0' })).toBe(false);
    expect(hasFocusTarget({ ...chromium, process: 0 })).toBe(false);
  });
  it('forwards an unrecognized editor to native focus validation, rather than reporting no input', async () => {
    const service = new WindowsFocus('/unused');
    const request = vi.spyOn(service as unknown as { request(command: string, payload: object): Promise<unknown> }, 'request')
      .mockResolvedValue({ pasted: true, message: 'sent' });
    await expect(service.paste(chromium)).resolves.toMatchObject({ pasted: true });
    expect(request).toHaveBeenCalledWith('paste', { window: '812', control: '813', process: 1200, elementKey: '' });
    request.mockClear();
    await expect(service.paste({ ...chromium, window: '0' })).resolves.toMatchObject({ pasted: false });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('Windows clipboard typing', () => {
  it('sends Unicode text in focus-checked batches, retaining spaces, emoji, tabs and line breaks', async () => {
    const service = new WindowsFocus('/unused');
    const request = vi.spyOn(service as unknown as { request(command: string, payload: { utf16: string; releaseKey: number }): Promise<unknown> }, 'request').mockResolvedValue(null);
    const first = '中'.repeat(31) + '🙂';
    await service.typeText(chromium, first + ' \r\nか\t文\n', 'CommandOrControl+Alt+V');
    expect(request.mock.calls.map(([, payload]) => Buffer.from(payload.utf16, 'base64').toString('utf16le'))).toEqual([first, ' ', '\r', 'か', '\t', '文', '\r']);
    expect(request.mock.calls[0][1].releaseKey).toBe(0x56);
    expect(request.mock.calls.slice(1).every(([, payload]) => payload.releaseKey === 0)).toBe(true);
    for (const [command, payload] of request.mock.calls) {
      expect(command).toBe('typeText');
      expect(payload).toMatchObject({ window: chromium.window, control: chromium.control, process: chromium.process, elementKey: chromium.elementKey });
    }
  });

  it('stops after a rejected batch and skips empty or invalid input before sending any characters', async () => {
    const service = new WindowsFocus('/unused');
    const request = vi.spyOn(service as unknown as { request(command: string, payload: object): Promise<unknown> }, 'request')
      .mockResolvedValueOnce(null).mockResolvedValueOnce('输入焦点已改变');
    await expect(service.typeText(chromium, 'x'.repeat(100), 'Control+F3')).rejects.toThrow('焦点');
    expect(request).toHaveBeenCalledTimes(2);
    request.mockClear();
    for (const text of ['', 'one\u0008two']) await expect(service.typeText(chromium, text, 'Control+Space')).rejects.toThrow();
    await expect(service.typeText({ ...chromium, window: '0' }, 'hello', 'Control+Space')).rejects.toThrow('目标输入框');
    expect(request).not.toHaveBeenCalled();
  });
});

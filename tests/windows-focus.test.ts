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

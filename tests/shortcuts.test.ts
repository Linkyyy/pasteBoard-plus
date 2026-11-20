import { describe, expect, it, vi } from 'vitest';
import { ClipboardShortcuts } from '../electron/shortcuts';
import { shortcutProblem, type ShortcutSettings } from '../shared/shortcuts';
import { DEFAULT_SETTINGS } from '../shared/types';

function setup(platform = 'win32', initial: ShortcutSettings = DEFAULT_SETTINGS) {
  let saved = initial;
  const callbacks = new Map<string, () => void>();
  const registry = {
    register(key: string, callback: () => void) {
      if (callbacks.has(key)) return false;
      callbacks.set(key, callback); return true;
    },
    unregister(key: string) { callbacks.delete(key); },
  };
  const open = vi.fn(), type = vi.fn();
  const shortcuts = new ClipboardShortcuts(registry, platform, () => saved, open, type);
  shortcuts.prepare(saved);
  function save(next: ShortcutSettings, failWrite = false) {
    try {
      shortcuts.prepare(next, saved);
      if (failWrite) throw new Error('disk');
      saved = next;
    } finally { shortcuts.releaseUnused(); }
  }
  return { shortcuts, callbacks, save, open, type };
}

describe('clipboard shortcuts', () => {
  it('dispatches independent bindings and follows reassignment, swapping and disabling', () => {
    const { shortcuts, callbacks, save, open, type } = setup();
    callbacks.get('Alt+Control+V')!(); callbacks.get('Control+Shift+V')!();
    expect(type).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce();
    save({ shortcut: 'Alt+Control+V', typingShortcut: 'Shift+Control+V' });
    callbacks.get('Alt+Control+V')!(); expect(open).toHaveBeenCalledTimes(2);
    callbacks.get('Control+Shift+V')!(); expect(type).toHaveBeenCalledTimes(2);
    save({ shortcut: 'Alt+Control+V', typingShortcut: '' });
    expect([...callbacks.keys()]).toEqual(['Alt+Control+V']);
    expect(shortcuts.status).toEqual({ shortcutRegistered: true, typingShortcutRegistered: false });
  });

  it('retains prior keys on a conflict or failed save and respects reserved paste keys', () => {
    const { callbacks, save } = setup();
    callbacks.set('Control+F4', () => {});
    const before = [...callbacks.keys()];
    expect(() => save({ shortcut: 'Control+F3', typingShortcut: 'Control+F4' })).toThrow('被占用');
    expect(() => save({ shortcut: 'Control+F3', typingShortcut: 'Control+F5' }, true)).toThrow('disk');
    expect(() => save({ shortcut: 'Control+F3', typingShortcut: 'CommandOrControl+F3' })).toThrow('不同');
    expect(shortcutProblem({ ...DEFAULT_SETTINGS, typingShortcut: 'CommandOrControl+V' }, 'win32')).toContain('系统复制');
    expect([...callbacks.keys()]).toEqual(before);
  });

  it('preserves a legacy popup binding that matches the new default and only registers typing on Windows', () => {
    const { shortcuts, open, callbacks } = setup('win32', { ...DEFAULT_SETTINGS, shortcut: 'Alt+Control+V' });
    callbacks.get('Alt+Control+V')!(); expect(open).toHaveBeenCalledOnce();
    expect(shortcuts.status.typingShortcutRegistered).toBe(false);
    expect(setup('linux').shortcuts.status).toEqual({ shortcutRegistered: true, typingShortcutRegistered: false });
  });
});

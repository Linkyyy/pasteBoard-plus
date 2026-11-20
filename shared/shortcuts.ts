import type { Settings } from './types';

export type ShortcutSettings = Pick<Settings, 'shortcut' | 'typingShortcut'>;

export function canonicalShortcut(value: string, platform: string) {
  const parts = value.split('+');
  const key = parts.pop()!;
  const modifiers = parts.map(part => {
    if (part === 'CommandOrControl') return platform === 'darwin' ? 'Command' : 'Control';
    if (part === 'Option') return 'Alt';
    if (part === 'Super' && platform === 'darwin') return 'Command';
    return part;
  });
  return [...new Set(modifiers)].sort().concat(key).join('+');
}

export function shortcutProblem(settings: ShortcutSettings, platform: string) {
  const open = canonicalShortcut(settings.shortcut, platform);
  if (open === 'Super+V') return 'Windows + V 由系统剪贴板占用，请选择其他组合。';
  if (platform !== 'win32' || !settings.typingShortcut) return;
  const type = canonicalShortcut(settings.typingShortcut, platform);
  if (open === type) return '逐字输入和唤出剪贴板需要使用不同的快捷键。';
  if (['Control+C', 'Control+V', 'Control+X', 'Super+V'].includes(type)) return '请为逐字输入选择其他组合，保留系统复制、剪切和粘贴快捷键。';
}

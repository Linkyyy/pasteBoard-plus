import { canonicalShortcut, shortcutProblem, type ShortcutSettings } from '../shared/shortcuts';

interface ShortcutRegistry {
  register(key: string, callback: () => void): boolean;
  unregister(key: string): void;
}

export class ClipboardShortcuts {
  private registered = new Set<string>();

  constructor(private registry: ShortcutRegistry, private platform: string, private current: () => ShortcutSettings,
    private open: () => void, private type: () => void) {}

  private keys(settings: ShortcutSettings) {
    return [canonicalShortcut(settings.shortcut, this.platform),
      this.platform === 'win32' ? canonicalShortcut(settings.typingShortcut, this.platform) : ''];
  }

  get status() {
    const [open, type] = this.keys(this.current());
    return { shortcutRegistered: this.registered.has(open), typingShortcutRegistered: type !== open && this.registered.has(type) };
  }

  // Reserve new keys before saving. The callback follows the saved binding, including when two keys are swapped.
  prepare(next: ShortcutSettings, previous?: ShortcutSettings) {
    const keys = this.keys(next);
    const oldKeys = previous && this.keys(previous);
    const problem = shortcutProblem(next, this.platform);
    if (oldKeys && keys.some((key, i) => key !== oldKeys[i]) && problem) throw new Error(problem);
    for (const [index, key] of keys.entries()) {
      if (!key || this.registered.has(key) || (index === 1 && problem)) continue;
      let registered = false;
      try {
        registered = this.registry.register(key, () => {
          const [open, type] = this.keys(this.current());
          if (key === open) this.open();
          else if (key === type) this.type();
        });
      } catch { /* An accelerator can be unavailable on this system. */ }
      if (registered) this.registered.add(key);
      else if (oldKeys && oldKeys[index] !== key) throw new Error(`${index === 0 ? '唤出' : '逐字输入'}快捷键已被占用或当前系统不支持，请更换组合。`);
    }
  }

  releaseUnused() {
    const keep = this.keys(this.current());
    for (const key of this.registered) {
      if (keep.includes(key)) continue;
      this.registry.unregister(key);
      this.registered.delete(key);
    }
  }
}

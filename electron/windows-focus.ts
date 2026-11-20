import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { hasFocusTarget } from '../shared/focus-target';

export interface FocusContext { window: string; control: string; process: number; elementKey: string; editable: boolean; caretLocated: boolean; x: number; y: number; width: number; height: number }
export class WindowsFocus {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private running = false;
  private next = 0;
  private pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private sourceDirectory: string) {}
  warm() { return this.start(); }
  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const host = readFileSync(join(this.sourceDirectory, 'focus-host.ps1'), 'utf8');
      const powershell = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-Command', host], {
        windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PASTEBOARD_FOCUS_SOURCE: join(this.sourceDirectory, 'FocusBridge.cs') },
      });
      this.child = child;
      const timeout = setTimeout(() => { reject(new Error('Windows 输入辅助服务启动超时。')); this.stop(); }, 12_000);
      child.stderr.on('data', () => { /* Do not log UI Automation or process details. */ });
      child.on('error', () => { clearTimeout(timeout); reject(new Error('无法启动 Windows 输入辅助服务。')); if (this.child === child) this.stop(); });
      child.stdin.on('error', () => { if (this.child === child) this.stop(); });
      child.on('exit', () => { clearTimeout(timeout); reject(new Error('Windows 输入辅助服务已退出。')); if (this.child === child) this.stop(); });
      createInterface({ input: child.stdout }).on('line', line => {
        let result; try { result = JSON.parse(line); } catch { return; }
        if (typeof result.ready === 'boolean') { clearTimeout(timeout); if (result.ready) { this.running = true; resolve(); } else { reject(new Error(result.error)); this.stop(); } return; }
        const item = this.pending.get(result.id); if (!item) return;
        clearTimeout(item.timer); this.pending.delete(result.id);
        if (result.ok) item.resolve(result.value); else item.reject(new Error(result.error || 'Windows 输入操作失败。'));
      });
    });
    return this.ready;
  }
  private async request<T>(command: string, payload: object): Promise<T> {
    await this.start();
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(command === 'typeText' ? '逐字输入超时，已停止。请检查已输入的文字。' : '目标输入框响应超时，请重新唤出剪贴板。')); this.stop(); }, 2500);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, command, ...payload }) + '\n');
    });
  }
  capture(ownWindow: string) { return this.request<FocusContext>('capture', { ownWindow }); }
  async captureForTyping(ownWindow: string) {
    if (!this.running) {
      await this.warm();
      throw new Error('输入服务已就绪，请在目标输入框重新按逐字输入快捷键。');
    }
    return this.capture(ownWindow);
  }
  paste(target: FocusContext) {
    if (!hasFocusTarget(target)) return Promise.resolve({ pasted: false, message: '未捕获到原窗口的键盘焦点。内容已复制，请在目标输入框重新按快捷键唤出。' });
    return this.request<{ pasted: boolean; message: string }>('paste', { window: target.window, control: target.control, process: target.process, elementKey: target.elementKey });
  }
  async typeText(target: FocusContext, text: string, shortcut: string) {
    if (!hasFocusTarget(target)) throw new Error('请先点击目标输入框，再按逐字输入快捷键。');
    if (!text) throw new Error('剪贴板中没有可输入的文字。');
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('剪贴板文字包含无法逐字输入的控制字符。');
    const identity = { window: target.window, control: target.control, process: target.process, elementKey: target.elementKey };
    const key = shortcut.split('+').at(-1)!;
    let releaseKey = key === 'Space' ? 0x20 : /^F\d+$/.test(key) ? 0x70 + Number(key.slice(1)) - 1 : key.charCodeAt(0);
    // Each request rechecks focus. Keep surrogate pairs together and recheck after every line break or tab.
    const normalized = text.replace(/\r\n|\n/g, '\r');
    for (const [chunk] of normalized.matchAll(/[^\r\t]{1,32}|[\r\t]/gu)) {
      const utf16 = Buffer.from(chunk, 'utf16le').toString('base64');
      const problem = await this.request<string | null>('typeText', { ...identity, utf16, releaseKey });
      if (problem) throw new Error(problem);
      releaseKey = 0;
    }
  }
  stop() { const child = this.child; this.child = undefined; this.ready = undefined; this.running = false; child?.kill(); for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Windows 输入辅助服务已停止，请重新唤出。')); } this.pending.clear(); }
}

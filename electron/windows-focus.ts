import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import { hasFocusTarget } from '../shared/focus-target';

export interface FocusContext { window: string; control: string; process: number; elementKey: string; editable: boolean; caretLocated: boolean; x: number; y: number; width: number; height: number }
export class WindowsFocus {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
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
        if (typeof result.ready === 'boolean') { clearTimeout(timeout); if (result.ready) resolve(); else { reject(new Error(result.error)); this.stop(); } return; }
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
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('目标输入框响应超时，请重新唤出剪贴板。')); this.stop(); }, 2500);
      this.pending.set(id, { resolve, reject, timer });
      this.child!.stdin.write(JSON.stringify({ id, command, ...payload }) + '\n');
    });
  }
  capture(ownWindow: string) { return this.request<FocusContext>('capture', { ownWindow }); }
  paste(target: FocusContext) {
    if (!hasFocusTarget(target)) return Promise.resolve({ pasted: false, message: '未捕获到原窗口的键盘焦点。内容已复制，请在目标输入框重新按快捷键唤出。' });
    return this.request<{ pasted: boolean; message: string }>('paste', { window: target.window, control: target.control, process: target.process, elementKey: target.elementKey });
  }
  stop() { const child = this.child; this.child = undefined; this.ready = undefined; child?.kill(); for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Windows 输入辅助服务已停止，请重新唤出。')); } this.pending.clear(); }
}

import { contextBridge, ipcRenderer } from 'electron';
import type { ClipboardBridge, Snapshot } from '../shared/types';

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await ipcRenderer.invoke(`pasteboard:${channel}`, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value as T;
}
const bridge: ClipboardBridge = {
  platform: process.platform, isDesktop: true,
  getSnapshot: () => invoke('snapshot'),
  onChange(callback) {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => callback(snapshot);
    ipcRenderer.on('pasteboard:changed', listener);
    return () => ipcRenderer.removeListener('pasteboard:changed', listener);
  },
  capture: () => invoke('capture'), copy: (id, hide = false) => invoke('copy', id, hide),
  copyTranslation: id => invoke('copy-translation', id),
  paste: (id, translated = false) => invoke('paste', id, translated),
  pin: id => invoke('pin', id), remove: id => invoke('remove', id), clear: all => invoke('clear', all),
  createCategory: name => invoke('create-category', name), deleteCategory: id => invoke('delete-category', id),
  assignCategory: (id, categoryId) => invoke('assign-category', id, categoryId),
  saveSettings: settings => invoke('settings', settings), translate: (id, language) => invoke('translate', id, language),
  getImage: id => invoke('image', id), windowAction: action => invoke('window', action),
  setWindowMode: mode => invoke('window-mode', mode),
};
contextBridge.exposeInMainWorld('pasteboard', bridge);

import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, Tray } from 'electron';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { HistoryStore } from './store';
import { idSchema, languageSchema, settingsSchema } from './schema';
import { TranslationService } from './translation-service';
import { answerText, translateText } from './translate';
import { WindowsFocus, type FocusContext } from './windows-focus';
import { ClipboardShortcuts } from './shortcuts';
import { PopupSession } from './popup-session';
import { popupPosition } from '../shared/popup-position';
import { hasFocusTarget } from '../shared/focus-target';
import { apiBaseUrl, type AiResult, type Settings, type Snapshot } from '../shared/types';
import { classify } from '../shared/classify';

if (process.env.PASTEBOARD_USER_DATA) app.setPath('userData', process.env.PASTEBOARD_USER_DATA);
if (process.env.PASTEBOARD_DISABLE_GPU === '1') app.disableHardwareAcceleration();
const hasLock = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: HistoryStore;
let apiKey = '';
let quitting = false;
let lastFingerprint = '';
let timer: ReturnType<typeof setInterval> | undefined;
let focusTimer: ReturnType<typeof setInterval> | undefined;
let inserting = false;
let captureWarning: string | null = null;
let clipboardAi: Snapshot['clipboardAi'];
let aiJob: { controller: AbortController; sourceId: string } | undefined;
let windowMode: Snapshot['windowMode'] = 'compact';
let popupSession: PopupSession | null = null;
let focusService: WindowsFocus | null = null;
let focusError: string | null = null;
let opening = 0;
let openingPending = false;
let translations: TranslationService;
const pendingTranslations = new Map<string, Promise<unknown>>();
let clipboardQueue: Promise<unknown> = Promise.resolve();
const shortcuts = new ClipboardShortcuts(globalShortcut, process.platform, () => store.settings, toggleWindow, () => void typeClipboardText());
function withClipboard<T>(action: () => Promise<T>): Promise<T> {
  const pending = clipboardQueue.then(action);
  clipboardQueue = pending.catch(() => undefined);
  return pending;
}

function canSecurelyStoreKey() {
  return safeStorage.isEncryptionAvailable()
    && !(process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text');
}
function snapshot(): Snapshot {
  const focusTarget = popupSession?.target;
  return { windowMode, entries: store.entries, categories: store.categories, settings: store.settings,
    hasApiKey: Boolean(apiKey), keyStorage: canSecurelyStoreKey() ? 'secure' : 'session',
    ...shortcuts.status, warning: captureWarning || store.warning, clipboardAi,
    insertion: { supported: process.platform === 'win32' && !focusError, hasTarget: hasFocusTarget(focusTarget), caretLocated: Boolean(focusTarget?.caretLocated), message: focusError } };
}
function broadcast() {
  if (window && !window.isDestroyed()) window.webContents.send('pasteboard:changed', snapshot());
  updateTray();
}
function showWindow() {
  if (!window) return;
  if (windowMode === 'compact' && process.platform === 'win32') window.showInactive();
  else { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
}
function setWindowMode(mode: Snapshot['windowMode'], target: FocusContext | null = null, fallback = screen.getCursorScreenPoint()) {
  if (!window) return;
  windowMode = mode;
  popupSession?.end(); popupSession = null;
  if (mode === 'manager') { opening++; openingPending = false; if (process.platform === 'win32') globalShortcut.unregister('Escape'); }
  window.setFocusable(mode !== 'compact' || process.platform !== 'win32');
  window.setSkipTaskbar(mode === 'compact' && process.platform === 'win32');
  if (window.isMaximized()) window.unmaximize();
  window.setMinimumSize(mode === 'compact' ? 320 : 1060, mode === 'compact' ? 380 : 720);
  window.setResizable(mode === 'manager');
  window.setMaximizable(mode === 'manager');
  window.setAlwaysOnTop(mode === 'compact');
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  const width = Math.min(mode === 'compact' ? 400 : 1360, area.width);
  const height = Math.min(mode === 'compact' ? 580 : 900, area.height);
  if (mode === 'compact') popupSession = new PopupSession(window, compactBounds(target, fallback), target);
  else window.setBounds({ width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) });
  broadcast();
}
function ownWindowHandle() {
  const handle = window!.getNativeWindowHandle();
  return handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
}
function compactBounds(focusTarget: FocusContext | null, fallback: Electron.Point) {
  let anchor = { ...fallback, width: 1, height: 1 };
  if (focusTarget && (focusTarget.caretLocated || focusTarget.editable) && focusTarget.height > 0) {
    const top = screen.screenToDipPoint({ x: Math.round(focusTarget.x), y: Math.round(focusTarget.y) });
    const bottom = screen.screenToDipPoint({ x: Math.round(focusTarget.x + focusTarget.width), y: Math.round(focusTarget.y + focusTarget.height) });
    anchor = { ...top, width: Math.max(1, bottom.x - top.x), height: Math.max(1, bottom.y - top.y) };
  }
  return popupPosition(anchor, screen.getDisplayNearestPoint(anchor).workArea, 400, 580);
}
async function openCompact() {
  const generation = ++opening;
  openingPending = true;
  popupSession?.end(); popupSession = null; focusError = null;
  let focusTarget: FocusContext | null = null;
  // Capture the fallback before awaiting UI Automation; it remains fixed while open.
  const fallback = screen.getCursorScreenPoint();
  if (process.platform === 'win32' && windowMode === 'manager' && window?.isVisible()) {
    window.hide();
    await new Promise(resolve => setTimeout(resolve, 75));
    if (generation !== opening) return;
  }
  if (focusService && window) {
    try {
      let target = await focusService.capture(ownWindowHandle());
      if (!hasFocusTarget(target)) {
        await new Promise(resolve => setTimeout(resolve, 100));
        if (generation !== opening) return;
        target = await focusService.capture(ownWindowHandle());
      }
      if (generation !== opening) return;
      focusTarget = target;
    } catch (error) { focusError = error instanceof Error ? error.message : '无法读取输入光标。'; }
  }
  if (generation !== opening) return;
  openingPending = false; setWindowMode('compact', focusTarget, fallback); showWindow();
}
function toggleWindow() { if ((window?.isVisible() && windowMode === 'compact') || openingPending) { opening++; openingPending = false; window?.hide(); } else void openCompact(); }
async function typeClipboardText() {
  if (inserting || quitting || !focusService || !window || window.isFocused()) return;
  inserting = true;
  try {
    const shortcut = store.settings.typingShortcut;
    const [target, text] = await Promise.all([focusService.captureForTyping(ownWindowHandle()), clipboard.readText()]);
    await focusService.typeText(target, text, shortcut);
  } catch (error) {
    if (!quitting) tray?.displayBalloon({ title: '逐字输入', content: error instanceof Error ? error.message : '无法输入剪贴板文字。', noSound: true });
  } finally { inserting = false; }
}
function updateTray() {
  if (!tray) return;
  const { captureEnabled } = store.settings;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开剪贴板', click: openCompact },
    { label: '管理记录', click: () => { setWindowMode('manager'); showWindow(); } },
    { label: captureEnabled ? '暂停记录' : '继续记录', click: () => {
      void withClipboard(() => applySettings({ ...store.settings, captureEnabled: !store.settings.captureEnabled })).catch(reportCaptureError);
    } },
    { type: 'separator' }, { label: '退出', click: () => app.quit() },
  ]));
}
async function readBlob(items: Electron.ClipboardItem[], format: string): Promise<Blob | null> {
  const item = items.find(item => item.types.includes(format));
  if (!item) return null;
  const value = await item.getType(format);
  return 'arrayBuffer' in value ? value : null;
}
async function readFilePaths(items: Electron.ClipboardItem[]): Promise<string | null> {
  if (process.platform === 'win32') {
    for (const format of ['FileNameW', 'CF_HDROP']) {
      const blob = await readBlob(items, `electron application/osclipboard;format="${format}"`);
      if (!blob) continue;
      const buffer = Buffer.from(await blob.arrayBuffer());
      if (format === 'FileNameW') return buffer.toString('utf16le').split('\0').filter(Boolean).join('\n');
      if (buffer.length > 20) {
        const offset = buffer.readUInt32LE(0);
        if (offset >= 20 && offset < buffer.length) return buffer.subarray(offset).toString(buffer.readUInt32LE(16) ? 'utf16le' : 'latin1').split('\0').filter(Boolean).join('\n');
      }
    }
  }
  for (const format of ['text/uri-list', 'public.file-url']) {
    const blob = await readBlob(items, format) || await readBlob(items, `electron application/osclipboard;format="${format}"`);
    if (!blob) continue;
    const files = (await blob.text()).replace(/\0/g, '').split(/\r?\n/).filter(line => line.startsWith('file://'));
    if (files.length) return files.join('\n');
  }
  return null;
}
async function readClipboardContent() {
  const items = await clipboard.read();
  const formats = items.flatMap(item => item.types);
  const sensitive = formats.some(format => /ConcealedType|TransientType|passwordManagerHint|ExcludeClipboardContentFromMonitorProcessing/i.test(format));
  const historyHint = await readBlob(items, 'electron application/osclipboard;format="CanIncludeInClipboardHistory"');
  const excluded = historyHint && Buffer.from(await historyHint.arrayBuffer()).every(byte => byte === 0);
  if (sensitive || excluded) return { skipped: '已跳过被应用标记为敏感的内容' } as const;
  if (formats.some(format => /CF_HDROP|FileName[AW]?|FileGroupDescriptor|FileContents|NSFilenamesPboardType|public\.file-url|application\/x-moz-file/i.test(format)) || await readFilePaths(items)) return { skipped: '文件剪贴板内容不记录' } as const;
  const textBlob = await readBlob(items, 'text/plain');
  const text = textBlob ? await textBlob.text() : '';
  return { items, formats, text };
}
function textFingerprint(text: string) {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
}
function cancelClipboardAi() {
  aiJob?.controller.abort();
  aiJob = undefined;
  clipboardAi = undefined;
}
function startClipboardAi(text: string, sourceId: string, fingerprint: string, mode: AiResult, settings: Settings) {
  const controller = new AbortController();
  const job = { controller, sourceId };
  aiJob = job;
  clipboardAi = { state: 'working' };
  const result = mode === 'answer' ? answerText(text, settings, apiKey, controller.signal)
    : translateText(text, settings.targetLanguage, settings, apiKey, undefined, controller.signal).then(translation => translation.text);
  void result.then(content => withClipboard(async () => {
    if (aiJob !== job) return;
    const current = lastFingerprint === fingerprint ? await readClipboardContent().catch(() => null) : null;
    if (aiJob !== job) return;
    const entryId = store.addAiResult(content, mode);
    let clipboardUpdated = false;
    if (current?.text && textFingerprint(current.text) === fingerprint) {
      try {
        await clipboard.writeText(content);
        lastFingerprint = textFingerprint(content);
        clipboardUpdated = true;
      } catch { /* The saved result can still be copied from history. */ }
    }
    if (aiJob === job) clipboardAi = { state: 'ready', entryId, clipboardUpdated };
  })).catch(error => {
    if (aiJob === job) clipboardAi = { state: 'error', message: error instanceof Error ? error.message : 'AI 处理失败，请重试。' };
  }).finally(() => {
    if (aiJob === job) {
      aiJob = undefined;
      broadcast();
    }
  });
}
function clipboardChangedWithoutText() {
  lastFingerprint = '';
  if (clipboardAi?.state === 'ready' && clipboardAi.clipboardUpdated) {
    clipboardAi = { ...clipboardAi, clipboardUpdated: false };
    broadcast();
  }
}
async function capture(manual = false, allowAi = true) {
  const settings = store.settings;
  if (!settings.captureEnabled && !manual) return { captured: false, message: '已暂停记录' };
  const current = await readClipboardContent();
  if (current.skipped) {
    clipboardChangedWithoutText();
    return { captured: false, message: current.skipped };
  }
  const { items, formats, text } = current;
  if (text.trim()) {
    const fingerprint = textFingerprint(text);
    const changed = fingerprint !== lastFingerprint;
    if (!changed && !manual) return { captured: false, message: '剪贴板没有变化' };
    if (!changed && clipboardAi?.state === 'ready' && clipboardAi.clipboardUpdated) return { captured: false, message: '这段文字已保存到剪贴板历史' };
    if (classify(text) === 'path') {
      clipboardChangedWithoutText();
      return { captured: false, message: '文件路径不记录' };
    }
    if (changed) cancelClipboardAi();
    if (text.length > 100_000) { lastFingerprint = fingerprint; throw new Error('这段文字超过 100,000 字，未保存。'); }
    const sourceId = store.addText(text);
    lastFingerprint = fingerprint;
    if (sourceId && changed && allowAi && settings.captureEnabled && settings.clipboardAiMode !== 'off' && apiKey) {
      startClipboardAi(text, sourceId, fingerprint, settings.clipboardAiMode, settings);
    }
  } else {
    if (!settings.captureImages) {
      clipboardChangedWithoutText();
      return { captured: false, message: '图片记录未开启，可在设置中开启' };
    }
    const imageFormat = formats.find(format => format.startsWith('image/'));
    if (!imageFormat) {
      clipboardChangedWithoutText();
      return { captured: false, message: '剪贴板没有可保存的文字或图片' };
    }
    const blob = await readBlob(items, imageFormat);
    if (!blob) return { captured: false, message: '无法读取剪贴板图片' };
    const image = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()));
    if (image.isEmpty()) return { captured: false, message: '剪贴板图片为空' };
    const { width, height } = image.getSize();
    const png = image.toPNG();
    const fingerprint = createHash('sha256').update(png).digest('hex');
    if (fingerprint === lastFingerprint && !manual) return { captured: false, message: '剪贴板没有变化' };
    // Bound only the UI preview; preserve the original image at any size.
    const previewScale = Math.min(1, 400 / width, 225 / height);
    const thumbnail = image.resize({
      width: Math.max(1, Math.round(width * previewScale)),
      height: Math.max(1, Math.round(height * previewScale)),
    }).toDataURL();
    store.addImage(png, thumbnail, width, height);
    lastFingerprint = fingerprint;
    if (clipboardAi?.state === 'ready') clipboardAi = { ...clipboardAi, clipboardUpdated: false };
  }
  captureWarning = null; broadcast();
  return { captured: true, message: '已保存到剪贴板历史' };
}
function reportCaptureError(error: unknown) {
  const message = error instanceof Error ? error.message : '读取剪贴板失败';
  if (captureWarning !== message) { captureWarning = message; broadcast(); }
}
async function applySettings(settings: Settings, nextKey = apiKey, keyUpdate?: { encryptedKey: string | undefined }) {
  const previous = store.settings;
  const aiChanged = previous.captureEnabled !== settings.captureEnabled || previous.clipboardAiMode !== settings.clipboardAiMode
    || apiBaseUrl(previous.apiEndpoint) !== apiBaseUrl(settings.apiEndpoint) || previous.apiModel !== settings.apiModel
    || (settings.clipboardAiMode === 'translate' && previous.targetLanguage !== settings.targetLanguage) || nextKey !== apiKey;
  store.updateSettings(settings, keyUpdate);
  apiKey = nextKey;
  if (aiChanged) {
    cancelClipboardAi();
    if (settings.captureEnabled && settings.clipboardAiMode !== 'off' && apiKey) {
      // Record the clipboard already present when enabling a mode without sending it.
      await capture(false, false).catch(reportCaptureError);
    }
  }
  broadcast();
}
function handle(channel: string, handler: (...args: any[]) => unknown) {
  ipcMain.handle(`pasteboard:${channel}`, async (event, ...args) => {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: '拒绝未授权的请求。' };
    try { return { ok: true, value: await handler(...args) }; }
    catch (error) { return { ok: false, error: error instanceof z.ZodError ? error.issues[0]?.message || '输入无效。' : error instanceof Error ? error.message : '操作失败，请重试。' }; }
  });
}
async function writeEntry(id: string, translated: boolean) {
  const entry = store.require(id);
  if (translated && !entry.translation) throw new Error('这条记录还没有译文。');
  if (entry.kind === 'image' && !translated) {
    const png = store.readImage(id);
    await clipboard.write([new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png)], { type: 'image/png' }) })]);
    const imageBlob = await readBlob(await clipboard.read(), 'image/png');
    const copiedPng = imageBlob ? nativeImage.createFromBuffer(Buffer.from(await imageBlob.arrayBuffer())).toPNG() : png;
    lastFingerprint = createHash('sha256').update(copiedPng).digest('hex');
  } else {
    const content = translated ? entry.translation!.text : entry.content;
    await clipboard.writeText(content); lastFingerprint = textFingerprint(content);
  }
  cancelClipboardAi();
  store.recordCopy(id); broadcast();
}
function registerHandlers() {
  handle('snapshot', snapshot);
  handle('window-mode', async rawMode => {
    const mode = z.enum(['compact', 'manager']).parse(rawMode);
    if (mode === 'compact') { window?.hide(); await new Promise(resolve => setTimeout(resolve, 50)); await openCompact(); }
    else { setWindowMode(mode); showWindow(); }
  });
  handle('capture', () => withClipboard(() => capture(true)));
  handle('copy', (rawId, rawHide) => withClipboard(async () => {
    await writeEntry(idSchema.parse(rawId), false);
    if (z.boolean().parse(rawHide)) window?.hide();
  }));
  handle('paste', (rawId, rawTranslated) => withClipboard(async () => {
    if (windowMode !== 'compact') throw new Error('请从剪贴板小窗口选择要粘贴的词条。');
    if (inserting) throw new Error('正在输入文字，请稍后再粘贴。');
    inserting = true;
    try {
      await writeEntry(idSchema.parse(rawId), z.boolean().parse(rawTranslated));
      if (process.platform === 'win32' && store.settings.autoPaste) {
        const focusTarget = popupSession?.target;
        if (!focusService || !focusTarget) throw new Error('内容已复制。请先在输入框中按快捷键唤出剪贴板。');
        const result = await focusService.paste(focusTarget);
        if (!result.pasted) throw new Error(result.message);
        window?.hide(); return result;
      }
      window?.hide();
      return { pasted: false, message: process.platform === 'win32' ? '已复制到剪贴板' : '已复制；此平台请返回输入框手动粘贴' };
    } finally { inserting = false; }
  }));
  handle('pin', rawId => { store.togglePin(idSchema.parse(rawId)); broadcast(); });
  handle('copy-translation', rawId => withClipboard(async () => {
    const entry = store.require(idSchema.parse(rawId));
    if (!entry.translation) throw new Error('这条记录还没有译文。');
    await clipboard.writeText(entry.translation.text);
    lastFingerprint = textFingerprint(entry.translation.text);
    cancelClipboardAi();
    broadcast();
  }));
  handle('remove', rawId => {
    const id = idSchema.parse(rawId);
    store.remove(id);
    if (aiJob?.sourceId === id || (clipboardAi?.state === 'ready' && clipboardAi.entryId === id)) cancelClipboardAi();
    broadcast();
  });
  handle('clear', rawAll => { store.clear(z.boolean().parse(rawAll)); cancelClipboardAi(); broadcast(); });
  handle('create-category', rawName => { store.createCategory(z.string().parse(rawName)); broadcast(); });
  handle('delete-category', rawId => { store.deleteCategory(idSchema.parse(rawId)); broadcast(); });
  handle('assign-category', (rawId, rawCategoryId) => { store.assignCategory(idSchema.parse(rawId), idSchema.nullable().parse(rawCategoryId)); broadcast(); });
  handle('image', rawId => `data:image/png;base64,${store.readImage(idSchema.parse(rawId)).toString('base64')}`);
  handle('settings', rawSettings => withClipboard(async () => {
    const { apiKey: newKey, clearApiKey, ...settings } = settingsSchema.parse(rawSettings);
    const previous = store.settings;
    const endpointChanged = apiBaseUrl(previous.apiEndpoint) !== apiBaseUrl(settings.apiEndpoint);
    const nextKey = newKey || (clearApiKey || endpointChanged ? '' : apiKey);
    if (!nextKey) {
      if (settings.clipboardAiMode !== 'off' && settings.clipboardAiMode !== previous.clipboardAiMode) throw new Error('请先填写 API 密钥，再开启剪贴板 AI 模式。');
      settings.clipboardAiMode = 'off';
    }
    let encryptedKey: string | undefined;
    if (newKey && canSecurelyStoreKey()) encryptedKey = safeStorage.encryptString(newKey).toString('base64');
    try {
      shortcuts.prepare(settings, previous);
      await applySettings(settings, nextKey, newKey || clearApiKey || endpointChanged ? { encryptedKey } : undefined);
    } finally { shortcuts.releaseUnused(); }
  }));
  handle('translate', (rawId, rawLanguage) => {
    const id = idSchema.parse(rawId); const language = languageSchema.parse(rawLanguage); const entry = store.require(id);
    if (entry.kind === 'image') throw new Error('图片暂不支持文字识别，请选择文字记录进行翻译。');
    if (pendingTranslations.has(id)) return pendingTranslations.get(id);
    const pending = translations.translate(entry.content, language, store.settings, apiKey).then(translation => {
      store.setTranslation(id, translation); broadcast(); return translation;
    }).finally(() => pendingTranslations.delete(id));
    pendingTranslations.set(id, pending); return pending;
  });
  handle('window', rawAction => {
    switch (z.enum(['minimize', 'maximize', 'hide', 'quit']).parse(rawAction)) {
      case 'minimize': window?.minimize(); break;
      case 'maximize': if (windowMode === 'manager') { if (window?.isMaximized()) window.unmaximize(); else window?.maximize(); } break;
      case 'hide': window?.hide(); break;
      case 'quit': app.quit(); break;
    }
  });
}

async function createWindow() {
  window = new BrowserWindow({
    width: 400, height: 580, minWidth: 320, minHeight: 380, frame: false,
    resizable: false, maximizable: false, alwaysOnTop: true, hasShadow: true, focusable: process.platform !== 'win32', skipTaskbar: process.platform === 'win32',
    title: 'PasteBoard Plus', backgroundColor: '#f7f8fa', icon: join(app.getAppPath(), 'assets/icon.png'),
    show: false,
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  window.on('close', event => { if (!quitting) { event.preventDefault(); window?.hide(); } });
  window.on('show', () => {
    if (process.platform === 'win32' && windowMode === 'compact') globalShortcut.register('Escape', () => { opening++; openingPending = false; window?.hide(); });
  });
  window.on('hide', () => { popupSession?.end(); popupSession = null; if (process.platform === 'win32') globalShortcut.unregister('Escape'); });
  window.once('ready-to-show', () => void openCompact());
  const devUrl = process.env.PASTEBOARD_DEV_URL;
  if (!app.isPackaged && devUrl === 'http://localhost:5173') await window.loadURL(devUrl);
  else await window.loadFile(join(app.getAppPath(), 'dist/index.html'));
}

if (!hasLock) app.quit();
else {
  app.on('second-instance', openCompact);
  app.on('activate', openCompact);
  app.on('before-quit', () => { quitting = true; cancelClipboardAi(); if (timer) clearInterval(timer); if (focusTimer) clearInterval(focusTimer); globalShortcut.unregisterAll(); tray?.destroy(); focusService?.stop(); });
  void app.whenReady().then(async () => {
    app.setAppUserModelId('com.pasteboard.plus');
    store = new HistoryStore(app.getPath('userData'));
    if (store.encryptedKey && canSecurelyStoreKey()) {
      try { apiKey = safeStorage.decryptString(Buffer.from(store.encryptedKey, 'base64')); }
      catch { store.warning = '无法解密之前保存的 API 密钥，请在设置中重新输入。'; }
    }
    translations = new TranslationService(join(app.getAppPath(), 'dist/vocabulary/typelingo.json.gz'));
    if (process.platform === 'win32') {
      const base = app.getAppPath().endsWith('.asar') ? app.getAppPath() + '.unpacked' : app.getAppPath();
      focusService = new WindowsFocus(join(base, 'assets/windows'));
      void focusService.warm().catch(error => { focusError = error instanceof Error ? error.message : 'Windows 输入服务不可用。'; broadcast(); });
    }
    registerHandlers();
    shortcuts.prepare(store.settings);
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets/icon.png')).resize({ width: 22, height: 22 });
    tray = new Tray(icon); tray.setToolTip('PasteBoard Plus · 你的灵感中转站'); tray.on('click', toggleWindow); updateTray();
    await createWindow();
    let polling = false;
    const poll = async (allowAi = true) => {
      if (polling) return;
      polling = true;
      try { await withClipboard(() => capture(false, allowAi)); }
      catch (error) { reportCaptureError(error); }
      finally { polling = false; }
    };
    void poll(false); timer = setInterval(() => void poll(), 800);
    let following = false;
    focusTimer = setInterval(async () => {
      const session = popupSession;
      if (following || inserting || openingPending || windowMode !== 'compact' || !window?.isVisible() || !focusService || !session?.target || !hasFocusTarget(session.target)) return;
      following = true;
      try {
        const current = await focusService.capture(ownWindowHandle());
        if (inserting || openingPending || windowMode !== 'compact' || !window?.isVisible() || popupSession !== session) return;
        session.observe(current);
      } catch { /* Keep the original target; paste performs its own final validation. */ }
      finally { following = false; }
    }, 500);

  }).catch(error => { console.error('PasteBoard startup failed:', error instanceof Error ? error.message : 'Unknown error'); app.exit(1); });
}

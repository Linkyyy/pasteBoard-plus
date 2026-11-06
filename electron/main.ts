import { app, BrowserWindow, clipboard, ClipboardItem, globalShortcut, ipcMain, Menu, nativeImage, safeStorage, screen, Tray } from 'electron';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { HistoryStore } from './store';
import { idSchema, languageSchema, settingsSchema } from './schema';
import { TranslationService } from './translation-service';
import { WindowsFocus, type FocusContext } from './windows-focus';
import { popupPosition } from '../shared/popup-position';
import { hasFocusTarget } from '../shared/focus-target';
import type { Snapshot } from '../shared/types';
import { classify } from '../shared/classify';

if (process.env.PASTEBOARD_USER_DATA) app.setPath('userData', process.env.PASTEBOARD_USER_DATA);
if (process.env.PASTEBOARD_DISABLE_GPU === '1') app.disableHardwareAcceleration();
const hasLock = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: HistoryStore;
let apiKey = '';
let shortcutRegistered = false;
let quitting = false;
let lastFingerprint = '';
let timer: ReturnType<typeof setInterval> | undefined;
let focusTimer: ReturnType<typeof setInterval> | undefined;
let pasting = false;
let captureWarning: string | null = null;
let windowMode: Snapshot['windowMode'] = 'compact';
let focusTarget: FocusContext | null = null;
let focusService: WindowsFocus | null = null;
let focusError: string | null = null;
let opening = 0;
let openingPending = false;
let translations: TranslationService;
const pendingTranslations = new Map<string, Promise<unknown>>();
let clipboardQueue: Promise<unknown> = Promise.resolve();
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
  return { windowMode, entries: store.entries, categories: store.categories, settings: store.settings,
    hasApiKey: Boolean(apiKey), keyStorage: canSecurelyStoreKey() ? 'secure' : 'session',
    shortcutRegistered, warning: captureWarning || store.warning, insertion: { supported: process.platform === 'win32' && !focusError, hasTarget: hasFocusTarget(focusTarget), caretLocated: Boolean(focusTarget?.caretLocated), message: focusError } };
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
function setWindowMode(mode: Snapshot['windowMode']) {
  if (!window) return;
  windowMode = mode;
  if (mode === 'manager') { opening++; openingPending = false; focusTarget = null; if (process.platform === 'win32') globalShortcut.unregister('Escape'); }
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
  if (mode === 'compact') positionCompact();
  else window.setBounds({ width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) });
  broadcast();
}
function ownWindowHandle() {
  const handle = window!.getNativeWindowHandle();
  return handle.length >= 8 ? handle.readBigUInt64LE(0).toString() : String(handle.readUInt32LE(0));
}
function positionCompact() {
  if (!window) return;
  let anchor = { ...screen.getCursorScreenPoint(), width: 1, height: 1 };
  if (focusTarget && (focusTarget.caretLocated || focusTarget.editable) && focusTarget.height > 0) {
    const top = screen.screenToDipPoint({ x: Math.round(focusTarget.x), y: Math.round(focusTarget.y) });
    const bottom = screen.screenToDipPoint({ x: Math.round(focusTarget.x + focusTarget.width), y: Math.round(focusTarget.y + focusTarget.height) });
    anchor = { ...top, width: Math.max(1, bottom.x - top.x), height: Math.max(1, bottom.y - top.y) };
  }
  const bounds = popupPosition(anchor, screen.getDisplayNearestPoint(anchor).workArea, 400, 580);
  const current = window.getBounds();
  if (current.x !== bounds.x || current.y !== bounds.y || current.width !== bounds.width || current.height !== bounds.height) window.setBounds(bounds);
}
async function openCompact() {
  const generation = ++opening;
  openingPending = true;
  focusTarget = null; focusError = null;
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
  openingPending = false; setWindowMode('compact'); showWindow();
}
function toggleWindow() { if ((window?.isVisible() && windowMode === 'compact') || openingPending) { opening++; openingPending = false; window?.hide(); } else void openCompact(); }
function updateTray() {
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: '打开剪贴板', click: openCompact },
    { label: '管理记录', click: () => { setWindowMode('manager'); showWindow(); } },
    { label: store.settings.captureEnabled ? '暂停记录' : '继续记录', click: () => { store.updateSettings({ ...store.settings, captureEnabled: !store.settings.captureEnabled }); broadcast(); } },
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
async function capture(manual = false) {
  if (!store.settings.captureEnabled && !manual) return { captured: false, message: '已暂停记录' };
  const items = await clipboard.read();
  const formats = items.flatMap(item => item.types);
  const sensitive = formats.some(format => /ConcealedType|TransientType|passwordManagerHint|ExcludeClipboardContentFromMonitorProcessing/i.test(format));
  const historyHint = await readBlob(items, 'electron application/osclipboard;format="CanIncludeInClipboardHistory"');
  const excluded = historyHint && Buffer.from(await historyHint.arrayBuffer()).every(byte => byte === 0);
  if (sensitive || excluded) return { captured: false, message: '已跳过被应用标记为敏感的内容' };
  if (formats.some(format => /CF_HDROP|FileName[AW]?|FileGroupDescriptor|FileContents|NSFilenamesPboardType|public\.file-url|application\/x-moz-file/i.test(format))) return { captured: false, message: '文件剪贴板内容不记录' };
  const textBlob = await readBlob(items, 'text/plain');
  if (await readFilePaths(items)) return { captured: false, message: '文件剪贴板内容不记录' };
  const text = textBlob ? await textBlob.text() : '';
  if (text.trim()) {
    if (classify(text) === 'path') return { captured: false, message: '文件路径不记录' };
    const fingerprint = createHash('sha256').update(text).digest('hex');
    if (fingerprint === lastFingerprint && !manual) return { captured: false, message: '剪贴板没有变化' };
    if (text.length > 100_000) { lastFingerprint = fingerprint; throw new Error('这段文字超过 100,000 字，未保存。'); }
    store.addText(text); lastFingerprint = fingerprint;
  } else {
    if (!store.settings.captureImages) return { captured: false, message: '图片记录未开启，可在设置中开启' };
    if (!formats.some(format => /image|bitmap|png|tiff|dib/i.test(format))) return { captured: false, message: '剪贴板中没有可保存的文字或图片' };
    const imageFormat = formats.find(format => format.startsWith('image/'));
    if (!imageFormat) return { captured: false, message: '剪贴板没有可识别的图片' };
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
  }
  captureWarning = null; broadcast();
  return { captured: true, message: '已保存到剪贴板历史' };
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
    await clipboard.writeText(content); lastFingerprint = createHash('sha256').update(content).digest('hex');
  }
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
    await writeEntry(idSchema.parse(rawId), z.boolean().parse(rawTranslated));
    if (process.platform === 'win32' && store.settings.autoPaste) {
      if (!focusService || !focusTarget) throw new Error('内容已复制。请先在输入框中按快捷键唤出剪贴板。');
      pasting = true;
      try {
        const result = await focusService.paste(focusTarget);
        if (!result.pasted) throw new Error(result.message);
        window?.hide(); return result;
      } finally { pasting = false; }
    }
    window?.hide();
    return { pasted: false, message: process.platform === 'win32' ? '已复制到剪贴板' : '已复制；此平台请返回输入框手动粘贴' };
  }));
  handle('pin', rawId => { store.togglePin(idSchema.parse(rawId)); broadcast(); });
  handle('copy-translation', rawId => withClipboard(async () => {
    const entry = store.require(idSchema.parse(rawId));
    if (!entry.translation) throw new Error('这条记录还没有译文。');
    await clipboard.writeText(entry.translation.text);
    lastFingerprint = createHash('sha256').update(entry.translation.text).digest('hex');
    broadcast();
  }));
  handle('remove', rawId => { store.remove(idSchema.parse(rawId)); broadcast(); });
  handle('clear', rawAll => { store.clear(z.boolean().parse(rawAll)); broadcast(); });
  handle('create-category', rawName => { store.createCategory(z.string().parse(rawName)); broadcast(); });
  handle('delete-category', rawId => { store.deleteCategory(idSchema.parse(rawId)); broadcast(); });
  handle('assign-category', (rawId, rawCategoryId) => { store.assignCategory(idSchema.parse(rawId), idSchema.nullable().parse(rawCategoryId)); broadcast(); });
  handle('image', rawId => `data:image/png;base64,${store.readImage(idSchema.parse(rawId)).toString('base64')}`);
  handle('settings', rawSettings => {
    const { apiKey: newKey, clearApiKey, ...settings } = settingsSchema.parse(rawSettings);
    if (settings.shortcut === 'Super+V') throw new Error('Windows + V 由系统剪贴板占用，请选择其他组合。');
    let encryptedKey: string | undefined;
    if (newKey && canSecurelyStoreKey()) encryptedKey = safeStorage.encryptString(newKey).toString('base64');
    const previous = store.settings.shortcut;
    if (settings.shortcut !== previous || !shortcutRegistered) {
      let registered = false;
      try { registered = globalShortcut.register(settings.shortcut, toggleWindow); } catch { /* invalid or unavailable */ }
      if (!registered) throw new Error('这个快捷键已被占用或当前系统不支持，请更换组合。');
      if (settings.shortcut !== previous) globalShortcut.unregister(previous);
      shortcutRegistered = true;
    }
    if (clearApiKey) { apiKey = ''; store.setEncryptedKey(undefined); }
    if (newKey) { apiKey = newKey; store.setEncryptedKey(encryptedKey); }
    store.updateSettings(settings); broadcast();
  });
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
  window.on('hide', () => { if (process.platform === 'win32') globalShortcut.unregister('Escape'); });
  window.once('ready-to-show', () => void openCompact());
  const devUrl = process.env.PASTEBOARD_DEV_URL;
  if (!app.isPackaged && devUrl === 'http://localhost:5173') await window.loadURL(devUrl);
  else await window.loadFile(join(app.getAppPath(), 'dist/index.html'));
}

if (!hasLock) app.quit();
else {
  app.on('second-instance', openCompact);
  app.on('activate', openCompact);
  app.on('before-quit', () => { quitting = true; if (timer) clearInterval(timer); if (focusTimer) clearInterval(focusTimer); globalShortcut.unregisterAll(); tray?.destroy(); focusService?.stop(); });
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
    try { shortcutRegistered = globalShortcut.register(store.settings.shortcut, toggleWindow); } catch { shortcutRegistered = false; }
    const icon = nativeImage.createFromPath(join(app.getAppPath(), 'assets/icon.png')).resize({ width: 22, height: 22 });
    tray = new Tray(icon); tray.setToolTip('PasteBoard Plus · 你的灵感中转站'); tray.on('click', toggleWindow); updateTray();
    await createWindow();
    let polling = false;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try { await withClipboard(() => capture()); }
      catch (error) { const message = error instanceof Error ? error.message : '读取剪贴板失败'; if (captureWarning !== message) { captureWarning = message; broadcast(); } }
      finally { polling = false; }
    };
    void poll(); timer = setInterval(() => void poll(), 800);
    let following = false;
    focusTimer = setInterval(async () => {
      if (following || pasting || openingPending || windowMode !== 'compact' || !window?.isVisible() || !focusService || !focusTarget || !hasFocusTarget(focusTarget)) return;
      following = true;
      const previous = focusTarget;
      try {
        const current = await focusService.capture(ownWindowHandle());
        if (pasting || windowMode !== 'compact' || !window?.isVisible() || focusTarget !== previous) return;
        if (current.window !== previous.window || current.control !== previous.control || (previous.elementKey && current.elementKey !== previous.elementKey)) { focusTarget = null; window.hide(); return; }
        focusTarget = current; positionCompact();
      } catch { /* Keep the original target; paste performs its own final validation. */ }
      finally { following = false; }
    }, 500);

  }).catch(error => { console.error('PasteBoard startup failed:', error instanceof Error ? error.message : 'Unknown error'); app.exit(1); });
}

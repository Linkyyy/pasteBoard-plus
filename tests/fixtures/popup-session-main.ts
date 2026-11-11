import { app, BrowserWindow, screen } from 'electron';
import { PopupSession } from '../../electron/popup-session';
import type { FocusContext } from '../../electron/windows-focus';

app.disableHardwareAcceleration();
void app.whenReady().then(async () => {
  const area = screen.getPrimaryDisplay().workArea;
  const bounds = { x: area.x + 40, y: area.y + 40, width: 400, height: 580 };
  const window = new BrowserWindow({ ...bounds, frame: false, show: false, focusable: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const target: FocusContext = { window: '812', control: '813', process: 1200, elementKey: '42-1-2', editable: true, caretLocated: true, x: 100, y: 200, width: 1, height: 20 };
  let moves = 0;
  const host = { setBounds: (next: typeof bounds, animate?: boolean) => { moves++; window.setBounds(next, animate); }, hide: () => window.hide() };
  let session = new PopupSession(host, bounds, target);
  Object.assign(globalThis, { popupRegression: {
    state: () => ({ bounds: window.getBounds(), visible: window.isVisible(), moves }),
    sample: (value: FocusContext) => session.observe(value),
    drag: () => window.setPosition(area.x + 100, area.y + 80, false),
    reopen: () => { session.end(); session = new PopupSession(host, { ...bounds, x: area.x + 200, y: area.y + 100 }, target); window.showInactive(); },
  } });
  await window.loadURL('data:text/html;charset=utf-8,<title>Clipboard position regression fixture</title><p>Isolated popup placement test</p>');
  window.showInactive();
});

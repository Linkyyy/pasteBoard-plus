import { createServer } from 'vite';
import { spawn } from 'node:child_process';

// Start the renderer first, then Electron. The desktop process is restarted on main/preload edits.
const server = await createServer();
await server.listen();
await import('./build-electron.mjs');
const { default: electron } = await import('electron');
let child;
let restarting = false;
function launch() {
  child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env, PASTEBOARD_DEV_URL: 'http://localhost:5173' } });
  child.on('exit', async () => { if (!restarting) { await server.close(); process.exit(0); } });
}
launch();
// The renderer already has Vite HMR; restart desktop with Ctrl+C / npm run dev after main-process edits.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { restarting = true; child?.kill(); void server.close().then(() => process.exit(0)); });

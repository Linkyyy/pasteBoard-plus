import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const args = process.argv.slice(2).filter((arg, index) => index !== 0 || arg !== '--');
if (!args.length) throw new Error('Usage: node scripts/with-display.mjs -- <command> [args]');
let server;
let directory;
let display = process.env.DISPLAY;
const executable = name => (process.env.PATH || '').split(delimiter).map(path => join(path, name)).find(path => existsSync(path));
try {
  if (process.platform === 'linux' && !display) {
    const xvfb = executable('Xvfb');
    const xorg = executable('Xorg');
    if (!xvfb && !xorg) throw new Error('Install Xvfb (recommended) or Xorg with the dummy video driver to run desktop checks without a display.');
    let number = 90;
    while (existsSync(`/tmp/.X11-unix/X${number}`) || existsSync(`/tmp/.X${number}-lock`)) number++;
    display = `:${number}`;
    directory = await mkdtemp(join(tmpdir(), 'pasteboard-display-'));
    await mkdir('/tmp/.X11-unix', { recursive: true });
    const config = join(directory, 'xorg.conf');
    await writeFile(config, `Section "ServerFlags"
 Option "AutoAddDevices" "false"
 Option "AutoEnableDevices" "false"
 Option "DontVTSwitch" "true"
EndSection
Section "Device"
 Identifier "Dummy"
 Driver "dummy"
 VideoRam 256000
EndSection
Section "Monitor"
 Identifier "Monitor"
 HorizSync 5.0-1000.0
 VertRefresh 5.0-200.0
 Modeline "1440x1000" 120.00 1440 1488 1520 1600 1000 1003 1009 1040
EndSection
Section "Screen"
 Identifier "Screen"
 Device "Dummy"
 Monitor "Monitor"
 DefaultDepth 24
 SubSection "Display"
  Depth 24
  Modes "1440x1000"
 EndSubSection
EndSection\n`);
    const serverArgs = xvfb ? [display, '-screen', '0', '1440x1000x24', '-noreset', '-nolisten', 'tcp'] : [display, '-config', config, '-noreset', '-nolisten', 'tcp', '-logfile', join(directory, 'xorg.log')];
    server = spawn(xvfb || xorg, serverArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    server.stdout.on('data', chunk => { output = (output + chunk).slice(-5000); });
    server.stderr.on('data', chunk => { output = (output + chunk).slice(-5000); });
    const deadline = Date.now() + 10_000;
    while (!existsSync(`/tmp/.X11-unix/X${number}`)) {
      if (server.exitCode !== null || Date.now() > deadline) throw new Error(`Virtual display failed to start:\n${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    console.log(`Virtual desktop ready on ${display} (local Unix socket only).`);
  }
  const child = spawn(args[0], args.slice(1), { stdio: 'inherit', env: { ...process.env, ...(display ? { DISPLAY: display } : {}), PASTEBOARD_DISABLE_GPU: '1' } });
  const stop = () => child.kill('SIGTERM');
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => resolve(code ?? 1)); });
  process.exitCode = code;
} finally {
  if (server && server.exitCode === null) { const stopped = new Promise(resolve => server.once('exit', resolve)); server.kill('SIGTERM'); await stopped; }
  if (directory) await rm(directory, { recursive: true, force: true });
}

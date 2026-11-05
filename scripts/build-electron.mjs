import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

await build({ entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron', 'undici'], sourcemap: true });
await build({ entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', bundle: true, platform: 'node', target: 'node24', format: 'cjs', external: ['electron'] });

// A tiny, dependency-free PNG icon, also suitable for the system tray.
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const tag = Buffer.from(type); const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([size, tag, data, crc]);
}
const size = 256;
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const offset = y * (size * 4 + 1) + 1 + x * 4;
  const outer = x >= 12 && x < 244 && y >= 12 && y < 244;
  const back = x >= 64 && x < 153 && y >= 56 && y < 176;
  const front = x >= 98 && x < 192 && y >= 90 && y < 207;
  const line = front && x >= 120 && x < 171 && [125, 149, 173].some(row => y >= row && y < row + 8);
  const color = front && !line ? [255, 255, 255] : back && !front ? [250, 192, 157] : [239, 130, 71];
  raw.set([...color, outer ? 255 : 0], offset);
}
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
await mkdir('assets', { recursive: true });
await writeFile('assets/icon.png', Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));

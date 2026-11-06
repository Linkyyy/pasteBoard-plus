import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { extractFile, listPackage } from '@electron/asar';

const root = resolve(process.argv[2] || 'release/win-unpacked');
const archive = join(root, 'resources/app.asar');
const files = listPackage(archive);
for (const required of ['/dist/index.html', '/dist-electron/main.cjs', '/dist-electron/preload.cjs', '/assets/icon.png', '/node_modules/undici/package.json']) {
  assert(files.includes(required), `Missing runtime file: ${required}`);
}
for (const name of ['react', 'react-dom', 'lucide-react', 'scheduler', 'zod', 'electron', 'typescript', 'vite']) {
  assert(!files.some(file => file.startsWith(`/node_modules/${name}/`)), `Build-only dependency duplicated in package: ${name}`);
}
assert(!files.some(file => file.endsWith('.map')), 'Debug source maps must stay out of release packages');
const locales = (await readdir(join(root, 'locales'))).filter(file => file.endsWith('.pak')).sort();
assert.deepEqual(locales, ['en-US.pak', 'zh-CN.pak']);
const product = JSON.parse(extractFile(archive, 'package.json').toString());
const project = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(product.version, project.version);
console.log(`Package verified: version ${product.version}, runtime dependencies present, no duplicated frontend dependencies or source maps.`);
console.log(`Application archive: ${((await stat(archive)).size / 1024 / 1024).toFixed(2)} MiB; Chromium locales: ${locales.join(', ')}`);

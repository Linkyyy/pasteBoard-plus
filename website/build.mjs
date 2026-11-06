import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const release = JSON.parse(await readFile(join(directory, 'release.json'), 'utf8'));
const product = JSON.parse(await readFile(join(directory, '../package.json'), 'utf8'));
if (release.version !== product.version) throw new Error('Update website/release.json to match the published desktop release.');
const base = `${release.repository}/raw/refs/tags/v${release.version}/installers`;
const replacements = {
  VERSION: release.version, REPOSITORY: release.repository,
  INSTALLER: `${base}/PasteBoard-Plus-Setup-${release.version}-x64.exe`,
  PORTABLE: `${base}/PasteBoard-Plus-${release.version}-win-x64.zip`,
  CHECKSUMS: `${base}/SHA256SUMS.txt`,
  INSTALLER_SIZE: release.installerSize, PORTABLE_SIZE: release.portableSize,
};
const output = join(directory, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(join(directory, 'public'), output, { recursive: true });
await cp(join(directory, '../public/icon.svg'), join(output, 'icon.svg'));
const template = await readFile(join(directory, 'public/index.html'), 'utf8');
const html = template.replace(/\{\{([A-Z_]+)\}\}/g, (_, token) => {
  if (!(token in replacements)) throw new Error(`Unknown template token ${token}`);
  return replacements[token];
});
await writeFile(join(output, 'index.html'), html);
await writeFile(join(output, 'release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`Built PasteBoard Plus website for v${release.version}. Output: website/dist; no runtime dependencies.`);

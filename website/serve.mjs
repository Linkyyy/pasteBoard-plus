import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import './build.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'dist');
const deployment = JSON.parse(await readFile(resolve(root, '../../vercel.json'), 'utf8'));
const securityHeaders = Object.fromEntries(deployment.headers[0].headers.map(({ key, value }) => [key, value]));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.png': 'image/png' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) throw new Error('Not found');
    response.writeHead(200, { ...securityHeaders, 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/html; charset=utf-8' });
    response.end(await readFile(resolve(root, '404.html')));
  }
});
const port = Number(process.env.PORT || 4174);
server.listen(port, '0.0.0.0', () => console.log(`Website server listening on port ${port}.`));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => process.exit(0)));

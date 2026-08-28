import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(root, 'api-runtime');
if (path.dirname(target) !== root || path.basename(target) !== 'api-runtime') throw new Error('Invalid API build output');
await mkdir(target, { recursive: true });
await cp(path.join(root, 'node_modules/dailyhot-api/dist'), target, { recursive: true });
await writeFile(path.join(target, 'utils/cache.js'), await readFile(path.join(root, 'cache-adapter.mjs')));
await cp(path.join(root, 'node_modules/dailyhot-api/LICENSE'), path.join(target, 'LICENSE'));
console.log('[dailyhot] Local API prepared with isolated in-memory cache (no Redis).');

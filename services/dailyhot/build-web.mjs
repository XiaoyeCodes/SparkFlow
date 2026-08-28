import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { NaiveUiResolver } from 'unplugin-vue-components/resolvers';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const upstream = path.join(root, 'node_modules/dailyhot-web');
await build({
  configFile: false,
  root: upstream,
  envDir: path.join(root, 'no-env-files'),
  base: '/',
  css: { postcss: { plugins: [] } },
  plugins: [
    vue(),
    // The pinned frontend is an npm dependency. These plugins otherwise skip
    // every node_modules path, leaving ref/watch and Naive UI unresolved.
    AutoImport({ include: [/[\\/]dailyhot-web[\\/]src[\\/].+\.(vue|js)(\?.*)?$/], exclude: [], dts: false, imports: ['vue', { 'naive-ui': ['useDialog', 'useMessage', 'useNotification', 'useLoadingBar'] }] }),
    Components({ include: [/[\\/]dailyhot-web[\\/]src[\\/].+\.vue(\?.*)?$/], exclude: [], dts: false, resolvers: [NaiveUiResolver()] })
  ],
  resolve: { alias: { '@': path.join(upstream, 'src') } },
  define: {
    'import.meta.env.VITE_GLOBAL_API': JSON.stringify('/api'),
    'import.meta.env.VITE_ICP': JSON.stringify(''),
    'import.meta.env.VITE_DIR': JSON.stringify('/'),
    'process.env.NODE_ENV': JSON.stringify('production')
  },
  // No upstream PWA registration: the managed local app must not install a
  // service worker that can retain an obsolete API endpoint or stale bundles.
  build: { outDir: path.join(root, 'web-dist'), emptyOutDir: true, minify: 'esbuild', chunkSizeWarningLimit: 1600 },
  logLevel: 'warn'
});
const hash = createHash('sha256');
for (const file of ['package.json', 'package-lock.json', 'build-web.mjs', 'prepare-api.mjs', 'cache-adapter.mjs']) hash.update(await readFile(path.join(root, file)));
await writeFile(path.join(root, 'web-dist/.build-hash'), hash.digest('hex'));
console.log('[dailyhot] Local frontend built; API endpoint: /api');

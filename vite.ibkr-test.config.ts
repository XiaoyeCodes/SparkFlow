import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// UI-only host: no production API plugins, subprocesses, or broker adapters.
export default defineConfig({
  plugins: [react()],
  cacheDir: 'node_modules/.vite-ibkr-test',
  server: { host: '127.0.0.1', port: 5187, strictPort: true, watch: { ignored: ['**/test-results/**', '**/docs/design/ibkr/screenshots/**', '**/.sparkflow/**', '**/services/**', '**/output/**', '**/tmp/**'] } },
});

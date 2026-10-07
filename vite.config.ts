import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

// Two pages: the PC display (display.html) and the phone app (index.html).
export default defineConfig({
  root: resolve(import.meta.dirname, 'src/web'),
  publicDir: resolve(import.meta.dirname, 'src/web/public'),
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION ?? pkg.version),
  },
  build: {
    outDir: resolve(import.meta.dirname, 'out/web'),
    emptyOutDir: true,
    target: 'es2022',
    rolldownOptions: {
      input: {
        index: resolve(import.meta.dirname, 'src/web/index.html'),
        display: resolve(import.meta.dirname, 'src/web/display.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Pages are proxied through the app server (port 41234); HMR connects to Vite directly.
    hmr: { host: '127.0.0.1', clientPort: 5173 },
  },
});

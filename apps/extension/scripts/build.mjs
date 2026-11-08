// Build extension vào dist/:
//  1. side panel (HTML) + background service worker (ES module)
//  2. content script dạng IIFE (content script không hỗ trợ import ES module)
import { resolve } from 'node:path';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'dist');

await build({
  root: resolve(root, 'src'),
  publicDir: resolve(root, 'public'),
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: true,
    target: 'chrome116',
    modulePreload: false,
    rollupOptions: {
      input: {
        sidepanel: resolve(root, 'src/sidepanel/index.html'),
        background: resolve(root, 'src/background/index.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});

await build({
  configFile: false,
  logLevel: 'warn',
  build: {
    outDir,
    emptyOutDir: false,
    target: 'chrome116',
    lib: {
      entry: resolve(root, 'src/content/index.ts'),
      formats: ['iife'],
      name: 'SafeChatContent',
      fileName: () => 'content.js',
    },
  },
});

console.log('Đã build extension vào', outDir);

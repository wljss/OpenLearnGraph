import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defineConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);

export const pdfWorkerPlugin: Plugin = {
  name: 'emit-pdfjs-worker',
  generateBundle() {
    this.emitFile({
      type: 'asset',
      fileName: 'pdf.worker.mjs',
      source: readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')),
    });
  },
};

export default defineConfig({
  plugins: [pdfWorkerPlugin],
  build: {
    sourcemap: true,
    rollupOptions: { output: { entryFileNames: 'main.js' } },
  },
});

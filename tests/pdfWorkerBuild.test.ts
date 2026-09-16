// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { pdfWorkerPlugin } from '../vite.main.config.mjs';

const require = createRequire(import.meta.url);

describe('PDF.js worker packaging', () => {
  it('emits the matching worker alongside the main-process bundle', () => {
    const emitFile = vi.fn();
    const hook = pdfWorkerPlugin.generateBundle;
    expect(typeof hook).toBe('function');
    if (typeof hook !== 'function') return;

    Reflect.apply(hook, { emitFile }, []);
    expect(emitFile).toHaveBeenCalledOnce();
    const emitted = emitFile.mock.calls[0]?.[0] as {
      type: string;
      fileName: string;
      source: Buffer;
    };
    expect(emitted.type).toBe('asset');
    expect(emitted.fileName).toBe('pdf.worker.mjs');
    const source = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'));
    expect(createHash('sha256').update(emitted.source).digest('hex'))
      .toBe(createHash('sha256').update(source).digest('hex'));
  });
});

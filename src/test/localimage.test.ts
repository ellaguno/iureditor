// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { generateJSON, generateHTML } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { LocalImage, setImageBaseDir } from '../extensions/localImage';
import { markdownToHtml, buildTurndownService } from '../lib/markdown';

// Simula el runtime de Tauri: convertFileSrc delega en __TAURI_INTERNALS__.
beforeAll(() => {
  (window as any).__TAURI_INTERNALS__ = {
    convertFileSrc: (path: string, protocol = 'asset') =>
      `${protocol}://localhost/${encodeURIComponent(path)}`,
  };
});

const EXTENSIONS = [StarterKit, LocalImage];

describe('LocalImage: round-trip de imágenes relativas', () => {
  it('resuelve src relativo a asset:// al renderizar y conserva la ruta al guardar', async () => {
    await setImageBaseDir('/home/user/docs');

    const md = 'Texto con imagen: ![logo](assets/logo.png)';
    const json = generateJSON(markdownToHtml(md), EXTENSIONS);
    const html = generateHTML(json, EXTENSIONS);

    // El DOM muestra la URL del asset protocol…
    expect(html).toContain('asset://localhost/');
    expect(html).toContain(encodeURIComponent('/home/user/docs/assets/logo.png'));
    // …y conserva la ruta original para el guardado
    expect(html).toContain('data-orig-src="assets/logo.png"');

    // Al guardar, Turndown emite la ruta relativa, no la URL resuelta
    const saved = buildTurndownService().turndown(html);
    expect(saved).toContain('![logo](assets/logo.png)');
    expect(saved).not.toContain('asset://');
  });

  it('reabrir un doc guardado reproduce el mismo modelo (segunda vuelta)', async () => {
    await setImageBaseDir('/home/user/docs');
    const md = '![logo](assets/logo.png)';
    const once = buildTurndownService().turndown(
      generateHTML(generateJSON(markdownToHtml(md), EXTENSIONS), EXTENSIONS)
    );
    const twice = buildTurndownService().turndown(
      generateHTML(generateJSON(markdownToHtml(once), EXTENSIONS), EXTENSIONS)
    );
    expect(twice).toContain('![logo](assets/logo.png)');
  });

  it('no toca URLs absolutas ni data URLs', async () => {
    await setImageBaseDir('/home/user/docs');
    const html = generateHTML(
      generateJSON(markdownToHtml('![x](https://example.com/a.png)'), EXTENSIONS),
      EXTENSIONS
    );
    expect(html).toContain('src="https://example.com/a.png"');
  });
});

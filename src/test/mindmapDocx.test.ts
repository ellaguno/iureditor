// @vitest-environment jsdom
// Export DOCX de un mapa mental: va el diagrama (render mermaid → PNG en
// Rust), no la lista. Mermaid y el comando de Tauri se simulan: aquí se
// valida que se dibuja el código correcto y que entra una imagen.
import { describe, it, expect, vi } from 'vitest';
import { Packer } from 'docx';

const renderFullSizeDiagram = vi.fn(async (_code: string) => '<svg/>');
vi.mock('../lib/mermaid', () => ({ renderFullSizeDiagram }));

// PNG 1×1 transparente.
const PNG_1X1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => PNG_1X1) }));

// jsdom no carga imágenes: <img> que "carga" al asignarle src (exportDocx
// mide el PNG con él).
class LoadingImage {
  naturalWidth = 1;
  naturalHeight = 1;
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_url: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}
vi.stubGlobal('Image', LoadingImage);

const { buildDocxDocument } = await import('../lib/exportDocx');

describe('export DOCX: mapa mental', () => {
  it('sustituye el callout por la imagen del mapa', async () => {
    const doc = await buildDocxDocument(
      {
        type: 'doc',
        content: [
          {
            type: 'callout',
            attrs: { type: 'mindmap' },
            content: [
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Rama' }] }],
                  },
                ],
              },
            ],
          },
        ],
      },
      null,
      'Mi nota'
    );
    expect(renderFullSizeDiagram).toHaveBeenCalledWith(
      '---\nconfig:\n  layout: tidy-tree\n---\nmindmap\n  Mi nota\n    Rama'
    );

    const blob = await Packer.toBlob(doc);
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:drawing>');
    // La lista no se duplica como texto.
    expect(xml).not.toContain('>Rama<');
  });
});

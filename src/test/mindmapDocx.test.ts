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

const mindmapDoc = (view: string | null) => ({
  type: 'doc',
  content: [
    {
      type: 'callout',
      attrs: { type: 'mindmap', view },
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
});

const documentXml = async (view: string | null) => {
  const doc = await buildDocxDocument(mindmapDoc(view), null, 'Mi nota');
  const blob = await Packer.toBlob(doc);
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file('word/document.xml')!.async('string');
};

describe('export DOCX: mapa mental', () => {
  it('dibuja el código del mapa', async () => {
    await documentXml('map');
    expect(renderFullSizeDiagram).toHaveBeenCalledWith(
      '---\nconfig:\n  layout: tidy-tree\n---\nmindmap\n  Mi nota\n    Rama'
    );
  });

  it('sólo mapa: la imagen sin la lista', async () => {
    const xml = await documentXml('map');
    expect(xml).toContain('<w:drawing>');
    expect(xml).not.toContain('>Rama<');
  });

  it('debajo (por omisión): la lista y luego el mapa', async () => {
    const xml = await documentXml(null);
    expect(xml.indexOf('>Rama<')).toBeGreaterThan(0);
    expect(xml.indexOf('<w:drawing>')).toBeGreaterThan(xml.indexOf('>Rama<'));
    expect(xml).not.toContain('<w:tbl>');
  });

  it('derecha: tabla sin bordes con la lista y el mapa lado a lado', async () => {
    const xml = await documentXml('right');
    const tbl = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>'));
    expect(tbl).toContain('>Rama<');
    expect(tbl).toContain('<w:drawing>');
    expect(tbl.indexOf('>Rama<')).toBeLessThan(tbl.indexOf('<w:drawing>'));
  });
});

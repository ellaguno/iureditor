// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { Packer } from 'docx';
import { buildDocxDocument } from '../lib/exportDocx';
import type { PMNode } from '../lib/exportDocx';

// JSON ProseMirror representativo (sin imágenes ni mermaid: esos requieren
// el runtime de Tauri/webview; aquí validamos estructura del OOXML).
const DOC: PMNode = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Título' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Texto con ' },
        { type: 'text', text: 'negrita', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' y ' },
        {
          type: 'text',
          text: 'un enlace',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    },
    {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableHeader',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Columna A' }] },
              ],
            },
            {
              type: 'tableHeader',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'Columna B' }] },
              ],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'celda con contenido largo' }] },
              ],
            },
            {
              type: 'tableCell',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: '42' }] }],
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Primero' }] },
          ],
        },
        {
          type: 'listItem',
          content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'Segundo' }] },
          ],
        },
      ],
    },
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hecho' }] }],
        },
      ],
    },
    {
      type: 'codeBlock',
      attrs: { language: 'python' },
      content: [{ type: 'text', text: 'def hola():\n    return 42' }],
    },
    {
      type: 'blockquote',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cita' }] }],
    },
  ],
};

describe('export DOCX (mapper ProseMirror → docx)', () => {
  it('genera un DOCX válido con tabla a ancho completo, listas y código', async () => {
    const doc = await buildDocxDocument(DOC, null, 'test');
    const blob = await Packer.toBlob(doc);
    expect(blob.size).toBeGreaterThan(2000);

    // Inspecciona el document.xml dentro del zip
    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    const xml = await zip.file('word/document.xml')!.async('string');

    // Tabla a ancho completo (pct), no auto-colapsada
    expect(xml).toMatch(/<w:tblW [^>]*w:type="pct"/);
    expect(xml).toContain('celda con contenido largo');
    // Encabezado con negrita y sombreado
    expect(xml).toMatch(/<w:shd [^>]*w:fill="F3F4F6"/);
    // Lista numerada usa numbering
    expect(xml).toContain('<w:numPr>');
    // Checkbox de task list
    expect(xml).toContain('☑');
    // Código en monoespaciada
    expect(xml).toMatch(/w:ascii="Consolas"/);
    // Hipervínculo externo
    expect(xml).toContain('<w:hyperlink');
  });
});

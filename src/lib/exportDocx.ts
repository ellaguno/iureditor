import type { Editor } from '@tiptap/react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';
import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { buildExportHtml } from './exportHtml';

/**
 * Export a DOCX 100% local: HTML del editor (mermaid rasterizado a PNG,
 * imágenes locales como data URLs) → @turbodocx/html-to-docx (OOXML real,
 * compatible con Word y LibreOffice) → dialog.save + fs.
 */
export const exportToDocx = async (editor: Editor, filePath: string | null): Promise<void> => {
  const { html, title } = await buildExportHtml(editor, filePath, { mermaidAs: 'png' });

  const path = await save({
    defaultPath: `${title}.docx`,
    filters: [{ name: 'Word', extensions: ['docx'] }],
  });
  if (!path) return;

  const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${html}</body></html>`;

  const result = await HTMLtoDOCX(fullHtml, null, {
    title,
    orientation: 'portrait',
    margins: { top: 1134, right: 1134, bottom: 1134, left: 1134 }, // 2cm en twips
    font: 'Calibri',
    fontSize: 22, // half-points → 11pt
    table: { row: { cantSplit: true } },
    footer: false,
    pageNumber: false,
  });

  let bytes: Uint8Array;
  if (result instanceof Blob) {
    bytes = new Uint8Array(await result.arrayBuffer());
  } else if (result instanceof ArrayBuffer) {
    bytes = new Uint8Array(result);
  } else {
    // Buffer de Node (por si el bundle resuelve la build de node)
    bytes = new Uint8Array(result as unknown as ArrayBufferLike);
  }

  await writeFile(path, bytes);
};

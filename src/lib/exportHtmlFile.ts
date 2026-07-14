import type { Editor } from '@tiptap/react';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import { buildExportHtml } from './exportHtml';

// CSS embebido para el HTML exportado: autosuficiente, sin dependencias.
const EXPORT_CSS = `
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto,
      'Helvetica Neue', Arial, sans-serif;
    color: #1f2937;
    line-height: 1.65;
    max-width: 820px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
  }
  h1, h2, h3, h4, h5, h6 { color: #111827; line-height: 1.25; margin: 1.6em 0 0.6em; }
  h1 { font-size: 2em; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #f3f4f6; padding-bottom: 0.25em; }
  h3 { font-size: 1.25em; }
  p { margin: 0.7em 0; }
  a { color: #0369a1; }
  code {
    background: #f3f4f6;
    border-radius: 4px;
    padding: 0.15em 0.35em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.9em;
    color: #be185d;
  }
  pre {
    background: #1f2937;
    color: #f9fafb;
    border-radius: 8px;
    padding: 1em;
    overflow-x: auto;
  }
  pre code { background: none; color: inherit; padding: 0; font-size: 0.85em; }
  blockquote {
    border-left: 4px solid #d1d5db;
    margin: 1em 0;
    padding: 0.25em 1em;
    color: #4b5563;
  }
  table { border-collapse: collapse; margin: 1em 0; width: 100%; }
  th, td { border: 1px solid #d1d5db; padding: 0.5em 0.75em; text-align: left; }
  th { background: #f9fafb; }
  img { max-width: 100%; height: auto; }
  hr { border: none; border-top: 1px solid #e5e7eb; margin: 2em 0; }
  ul, ol { padding-left: 1.5em; }
  ul[data-type="taskList"] { list-style: none; padding-left: 0.25em; }
  ul[data-type="taskList"] li { display: flex; gap: 0.5em; align-items: baseline; }
  .mermaid-diagram { display: flex; justify-content: center; margin: 1.5em 0; overflow-x: auto; }
  .mermaid-diagram svg { max-width: 100%; height: auto; }
  @media print {
    body { max-width: none; padding: 0; }
    pre, table, .mermaid-diagram, img { break-inside: avoid; }
    h1, h2, h3, h4 { break-after: avoid; }
  }
`;

/**
 * Export a HTML autosuficiente (mermaid como SVG vectorial inline, imágenes
 * locales como data URLs, CSS embebido). Es el mismo HTML intermedio del
 * pipeline de PDF, empaquetado como archivo.
 */
export const exportToHtmlFile = async (
  editor: Editor,
  filePath: string | null
): Promise<void> => {
  const { html, title } = await buildExportHtml(editor, filePath, { mermaidAs: 'svg' });

  const path = await save({
    defaultPath: `${title}.html`,
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (!path) return;

  const doc = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${EXPORT_CSS}</style>
</head>
<body>
${html}
</body>
</html>
`;

  await writeTextFile(path, doc);
};

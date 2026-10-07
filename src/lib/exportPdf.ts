import type { Editor } from '@tiptap/react';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { listen, emitTo, once } from '@tauri-apps/api/event';
import { buildExportHtml } from './exportHtml';
import { parseFrontMatterFields } from './markdown';
import { dirname, inDir } from './fileio';

const PREVIEW_LABEL = 'print-preview';
export const EVT_PREVIEW_READY = 'print-preview:ready';
export const EVT_PREVIEW_CONTENT = 'print-preview:content';

export interface PreviewPayload {
  html: string;
  title: string;
  /** Campos del front matter (título, expediente…) para el encabezado. */
  fields: Record<string, string>;
  /** Ruta sugerida para «Guardar PDF»: junto al .md, con su mismo nombre. */
  defaultPath: string;
}

/**
 * Export a PDF vía ventana de vista previa. «Guardar PDF» escribe el archivo
 * directo con la API nativa de cada webview (comando `save_pdf`, ver
 * src-tauri/src/pdf.rs; Tauri/wry no lo ofrecen, wry#707); «Imprimir…» abre
 * el diálogo del sistema. Fidelidad completa: texto seleccionable y mermaid
 * vectorial. La ventana debe ser VISIBLE — las webviews ocultas no imprimen.
 */
export const exportToPdf = async (
  editor: Editor,
  filePath: string | null,
  frontMatter = '',
  defaultDir?: string | null
): Promise<void> => {
  const { html, title } = await buildExportHtml(editor, filePath, { mermaidAs: 'svg' });
  const payload: PreviewPayload = {
    html,
    title,
    fields: parseFrontMatterFields(frontMatter),
    defaultPath: inDir(filePath ? dirname(filePath) : defaultDir, `${title}.pdf`),
  };

  // Si la ventana ya existe (export previo sin cerrarla), sólo re-emite.
  const existing = await WebviewWindow.getByLabel(PREVIEW_LABEL);
  if (existing) {
    await emitTo(PREVIEW_LABEL, EVT_PREVIEW_CONTENT, payload);
    await existing.setFocus();
    return;
  }

  // El hijo emite "ready" al montar; hasta entonces no puede recibir el HTML.
  const readyPromise = new Promise<void>((resolve) => {
    void once(EVT_PREVIEW_READY, () => resolve());
  });

  const preview = new WebviewWindow(PREVIEW_LABEL, {
    url: 'index.html#/print',
    title: `Vista previa — ${title}`,
    width: 900,
    height: 1000,
    visible: true,
  });

  preview.once('tauri://error', (e) => {
    console.error('No se pudo crear la ventana de vista previa:', e);
  });

  await readyPromise;
  await emitTo(PREVIEW_LABEL, EVT_PREVIEW_CONTENT, payload);
};

/** API para el componente PrintPreview (ventana hija). */
export const previewChannel = {
  announceReady: async () => {
    const { emit } = await import('@tauri-apps/api/event');
    await emit(EVT_PREVIEW_READY);
  },
  onContent: (handler: (payload: PreviewPayload) => void) =>
    listen<PreviewPayload>(EVT_PREVIEW_CONTENT, (event) => handler(event.payload)),
};

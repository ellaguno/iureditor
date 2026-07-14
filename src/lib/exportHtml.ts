import type { Editor } from '@tiptap/react';
import { readFile } from '@tauri-apps/plugin-fs';
import { renderFullSizeDiagram } from './mermaid';
import { svgToPngDataUrl } from './diagramExport';
import { basename } from './fileio';

// Construye el HTML autosuficiente del documento para exportar:
// - diagramas mermaid pre-renderizados (SVG vectorial para PDF, PNG para DOCX)
// - imágenes locales incrustadas como data URLs (la ventana de preview y el
//   DOCX no dependen del asset protocol)

const dirnameOf = (path: string): string => {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx > 0 ? path.slice(0, idx) : path;
};

const mimeFromExt = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase() || 'png';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  return `image/${ext}`;
};

const bytesToDataUrl = (bytes: Uint8Array, mime: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes.buffer as ArrayBuffer], { type: mime }));
  });

/** Rasteriza un string SVG a PNG data URL montándolo temporalmente. */
const svgStringToPngDataUrl = async (svg: string, scale = 2): Promise<string> => {
  const host = document.createElement('div');
  host.style.position = 'fixed';
  host.style.left = '-99999px';
  host.style.top = '0';
  host.innerHTML = svg;
  document.body.appendChild(host);
  try {
    const el = host.querySelector('svg');
    if (!el) throw new Error('SVG inválido');
    return await svgToPngDataUrl(el, scale);
  } finally {
    host.remove();
  }
};

export interface ExportHtmlOptions {
  /** 'svg' (vectorial, para PDF) o 'png' (para DOCX) */
  mermaidAs: 'svg' | 'png';
}

export const buildExportHtml = async (
  editor: Editor,
  filePath: string | null,
  { mermaidAs }: ExportHtmlOptions
): Promise<{ html: string; title: string }> => {
  const container = document.createElement('div');
  container.innerHTML = editor.getHTML();

  // 1) Mermaid → SVG full-size o PNG
  for (const node of Array.from(container.querySelectorAll('div[data-type="mermaid"]'))) {
    const code = node.getAttribute('data-code') || node.textContent || '';
    const wrapper = document.createElement('div');
    wrapper.className = 'mermaid-diagram';
    if (code.trim()) {
      let svg: string | null = null;
      try {
        svg = await renderFullSizeDiagram(code);
      } catch {
        // Diagrama inválido: va como bloque de código para no perderlo.
        const pre = document.createElement('pre');
        pre.textContent = code;
        wrapper.appendChild(pre);
      }
      if (svg !== null) {
        if (mermaidAs === 'svg') {
          wrapper.innerHTML = svg;
          const svgEl = wrapper.querySelector('svg');
          if (svgEl) {
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        } else {
          try {
            const img = document.createElement('img');
            img.src = await svgStringToPngDataUrl(svg);
            img.alt = 'diagrama';
            wrapper.appendChild(img);
          } catch (err) {
            // La rasterización es el paso frágil (taint de canvas, SVG sin
            // tamaño). Propagar con contexto para el diálogo de error.
            const detail = err instanceof Error ? err.message : String(err);
            throw new Error(`al rasterizar un diagrama mermaid a PNG: ${detail}`);
          }
        }
      }
    }
    node.replaceWith(wrapper);
  }

  // 2) Imágenes locales → data URLs
  const docDir = filePath ? dirnameOf(filePath) : null;
  for (const img of Array.from(container.querySelectorAll('img'))) {
    const orig = img.getAttribute('data-orig-src') || img.getAttribute('src') || '';
    if (!orig || orig.startsWith('data:') || /^[a-z]+:\/\//i.test(orig)) {
      img.removeAttribute('data-orig-src');
      continue;
    }
    if (!docDir) continue;
    try {
      const sep = docDir.includes('\\') ? '\\' : '/';
      const abs = orig.startsWith(sep) ? orig : `${docDir}${sep}${orig.replaceAll('/', sep)}`;
      const bytes = await readFile(abs);
      img.src = await bytesToDataUrl(bytes, mimeFromExt(orig));
      img.removeAttribute('data-orig-src');
    } catch (err) {
      console.error(`No se pudo incrustar la imagen ${orig}:`, err);
    }
  }

  const title = filePath ? basename(filePath).replace(/\.(md|markdown)$/i, '') : 'documento';
  return { html: container.innerHTML, title };
};

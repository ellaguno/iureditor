import { save } from '@tauri-apps/plugin-dialog';
import { writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

// Export de diagramas mermaid. Portado de MarkdownRenderer.tsx pero
// refactorizado: en Tauri `<a download>` con blob URL no hace nada (no hay
// download manager), así que todo se guarda vía dialog.save + plugin-fs.
//
// La rasterización SVG→PNG se hace en Rust (comando render_svg_png, resvg):
// WebKitGTK contamina el canvas al dibujar SVGs y toBlob truena con
// SecurityError ("The operation is insecure"). El canvas queda como
// fallback para cuando la app corre fuera de Tauri.

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const base64ToBytes = (b64: string): Uint8Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

export const svgToString = (svgElement: SVGElement): string =>
  new XMLSerializer().serializeToString(svgElement);

const svgDimensions = (svgElement: SVGElement): { width: number; height: number } => {
  let width = 800;
  let height = 600;
  const viewBox = svgElement.getAttribute('viewBox');
  if (viewBox) {
    const parts = viewBox.split(/\s+/);
    width = parseFloat(parts[2]) || width;
    height = parseFloat(parts[3]) || height;
  } else {
    const widthAttr = svgElement.getAttribute('width');
    const heightAttr = svgElement.getAttribute('height');
    if (widthAttr) width = parseFloat(widthAttr);
    if (heightAttr) height = parseFloat(heightAttr);
  }
  return { width, height };
};

/** Serializa un clon del SVG con width/height explícitos (los SVG sin
 *  tamaño intrínseco no se rasterizan bien ni en canvas ni en resvg). */
const serializeWithSize = (svgElement: SVGElement): string => {
  const { width, height } = svgDimensions(svgElement);
  const clone = svgElement.cloneNode(true) as SVGElement;
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  return svgToString(clone);
};

/** Rasteriza vía comando Rust (resvg). Devuelve PNG en base64. */
const rasterizeWithRust = (svgElement: SVGElement, scale: number): Promise<string> =>
  invoke<string>('render_svg_png', { svg: serializeWithSize(svgElement), scale });

/** Rasteriza un SVG a canvas y devuelve el Blob (png/jpeg). */
const svgToRasterBlob = (
  svgElement: SVGElement,
  type: 'image/png' | 'image/jpeg',
  scale = 2,
  quality = 0.95
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    const { width, height } = svgDimensions(svgElement);
    const svgData = serializeWithSize(svgElement);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    canvas.width = width * scale;
    canvas.height = height * scale;

    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!ctx) return reject(new Error('canvas 2d context unavailable'));
      // toBlob lanza SecurityError SÍNCRONO si el canvas quedó contaminado
      // (p. ej. SVG con foreignObject); sin el try/catch la promesa jamás
      // se resolvería y el export se colgaría en silencio.
      try {
        ctx.scale(scale, scale);
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        canvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
          type,
          quality
        );
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('SVG load error'));
    };

    // crossOrigin antes de src para evitar taint del canvas
    img.crossOrigin = 'anonymous';
    img.src = url;
  });

export const svgToPngBytes = async (svgElement: SVGElement, scale = 2): Promise<Uint8Array> => {
  if (isTauri) {
    return base64ToBytes(await rasterizeWithRust(svgElement, scale));
  }
  const blob = await svgToRasterBlob(svgElement, 'image/png', scale);
  return new Uint8Array(await blob.arrayBuffer());
};

/** PNG como data URL — primitivo para incrustar diagramas en DOCX/HTML. */
export const svgToPngDataUrl = async (svgElement: SVGElement, scale = 2): Promise<string> => {
  if (isTauri) {
    return `data:image/png;base64,${await rasterizeWithRust(svgElement, scale)}`;
  }
  const blob = await svgToRasterBlob(svgElement, 'image/png', scale);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
};

/** Diálogo Guardar + escritura del SVG. */
export const saveSvg = async (svgElement: SVGElement, suggestedName: string): Promise<void> => {
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: 'SVG', extensions: ['svg'] }],
  });
  if (!path) return;
  await writeTextFile(path, svgToString(svgElement));
};

/** Diálogo Guardar + escritura del PNG rasterizado. */
export const savePng = async (
  svgElement: SVGElement,
  suggestedName: string,
  scale = 2
): Promise<void> => {
  const path = await save({
    defaultPath: suggestedName,
    filters: [{ name: 'PNG', extensions: ['png'] }],
  });
  if (!path) return;
  await writeFile(path, await svgToPngBytes(svgElement, scale));
};

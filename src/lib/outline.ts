import type { Node as PMNode } from '@tiptap/pm/model';

// Extracción de encabezados del documento para el panel de esquema.

export interface HeadingInfo {
  /** Nivel 1–6. */
  level: number;
  /** Texto plano del encabezado. */
  text: string;
  /** Posición ProseMirror del nodo (para saltar a la sección). */
  pos: number;
}

/** Slug estilo GitHub para anclas de encabezados (conserva letras Unicode). */
export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');

/** Genera slugs únicos para una secuencia de textos (duplicados: -1, -2…).
 *  Determinista: el índice insertado y los ids de export coinciden. */
export const uniqueSlugs = (texts: string[]): string[] => {
  const seen = new Map<string, number>();
  return texts.map((text) => {
    const base = slugify(text) || 'seccion';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  });
};

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** HTML de un índice (lista anidada de enlaces #ancla) desde los encabezados. */
export const buildTocHtml = (headings: HeadingInfo[]): string => {
  if (!headings.length) return '';
  const slugs = uniqueSlugs(headings.map((h) => h.text));
  const minLevel = Math.min(...headings.map((h) => h.level));
  const out: string[] = [];
  let depth = 0;
  headings.forEach((h, i) => {
    const d = Math.max(1, h.level - minLevel + 1);
    if (depth === 0) {
      out.push('<ul><li>');
      depth = 1;
    } else if (d > depth) {
      while (depth < d) {
        out.push('<ul><li>');
        depth++;
      }
    } else {
      while (depth > d) {
        out.push('</li></ul>');
        depth--;
      }
      out.push('</li><li>');
    }
    out.push(`<a href="#${slugs[i]}">${escapeHtml(h.text || 'Sección')}</a>`);
  });
  while (depth > 0) {
    out.push('</li></ul>');
    depth--;
  }
  return out.join('');
};

export const collectHeadings = (doc: PMNode): HeadingInfo[] => {
  const headings: HeadingInfo[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      headings.push({
        level: node.attrs.level as number,
        text: node.textContent,
        pos,
      });
      return false; // los encabezados no anidan otros bloques
    }
    return true;
  });
  return headings;
};
